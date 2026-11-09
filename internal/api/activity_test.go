package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestHistoricalDashboardRetainsAllDailyMetrics(t *testing.T) {
	// A full-history daily response exceeds the old 20,000-row / 4-MiB limits.
	row := `{"metric":"jetton_transfers","day":"2020-01-01","value":"9007199254740993","amount_nanoton":null,"breakdown":{},"is_partial":0,"source_mc_seqno":100,"calculated_at":"2026-11-09T00:00:00Z","data_through":"2020-01-02T00:00:00Z"}`
	daily := json.RawMessage("[" + strings.Repeat(row+",", 38099) + row + "]")
	s := New(readerFunc(func(_ context.Context, name string, q url.Values) (json.RawMessage, error) {
		if q.Get("from") != "2019-11-15" {
			t.Fatal(q)
		}
		if name == "daily" {
			return daily, nil
		}
		return json.RawMessage(`[]`), nil
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/dashboard?from=2019-11-15&to=2026-11-09", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct {
		Daily []json.RawMessage `json:"daily"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Daily) != 38100 || !strings.Contains(string(result.Daily[38100-1]), `"9007199254740993"`) {
		t.Fatal("history truncated or rounded")
	}
}

func TestHistoricalActivityReadBatchesWithoutGaps(t *testing.T) {
	next := "2019-11-15"
	calls := 0
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("param_from") != next || q.Get("max_result_rows") != "20000" {
			t.Error(q)
		}
		start, _ := time.Parse(time.DateOnly, q.Get("param_from"))
		end, _ := time.Parse(time.DateOnly, q.Get("param_to"))
		if end.Sub(start) > 366*24*time.Hour || !start.Before(end) {
			t.Error("unbounded batch", q)
		}
		next = q.Get("param_to")
		calls++
		fmt.Fprintf(w, `{"data":[{"day":%q,"value":"9007199254740993"}]}`, q.Get("param_from"))
	}))
	defer source.Close()
	ch, err := NewClickHouse(source.URL, "reader", "password")
	if err != nil {
		t.Fatal(err)
	}
	data, err := (ClickHouseReader{CH: ch}).Read(context.Background(), "daily", url.Values{"from": {"2019-11-15"}, "to": {"2026-11-09"}})
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]string
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	if next != "2026-11-09" || calls != 7 || len(rows) != 7 || rows[6]["value"] != "9007199254740993" {
		t.Fatal(next, calls, string(data))
	}
}

func TestActivityRouteReadsOnlyPreparedActivity(t *testing.T) {
	calls := 0
	s := New(readerFunc(func(_ context.Context, name string, q url.Values) (json.RawMessage, error) {
		if name != "daily" && name != "stars" {
			t.Fatal("unrelated source", name)
		}
		calls++
		return json.RawMessage(`[]`), nil
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/activity?from=2019-11-01&to=2026-11-01", nil))
	if w.Code != 200 || calls != 2 || !strings.Contains(w.Body.String(), `"chain":[]`) {
		t.Fatal(w.Code, calls, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/activity?from=2026-11-01&to=2026-11-09&sql=bad", nil))
	if w.Code != 400 || calls != 2 {
		t.Fatal("invalid input reached source")
	}
}
