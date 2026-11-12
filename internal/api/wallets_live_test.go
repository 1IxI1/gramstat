package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestCurrentWalletHoursDoNotRequireClosedDayOrInventFutureZeroes(t *testing.T) {
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		switch name {
		case "wallet_days":
			return json.RawMessage(`[]`), nil
		case "wallet_active_days":
			return json.RawMessage(`[{"day":"2026-11-12","run_id":"00000000-0000-0000-0000-000000000001","complete_before":1794447000}]`), nil
		case "wallet_activity":
			if p.Get("published") != "[('2026-11-12','00000000-0000-0000-0000-000000000001')]" {
				t.Fatal(p)
			}
			return json.RawMessage(`[{"utime":1794441600,"value":"42"},{"utime":1794445200,"value":"0"}]`), nil
		default:
			t.Fatalf("unexpected source %s", name)
			return nil, nil
		}
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/wallets?from=2026-11-12T00:00:00Z&to=2026-11-12T02:00:00Z&activity=hourly", nil))
	var result struct {
		CoverageDays []string
		Active       struct {
			CoverageDays []string
			Points       []struct {
				Utime   uint32
				Value   string
				End     uint32 `json:"end_utime"`
				Partial bool   `json:"is_partial"`
			}
		}
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(result.CoverageDays) != 0 || len(result.Active.CoverageDays) != 1 || len(result.Active.Points) != 2 {
		t.Fatal(w.Body.String())
	}
	p := result.Active.Points
	if p[0].Partial || p[0].End != 1794445200 || !p[1].Partial || p[1].End != 1794447000 || p[1].Value != "0" {
		t.Fatal(w.Body.String())
	}
}
