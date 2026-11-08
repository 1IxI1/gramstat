package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestFullHistoryChainEndpoint(t *testing.T) {
	rows := make([]map[string]any, 2500)
	start := time.Date(2019, 11, 15, 0, 0, 0, 0, time.UTC)
	for i := range rows {
		rows[i] = map[string]any{"day": start.AddDate(0, 0, i).Format(time.DateOnly), "fees_nanoton": "9007199254740993", "burned_nanoton": nil}
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		calls++
		if name != "chain" || p.Get("from") != "2019-11-15" || p.Get("to") != "2026-11-01" {
			t.Fatal(name, p)
		}
		return encoded, nil
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/chain?from=2019-11-15&to=2026-11-01", nil))
	var result struct {
		Chain  []map[string]any
		Period map[string]string
	}
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Chain) != 2500 || calls != 1 || result.Period["from"] != "2019-11-15" || result.Chain[2499]["fees_nanoton"] != "9007199254740993" || result.Chain[2499]["burned_nanoton"] != nil {
		t.Fatal("history truncated or values changed")
	}
	for _, target := range []string{
		"/api/v1/chain?from=2019-11-15&to=2026-11-01&table=blocks",
		"/api/v1/chain?from=2019-11-15&from=2020-01-01&to=2026-11-01",
		"/api/v1/chain?from=2018-01-01&to=2026-11-01",
	} {
		w = httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", target, nil))
		if w.Code != 400 || calls != 1 {
			t.Fatal("invalid range reached reader", target)
		}
	}
}
