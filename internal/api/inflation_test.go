package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"strings"
	"testing"
)

func TestInflationHTTP(t *testing.T) {
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		if name != "inflation_rollup" || p.Get("step") != "3600" {
			t.Fatal(name, p)
		}
		return json.RawMessage(`[{"utime":1792627200,"window_from":1792540800,"annualized_percent":"-0.25","minted_24h_nanoton":"10000000000000001"}]`), nil
	}), logger())
	for _, suffix := range []string{"", "&maxPoints=1", "&maxPoints=800&maxPoints=900", "&step=1"} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/inflation?from=2026-10-22T00:00:00Z&to=2026-10-23T00:00:00Z"+suffix, nil))
		if suffix != "" {
			if w.Code != 400 {
				t.Fatal(w.Code, w.Body.String())
			}
			continue
		}
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"windowSeconds":86400`) || !strings.Contains(w.Body.String(), `"annualized_percent":"-0.25"`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}

func TestInflationRollupPreservesUnknownFinalPoint(t *testing.T) {
	binary, e := exec.LookPath("clickhouse")
	if e != nil {
		t.Skip("clickhouse-local unavailable")
	}
	sql := schema + `INSERT INTO gramstat.inflation_hourly VALUES
 ('2026-10-22 00:00:00','2026-10-21 00:00:00',1,2,100,1792627199,10,-0.25,30,now64(6)),
 ('2026-10-22 02:00:00','2026-10-21 02:00:00',2,1,100,1792634399,20,1.2,30,now64(6)),
 ('2026-10-22 03:00:00','2026-10-21 03:00:00',NULL,1,100,1792637999,30,NULL,30,now64(6));` + queries["inflation_rollup"] + " FORMAT JSON"
	b, e := exec.Command(binary, "local", "--path", t.TempDir(), "--max_threads", "2", "--multiquery", "--param_from_ts", "1792627200", "--param_to_ts", "1792641600", "--param_step", "7200", "--query", sql).CombinedOutput()
	if e != nil {
		t.Fatal(e, string(b))
	}
	var result struct {
		Data []struct {
			Annualized *string `json:"annualized_percent"`
			Minted     *string `json:"minted_24h_nanoton"`
		}
	}
	if e = json.Unmarshal(b, &result); e != nil {
		t.Fatal(e, string(b))
	}
	if len(result.Data) != 2 || result.Data[0].Annualized == nil || *result.Data[0].Annualized != "-0.25" || result.Data[1].Annualized != nil || result.Data[1].Minted != nil {
		t.Fatal(string(b))
	}
}
