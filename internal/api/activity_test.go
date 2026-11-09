package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
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
