package api

import (
	"context"
	"encoding/json"
	"os/exec"
	"testing"
	"time"
)

func TestStakeChangesSQLDoesNotBridgeMissingOrStaleHistory(t *testing.T) {
	bin, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	dir := t.TempDir()
	run := func(q string) []map[string]any {
		t.Helper()
		b, err := exec.CommandContext(ctx, bin, "local", "--path", dir, "--max_threads", "2", "--multiquery", "--join_use_nulls", "1", "--param_from", "2026-10-22", "--param_to", "2026-10-23", "--query", q).CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, b)
		}
		if len(b) == 0 {
			return nil
		}
		var v struct {
			Data []map[string]any `json:"data"`
		}
		if err = json.Unmarshal(b, &v); err != nil {
			t.Fatal(err, string(b))
		}
		return v.Data
	}
	run(schema + stakeChangesFixture + stakeLockedFixture + `
INSERT INTO gramstat.validator_rounds (utime_since,utime_until,total,config34_hash,roster_digest,calculated_at,data_through) VALUES
(1792496128,1792561664,10,'old','old',now64(6),1792561664),
(1792561664,1792627200,10,'mid','mid',now64(6),1792627200),
(1792627200,1792692736,10,'now','now',now64(6),1792627200);
INSERT INTO gramstat.validator_stake_rounds (utime_since,utime_until,selected_nanogram,remaining_nanogram,reward_nanogram,unfreeze_mc_seqno,config34_hash,roster_digest,status,calculated_at) VALUES
(1792496128,1792561664,1000,1000,100,30,'old','old','complete',now64(6)),
(1792627200,1792692736,1100,NULL,NULL,NULL,'now','now','missing_result',now64(6));
INSERT INTO gramstat.validator_stake_changes VALUES
(1792627200,1792692736,'now','now',1792496128,1792561664,'old','old','mid','mid',1100,1000,1000,100,30,6,6,5,1,1,1,1,1,1,1,'complete','stake-changes-v1',now64(6));`)
	for _, name := range []string{"validators", "rounds"} {
		r := run(queries[name] + " FORMAT JSON")
		if len(r) != 1 || r[0]["stake_change_matched"] != float64(5) || r[0]["stake_change_near_reward"] != float64(1) {
			t.Fatal(name, r)
		}
	}
	run("ALTER TABLE gramstat.validator_stake_rounds UPDATE reward_nanogram=101 WHERE utime_since=1792496128 SETTINGS mutations_sync=1")
	if r := run(queries["validators"] + " FORMAT JSON"); r[0]["stake_change_matched"] != nil {
		t.Fatal("stale reward exposed", r)
	}
	run("ALTER TABLE gramstat.validator_stake_rounds UPDATE reward_nanogram=100 WHERE utime_since=1792496128 SETTINGS mutations_sync=1; ALTER TABLE gramstat.validator_rounds UPDATE config34_hash='corrected' WHERE utime_since=1792561664 SETTINGS mutations_sync=1")
	if r := run(queries["rounds"] + " FORMAT JSON"); r[0]["stake_change_near_reward"] != nil {
		t.Fatal("missing middle proof bridged", r)
	}
}
