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

func TestSupplyHTTP(t *testing.T) {
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		if name == "supply_bounds" {
			return json.RawMessage(`[{"first_mc":10,"last_mc":11,"mc_count":2,"opening_burn":"123"}]`), nil
		}
		if name == "supply_raw" && (p.Get("opening_burn") != "123" || p.Get("step") != "0") {
			t.Fatal(p)
		}
		return json.RawMessage(`[{"utime":1792627201,"mc_seqno":11,"supply_nanoton":"5000000000000000001"}]`), nil
	}), logger())
	for _, target := range []string{
		"/api/v1/supply", "/api/v1/supply?from=2026-10-22&to=2026-10-23",
		"/api/v1/supply?from=2026-10-22T00:00:00Z&to=2026-10-23T00:00:00Z&maxPoints=100000",
		"/api/v1/supply?from=2026-10-22T00:00:00Z&to=2026-10-23T00:00:00Z&sql=1",
	} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", target, nil))
		if w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/supply?from=2026-10-22T00:00:00Z&to=2026-10-22T01:00:00Z", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"intervalSeconds":0`) || !strings.Contains(w.Body.String(), `"5000000000000000001"`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestSupplyCheckpointQueries(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	dir := t.TempDir()
	run := func(q string, step string) []map[string]any {
		t.Helper()
		b, e := exec.Command(binary, "local", "--path", dir, "--max_threads", "2", "--multiquery",
			"--param_from_ts", "1793741107", "--param_to_ts", "1793741110", "--param_first_mc", "103190380", "--param_last_mc", "103190383",
			"--param_opening_known", "1", "--param_opening_burn", "100", "--param_step", step, "--query", q).CombinedOutput()
		if e != nil {
			t.Fatalf("%v\n%s", e, b)
		}
		if len(b) == 0 {
			return nil
		}
		var result struct{ Data []map[string]any }
		if e = json.Unmarshal(b, &result); e != nil {
			t.Fatal(string(b), e)
		}
		return result.Data
	}
	run(`CREATE DATABASE mainnet_gramstat_full;CREATE DATABASE gramstat;
CREATE TABLE mainnet_gramstat_full.blocks(workchain Int32,shard Int64,seqno UInt32,gen_utime UInt32,global_balance Nullable(Decimal(38,0)),burned Nullable(Decimal(38,0))) ENGINE=ReplacingMergeTree ORDER BY(workchain,shard,seqno);
INSERT INTO mainnet_gramstat_full.blocks VALUES
(-1,-9223372036854775808,103190380,1793741106,5000000000000000001,2),
(-1,-9223372036854775808,103190381,1793741107,5000000000000000002,3),
(-1,-9223372036854775808,103190381,1793741107,5000000000000000002,3),
(-1,-9223372036854775808,103190382,1793741108,5000000000000000003,4),
(-1,-9223372036854775808,103190383,1793741109,NULL,5);
CREATE TABLE gramstat.supply_hourly(hour DateTime('UTC'),first_mc UInt32,last_mc UInt32,first_utime UInt32,last_utime UInt32,opening_burn Nullable(Decimal(38,0)),cumulative_burn Nullable(Decimal(38,0)),supply_nanoton Nullable(Decimal(38,0)),mc_count UInt32,is_partial UInt8,source_mc_to UInt32,calculated_at DateTime64(6,'UTC')) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY hour;
INSERT INTO gramstat.supply_hourly VALUES ('2026-11-03 21:00:00',103190380,103190383,1793741106,1793741109,100,114,NULL,4,1,103190383,now64(6));`, "0")
	rows := run(queries["supply_raw"]+" FORMAT JSON", "0")
	if len(rows) != 3 || rows[0]["supply_nanoton"] != "4999999999999999897" || rows[1]["supply_nanoton"] != "5000000000000000003" || rows[2]["supply_nanoton"] != nil {
		t.Fatal(rows)
	}
	rows = run(queries["supply_raw"]+" FORMAT JSON", "3600")
	if len(rows) != 1 || rows[0]["supply_nanoton"] != nil {
		t.Fatal("NULL final point fell back", rows)
	}
	rows = run(queries["supply_bounds"]+" FORMAT JSON", "3600")
	if len(rows) != 1 || rows[0]["opening_burn"] != "100" || rows[0]["mc_count"] != float64(4) {
		t.Fatal(rows)
	}
	rows = run(queries["supply_rollup"]+" FORMAT JSON", "3600")
	if len(rows) != 1 || rows[0]["supply_nanoton"] != nil {
		t.Fatal(rows)
	}
}
