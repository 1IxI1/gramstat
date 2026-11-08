package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

const MaxDays = 93

type entry struct {
	data    []byte
	expires time.Time
}

type Server struct {
	reader  Reader
	log     *slog.Logger
	mu      sync.Mutex
	cache   map[string]entry
	pending map[string]chan struct{}
	slots   chan struct{}
}

func New(reader Reader, log *slog.Logger) *Server {
	return &Server{reader: reader, log: log, cache: make(map[string]entry), pending: make(map[string]chan struct{}), slots: make(chan struct{}, 4)}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		problem(w, 405, "method not allowed")
		return
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		problem(w, 400, "invalid query")
		return
	}
	name := ""
	switch r.URL.Path {
	case "/api/health":
		if len(q) != 0 {
			problem(w, 400, "unexpected parameters")
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	case "/api/v1/coverage":
		name = "coverage"
	case "/api/v1/dashboard":
		name = "dashboard"
	case "/api/v1/chain":
		name = "chain"
	case "/api/v1/validators":
		name = "validators"
	case "/api/v1/locations":
		name = "locations"
	case "/api/v1/supply":
		name = "supply"
	case "/api/v1/inflation":
		name = "inflation"
	case "/api/v1/accounts":
		name = "accounts"
	case "/api/v1/wallets":
		name = "wallets"
	default:
		problem(w, 404, "not found")
		return
	}
	if err = validate(name, q, time.Now().UTC()); err != nil {
		problem(w, 400, err.Error())
		return
	}
	key := name + "?" + q.Encode()
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	data, err := s.cached(ctx, key, func() ([]byte, error) { return s.load(ctx, name, q) })
	if err != nil {
		// Source errors may contain SQL or internal addresses. Only server logs get them.
		s.log.Error("chart read failed", "route", name, "error", err)
		w.Header().Set("Retry-After", "10")
		problem(w, 503, "data temporarily unavailable")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=60")
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

func problem(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func validate(name string, q url.Values, now time.Time) error {
	for k, v := range q {
		if len(v) != 1 || ((name == "dashboard" || name == "chain" || name == "validators") && k != "from" && k != "to") || ((name == "supply" || name == "inflation" || name == "accounts" || name == "wallets") && k != "from" && k != "to" && k != "maxPoints") || (name == "locations" && k != "round") || name == "coverage" {
			return fmt.Errorf("unexpected or repeated parameters")
		}
	}
	if name == "supply" || name == "inflation" || name == "accounts" || name == "wallets" {
		from, e1 := time.Parse(time.RFC3339, q.Get("from"))
		to, e2 := time.Parse(time.RFC3339, q.Get("to"))
		if e1 != nil || e2 != nil || !from.Before(to) || from.Year() < 2019 || to.After(now.Truncate(24*time.Hour).Add(24*time.Hour)) || to.Sub(from) > 10*366*24*time.Hour || from.Nanosecond() != 0 || to.Nanosecond() != 0 {
			return fmt.Errorf("use RFC3339 from/to timestamps, exclusive to, within 2019–today and at most ten years")
		}
		budget := 800
		if q.Has("maxPoints") {
			n, e := strconv.Atoi(q.Get("maxPoints"))
			if e != nil || n < 100 || n > 2000 {
				return fmt.Errorf("maxPoints must be between 100 and 2000")
			}
			budget = n
		}
		q.Set("from", from.UTC().Format(time.RFC3339))
		q.Set("to", to.UTC().Format(time.RFC3339))
		q.Set("maxPoints", strconv.Itoa(budget))
	}
	if name == "locations" {
		n, err := strconv.ParseUint(q.Get("round"), 10, 32)
		if err != nil || n == 0 || int64(n) > now.Unix() {
			return fmt.Errorf("round must be a past UInt32 Unix timestamp")
		}
		q.Set("round", strconv.FormatUint(n, 10))
	}
	if name == "dashboard" || name == "chain" || name == "validators" {
		maxDays := MaxDays
		if name == "chain" || name == "validators" {
			maxDays = 3660
		}
		from, e1 := time.Parse(time.DateOnly, q.Get("from"))
		to, e2 := time.Parse(time.DateOnly, q.Get("to"))
		if e1 != nil || e2 != nil || !from.Before(to) || from.Year() < 2019 || to.After(now.Truncate(24*time.Hour).Add(24*time.Hour)) || to.Sub(from) > time.Duration(maxDays)*24*time.Hour {
			return fmt.Errorf("use UTC from/to dates, exclusive to, between 1 and %d days, no future days", maxDays)
		}
	}
	return nil
}

// Bounded cache and miss concurrency; same-key requests share one load.
// Failed reads never replace cached successful responses with fabricated zeros.
func (s *Server) cached(ctx context.Context, key string, load func() ([]byte, error)) ([]byte, error) {
	for {
		s.mu.Lock()
		if e, ok := s.cache[key]; ok && time.Now().Before(e.expires) {
			s.mu.Unlock()
			return e.data, nil
		}
		if done, ok := s.pending[key]; ok {
			s.mu.Unlock()
			select {
			case <-done:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		select {
		case s.slots <- struct{}{}:
		default:
			s.mu.Unlock()
			return nil, fmt.Errorf("chart readers busy")
		}
		done := make(chan struct{})
		s.pending[key] = done
		s.mu.Unlock()
		data, err := load()
		s.mu.Lock()
		if err == nil {
			if len(s.cache) >= 32 {
				var oldest string
				var expiry time.Time
				for k, e := range s.cache {
					if expiry.IsZero() || e.expires.Before(expiry) {
						oldest, expiry = k, e.expires
					}
				}
				delete(s.cache, oldest)
			}
			s.cache[key] = entry{data, time.Now().Add(5 * time.Minute)}
		}
		delete(s.pending, key)
		close(done)
		<-s.slots
		s.mu.Unlock()
		return data, err
	}
}

func (s *Server) load(ctx context.Context, name string, q url.Values) ([]byte, error) {
	if name == "wallets" {
		return s.loadWallets(ctx, q)
	}
	if name == "accounts" {
		return s.loadAccounts(ctx, q)
	}
	if name == "inflation" {
		return s.loadInflation(ctx, q)
	}
	if name == "supply" {
		return s.loadSupply(ctx, q)
	}
	result := map[string]any{"schemaVersion": 2, "network": "mainnet", "servedAt": time.Now().UTC().Format(time.RFC3339)}
	if name == "chain" || name == "validators" {
		result["period"] = map[string]string{"from": q.Get("from"), "to": q.Get("to")}
	}
	if name == "dashboard" {
		result["period"] = map[string]string{"from": q.Get("from"), "to": q.Get("to")}
		// Compact, precomputed tables only. The complete response is cached together.
		for _, source := range []string{"chain", "daily", "stars", "rounds"} {
			rows, err := s.reader.Read(ctx, source, q)
			if err != nil {
				return nil, err
			}
			result[source] = rows
		}
	} else {
		rows, err := s.reader.Read(ctx, name, q)
		if err != nil {
			return nil, err
		}
		if name == "validators" {
			result["rounds"] = rows
		} else {
			result[name] = rows
		}
	}
	data, err := json.Marshal(result)
	if len(data) > 4<<20 {
		return nil, fmt.Errorf("chart response exceeds limit")
	}
	return data, err
}
