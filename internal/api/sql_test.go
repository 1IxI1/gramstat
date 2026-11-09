package api

import (
	"context"
	_ "embed"
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// A consumer-side fixture, not a production migration. The writer owns DDL.
//
//go:embed testdata/schema.sql
var schema string

//go:embed testdata/stake_changes.sql
var stakeChangesFixture string

func TestQueriesWithRealClickHouse(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	run := func(sql string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, "local", "--path", dir, "--max_threads", "2", "--multiquery", "--param_from", "2026-10-21", "--param_to", "2026-10-28", "--param_round", "1792540800", "--join_use_nulls", "1", "--query", sql)
		b, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s", err, b)
		}
		return b
	}
	run(schema + stakeChangesFixture + `
INSERT INTO gramstat.chain_daily_full VALUES('2026-10-21',1,100,0,0,NULL,NULL,1,1,3,'fixture','2026-10-28 00:00:00'),
('2026-10-22',7,NULL,50,0,5258373238061259412,1792627200,0,1,3,'fixture','2026-10-28 00:00:00'),
('2026-10-23',1,100,0,0,NULL,NULL,1,1,3,'fixture','2026-10-28 00:00:00');
INSERT INTO gramstat.validator_rounds (utime_since,utime_until,total,roster_digest,config34_hash,calculated_at) VALUES(1792540800,1792606336,380,'current','hash','2026-10-22 00:00:00');
INSERT INTO gramstat.validator_geo_rounds(utime_since,utime_until,total,located,countries,roster_digest,config34_hash,calculated_at) VALUES(1792540800,1792606336,379,378,22,'old','hash','2026-10-22 00:00:00');
INSERT INTO gramstat.validator_stake_rounds (utime_since,utime_until,election_id,submitted_nanogram,selected_nanogram,remaining_nanogram,unfreeze_utime,config34_hash,roster_digest,status,calculated_at,reward_nanogram) VALUES(1792540800,1792606336,1792540800,900719925474099312345,800719925474099312345,NULL,NULL,'hash','current','missing_result','2026-10-22 00:00:00',NULL);
`)
	for name, query := range queries {
		if strings.HasPrefix(name, "supply_") || strings.HasPrefix(name, "accounts_") || strings.HasPrefix(name, "wallet_") || name == "inflation_rollup" {
			continue
		} // Covered by the checkpoint/raw integration test.
		b := run(query + " FORMAT JSON")
		var result struct {
			Data []map[string]any `json:"data"`
		}
		if err = json.Unmarshal(b, &result); err != nil {
			t.Fatalf("%s: %v %s", name, err, b)
		}
		if name == "chain" {
			if len(result.Data) != 3 {
				t.Fatal(string(b))
			}
			r := result.Data[1]
			if r["supply_nanoton"] != "5258373238061259412" || r["fees_nanoton"] != nil || r["transactions"] != "7" || r["is_partial"] != float64(0) {
				t.Fatal(string(b))
			}
		}
		if name == "coverage" {
			for _, row := range result.Data {
				if row["source"] == "chain" && row["last_complete_day"] != "2026-10-22" {
					t.Fatal("incorrect complete daily boundary: " + string(b))
				}
			}
		}
		if name == "rounds" && (len(result.Data) != 1 || result.Data[0]["countries"] != nil || result.Data[0]["located"] != nil) {
			t.Fatal("stale geo joined: " + string(b))
		}
		if name == "rounds" || name == "validators" {
			if len(result.Data) != 1 || result.Data[0]["utime_since"] != float64(1792540800) || result.Data[0]["utime_until"] != float64(1792606336) || result.Data[0]["data_through"] != float64(0) || result.Data[0]["total"] != float64(380) {
				t.Fatal("unstable round field names: " + string(b))
			}
			if len(result.Data) != 1 || result.Data[0]["submitted_nanogram"] != "900719925474099312345" || result.Data[0]["selected_nanogram"] != "800719925474099312345" || result.Data[0]["remaining_nanogram"] != nil {
				t.Fatal("stake precision/null lost: " + string(b))
			}
		}
		if name == "locations" && len(result.Data) != 0 {
			t.Fatal("stale map published")
		}
	}
	run(`INSERT INTO gramstat.validator_stake_rounds (utime_since,utime_until,election_id,submitted_nanogram,selected_nanogram,remaining_nanogram,unfreeze_utime,config34_hash,roster_digest,status,calculated_at,reward_nanogram) VALUES(1792540800,1792606336,1792540800,1,1,1,1792700000,'wrong-hash','current','complete','2026-10-23 00:00:00',900719925474099312345);`)
	for _, name := range []string{"rounds", "validators"} {
		b := run(queries[name] + " FORMAT JSON")
		var result struct {
			Data []map[string]any `json:"data"`
		}
		if err := json.Unmarshal(b, &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Data) != 1 || result.Data[0]["selected_nanogram"] != nil || result.Data[0]["remaining_nanogram"] != nil {
			t.Fatal("stale stake joined: " + string(b))
		}
	}
	run(`INSERT INTO gramstat.validator_stake_rounds (utime_since,utime_until,election_id,submitted_nanogram,selected_nanogram,remaining_nanogram,unfreeze_utime,config34_hash,roster_digest,status,calculated_at,reward_nanogram) VALUES(1792540800,1792606336,1792540800,1,1,1,1792700000,'hash','current','complete','2026-10-24 00:00:00',900719925474099312345);`)
	for _, name := range []string{"rounds", "validators"} {
		var result struct {
			Data []map[string]any `json:"data"`
		}
		if err := json.Unmarshal(run(queries[name]+" FORMAT JSON"), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Data) != 1 || result.Data[0]["reward_nanogram"] != "900719925474099312345" {
			t.Fatal("reward lost precision")
		}
	}
	// API projections must not leak source hostnames, raw IPs or internal record IDs.
	if strings.Contains(queries["locations"], "record_id") {
		t.Fatal("internal evidence leaked")
	}
}
