package api

import (
	"context"
	"encoding/json"
	"os/exec"
	"testing"
	"time"
)

func TestAPRSQLChecksBothRoundsAndKeepsNull(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local not installed")
	}
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	run := func(sql string) []map[string]any {
		t.Helper()
		out, err := exec.CommandContext(ctx, binary, "local", "--path", dir, "--max_threads", "2", "--multiquery",
			"--join_use_nulls", "1", "--param_from", "2026-01-01", "--param_to", "2026-01-02", "--query", sql).CombinedOutput()
		if err != nil {
			t.Fatalf("ClickHouse: %v\n%s", err, out)
		}
		if len(out) == 0 {
			return nil
		}
		var result struct {
			Data []map[string]any `json:"data"`
		}
		if err := json.Unmarshal(out, &result); err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return result.Data
	}
	run(`CREATE DATABASE gramstat;
CREATE TABLE gramstat.validator_rounds (utime_since UInt32,utime_until UInt32,total UInt16,is_partial UInt8,data_through UInt32,calculated_at DateTime64(6,'UTC'),roster_digest String,config34_hash String) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY utime_since;
CREATE TABLE gramstat.validator_geo_rounds (utime_since UInt32,located UInt16,unknown UInt16,countries UInt16,country_known UInt16,breakdown String,status String,data_through UInt32,calculated_at DateTime64(6,'UTC'),roster_digest String,config34_hash String) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY utime_since;
CREATE TABLE gramstat.validator_stake_rounds (utime_since UInt32,utime_until UInt32,election_id Nullable(UInt32),submitted_nanogram Nullable(Decimal(38,0)),selected_nanogram Nullable(Decimal(38,0)),remaining_nanogram Nullable(Decimal(38,0)),reward_nanogram Nullable(Decimal(38,0)),unfreeze_utime Nullable(UInt32),status String,roster_digest String,config34_hash String,calculated_at DateTime64(6,'UTC'),calc_version String,apr_percent Nullable(Decimal(76,12)),apr_cycle_seconds Nullable(UInt32),apr_next_utime_until Nullable(UInt32),apr_next_config34_hash Nullable(String),apr_next_roster_digest Nullable(String),apr_status String) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY utime_since;
INSERT INTO gramstat.validator_rounds VALUES
(1767260000,1767325536,300,0,1767325536,now64(6),'roster','hash'),
(1767325536,1767391072,301,0,1767391072,now64(6),'next','next-hash');
INSERT INTO gramstat.validator_stake_rounds VALUES
(1767260000,1767325536,1767260000,1000000000000000000,1000000000000000000,999000000000000000,1000000000000000,1767358304,'complete','roster','hash',now64(6),'stake-v3',24.060058593750,131072,1767391072,'next-hash','next','complete');`)
	for _, name := range []string{"validators", "rounds"} {
		rows := run(queries[name] + " FORMAT JSON")
		// The successor lies beyond the request's end; still use its proof.
		if len(rows) != 1 || rows[0]["apr_percent"] != "24.06005859375" {
			t.Fatal(name, rows)
		}
	}
	run("ALTER TABLE gramstat.validator_stake_rounds UPDATE apr_percent=0 WHERE 1 SETTINGS mutations_sync=1")
	if rows := run(queries["validators"] + " FORMAT JSON"); rows[0]["apr_percent"] != "0" {
		t.Fatal("known zero lost", rows)
	}
	run("ALTER TABLE gramstat.validator_rounds UPDATE config34_hash='changed' WHERE utime_since=1767325536 SETTINGS mutations_sync=1")
	for _, name := range []string{"validators", "rounds"} {
		rows := run(queries[name] + " FORMAT JSON")
		if rows[0]["apr_percent"] != nil || rows[0]["apr_status"] != "stale_intervals" {
			t.Fatal("stale APR exposed", name, rows)
		}
	}
	run("ALTER TABLE gramstat.validator_rounds UPDATE config34_hash='next-hash',data_through=1767325537 WHERE utime_since=1767325536 SETTINGS mutations_sync=1")
	if rows := run(queries["validators"] + " FORMAT JSON"); rows[0]["apr_percent"] != nil {
		t.Fatal("unfinished successor", rows)
	}
	run("ALTER TABLE gramstat.validator_stake_rounds UPDATE apr_percent=NULL,apr_status='missing_reward' WHERE 1 SETTINGS mutations_sync=1")
	if rows := run(queries["validators"] + " FORMAT JSON"); rows[0]["apr_percent"] != nil || rows[0]["apr_status"] != "missing_reward" {
		t.Fatal("missing became zero", rows)
	}
}
