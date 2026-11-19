// Package origin implements the standalone web frontend.
package origin

import (
	"log/slog"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/1IxI1/gramstat/ui"
)

const Host = "stats.ton.org"

func client(r *http.Request) (netip.Addr, bool) {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	peer := ap.Addr().Unmap()
	if err != nil {
		return netip.Addr{}, false
	}
	if r.TLS != nil && (!strings.EqualFold(r.TLS.ServerName, Host) ||
		(!strings.EqualFold(r.Host, Host) && !strings.EqualFold(r.Host, Host+":443"))) {
		return netip.Addr{}, false
	}
	if peer.IsLoopback() {
		return peer, true // Never attribute a local preview to forwarded headers.
	}
	if r.TLS == nil || !trusted(peer) {
		return netip.Addr{}, false
	}
	headers := r.Header.Values("CF-Connecting-IP")
	if len(headers) != 1 {
		return netip.Addr{}, false
	}
	ip, err := netip.ParseAddr(headers[0])
	return ip.Unmap(), err == nil && ip.Zone() == ""
}

type response struct {
	http.ResponseWriter
	status int
}

func (w *response) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func Handler(api http.Handler, log *slog.Logger) http.Handler {
	return handler(api, log, time.Now)
}

func handler(api http.Handler, log *slog.Logger, now func() time.Time) http.Handler {
	files := ui.Handler()
	l := &limits{clients: make(map[netip.Addr]*visitor), now: now}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		ip, ok := client(r)
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			h.Set("Allow", "GET, HEAD")
			h.Set("Connection", "close")
			http.Error(w, "method not allowed", 405)
			return
		}
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			h.Set("Connection", "close")
			http.Error(w, "request bodies are not supported", 400)
			return
		}
		if len(r.RequestURI) > 2048 {
			http.Error(w, "request URI too long", 414)
			return
		}
		isAPI := strings.HasPrefix(r.URL.EscapedPath(), "/api/")
		done, ok := l.begin(ip, isAPI)
		if !ok {
			h.Set("Retry-After", "1")
			http.Error(w, "too many requests", 429)
			return
		}
		defer done()
		if isAPI {
			start := time.Now()
			out := &response{w, http.StatusOK}
			api.ServeHTTP(out, r)
			log.Info("API request", "path", r.URL.Path, "status", out.status, "duration", time.Since(start))
			return
		}
		files.ServeHTTP(w, r)
	})
}
