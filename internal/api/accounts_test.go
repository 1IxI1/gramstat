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

func TestAccountsEndpoint(t *testing.T) {
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		switch name {
		case "accounts_bounds":
			return json.RawMessage(`[{"first_mc":3,"last_mc":1003,"mc_count":1001,"opening_uninit":"0","opening_active":"7","opening_frozen":"0"}]`), nil
		case "accounts_count":
			return json.RawMessage(`[{"count":2}]`), nil
		case "accounts_raw":
			if p.Get("step") != "0" || p.Get("opening_active") != "7" {
				t.Fatal(p)
			}
		default:
			t.Fatal(name)
		}
		return json.RawMessage(`[{"utime":1573862400,"mc_seqno":3,"total":"8","active":"7","uninit":"1","frozen":"0"}]`), nil
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts?from=2019-11-16T00:00:00Z&to=2019-11-16T00:05:00Z", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"intervalSeconds":0`) || !strings.Contains(w.Body.String(), `"total":"8"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts?from=2019-11-16T00:00:00Z&to=2019-11-16T00:05:00Z&baseline=0", nil))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}

func TestAccountsSQL(t *testing.T) {
	binary, e := exec.LookPath("clickhouse")
	if e != nil {
		t.Skip("clickhouse-local unavailable")
	}
	dir := t.TempDir()
	run := func(sql string) []map[string]any {
		t.Helper()
		b, e := exec.Command(binary, "local", "--path", dir, "--max_threads", "2", "--multiquery",
			"--param_from_ts", "1573862401", "--param_to_ts", "1573866011", "--param_first_mc", "3", "--param_last_mc", "6",
			"--param_opening_uninit", "0", "--param_opening_active", "7", "--param_opening_frozen", "0", "--param_step", "0", "--query", sql).CombinedOutput()
		if e != nil {
			t.Fatal(e, string(b))
		}
		if len(b) == 0 {
			return nil
		}
		var r struct{ Data []map[string]any }
		if e = json.Unmarshal(b, &r); e != nil {
			t.Fatal(e, string(b))
		}
		return r.Data
	}
	run(schema + `CREATE DATABASE gramstat_full;
CREATE TABLE gramstat_full.account_deltas(mc_seqno UInt32,gen_utime DateTime('UTC'),delta_uninit Int64,delta_active Int64,delta_frozen Int64) ENGINE=ReplacingMergeTree ORDER BY(gen_utime,mc_seqno);
INSERT INTO gramstat_full.account_deltas VALUES (3,1573862400,1,0,0),(3,1573862400,1,0,0),(4,1573862401,-1,1,0),(5,1573866000,0,-1,1),(6,1573866010,0,0,-1);
INSERT INTO gramstat.accounts_hourly VALUES
('2019-11-16 00:00:00',3,4,1573862400,1573862401,0,7,0,0,8,0,2,6,'baseline',now64(6)),
('2019-11-16 01:00:00',5,6,1573866000,1573866010,0,8,0,0,7,0,2,6,'baseline',now64(6));`)
	bounds := run(accountsBoundsSQL + " FORMAT JSON")
	if len(bounds) != 1 || bounds[0]["opening_active"] != "7" || bounds[0]["mc_count"] != float64(4) {
		t.Fatal(bounds)
	}
	counts := run(accountsCountSQL + " FORMAT JSON")
	if counts[0]["count"] != float64(3) {
		t.Fatal(counts)
	}
	rows := run(accountsRawSQL + " FORMAT JSON")
	if len(rows) != 3 || rows[0]["total"] != "8" || rows[0]["uninit"] != "0" || rows[1]["frozen"] != "1" || rows[2]["total"] != "7" {
		t.Fatal(rows)
	}
	rollup := strings.ReplaceAll(accountsRollupSQL, "{step:UInt32}", "3600")
	rows = run(rollup + " FORMAT JSON")
	if len(rows) != 2 || rows[0]["total"] != "8" || rows[1]["total"] != "7" {
		t.Fatal(rows)
	}
}
