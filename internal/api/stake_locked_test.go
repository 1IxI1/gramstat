package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"testing"
	"time"
)

func TestLockedStakeReadProofsExactMoneyAndUnknownSplit(t *testing.T) {
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
 (1792561664,1792627200,10,'prev','prev',now64(6),1792627200),
 (1792627200,1792692736,10,'now','now',now64(6),1792627300);
INSERT INTO gramstat.validator_stake_rounds (utime_since,utime_until,selected_nanogram,config34_hash,roster_digest,status,calculated_at) VALUES
 (1792561664,1792627200,1000,'prev','prev','complete',now64(6)),
 (1792627200,1792692736,900719925474099312345,'now','now','missing_result',now64(6));
INSERT INTO gramstat.validator_stake_locked_rounds VALUES
 (1792627200,1792692736,1792561664,'now','now','prev','prev',900719925474099312345,1000,
 900719925474099313345,0,1,900719925474099313344,{'Whales-like':1},20,20,19,1792627300,1,'partial_attribution','stake-locked-v1',now64(6));`)
	for _, name := range []string{"rounds", "validators"} {
		rows := run(queries[name] + " FORMAT JSON")
		if len(rows) != 1 || rows[0]["locked_total_nanogram"] != "900719925474099313345" || rows[0]["locked_telegram_nanogram"] != "0" || rows[0]["locked_previous_selected_nanogram"] != "1000" {
			t.Fatal(name, rows)
		}
		if rows[0]["locked_pool_breakdown"].(map[string]any)["Whales-like"] != "1" {
			t.Fatal("map money is not a string", rows)
		}
	}
	run("ALTER TABLE gramstat.validator_stake_locked_rounds UPDATE telegram_nanogram=NULL,pools_nanogram=NULL,others_nanogram=NULL,status='missing_attribution' WHERE 1 SETTINGS mutations_sync=1")
	if r := run(queries["rounds"] + " FORMAT JSON")[0]; r["locked_total_nanogram"] == nil || r["locked_pools_nanogram"] != nil {
		t.Fatal("known total/unknown split mixed", r)
	}
	run("ALTER TABLE gramstat.validator_stake_rounds UPDATE selected_nanogram=1001 WHERE utime_since=1792561664 SETTINGS mutations_sync=1")
	if r := run(queries["rounds"] + " FORMAT JSON")[0]; r["locked_total_nanogram"] != nil {
		t.Fatal("stale predecessor stake exposed", r)
	}
	run("ALTER TABLE gramstat.validator_stake_rounds UPDATE selected_nanogram=1000 WHERE utime_since=1792561664 SETTINGS mutations_sync=1; ALTER TABLE gramstat.validator_rounds UPDATE config34_hash='corrected' WHERE utime_since=1792561664 SETTINGS mutations_sync=1")
	if r := run(queries["validators"] + " FORMAT JSON")[0]; r["locked_total_nanogram"] != nil {
		t.Fatal("stale predecessor proof exposed", r)
	}
}

func TestLongRoundReadsDeduplicateBoundaryRound(t *testing.T) {
	for _, name := range []string{"validators", "rounds"} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				q := r.URL.Query()
				from, _ := time.Parse(time.DateOnly, q.Get("param_from"))
				to, _ := time.Parse(time.DateOnly, q.Get("param_to"))
				if to.Sub(from) > 732*24*time.Hour || !to.After(from) {
					t.Error("unbounded interval", q)
				}
				calls++
				if calls == 1 {
					io.WriteString(w, `{"data":[{"utime_since":100,"locked_total_nanogram":"9007199254740993"},{"utime_since":200,"locked_total_nanogram":null}]}`)
				} else {
					io.WriteString(w, `{"data":[{"utime_since":200,"locked_total_nanogram":null},{"utime_since":300,"locked_total_nanogram":"0"}]}`)
				}
			}))
			defer srv.Close()
			ch, _ := NewClickHouse(srv.URL, "", "")
			b, err := (ClickHouseReader{CH: ch}).Read(context.Background(), name, url.Values{"from": {"2023-01-01"}, "to": {"2027-01-01"}})
			if err != nil {
				t.Fatal(err)
			}
			var rows []map[string]any
			if err = json.Unmarshal(b, &rows); err != nil {
				t.Fatal(err)
			}
			if calls != 2 || len(rows) != 3 || rows[0]["locked_total_nanogram"] != "9007199254740993" || rows[1]["locked_total_nanogram"] != nil || rows[2]["locked_total_nanogram"] != "0" {
				t.Fatal(calls, string(b))
			}
		})
	}
}
