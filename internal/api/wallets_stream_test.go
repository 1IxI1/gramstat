package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"testing"
)

const walletStreamFixtureSQL = `
CREATE TABLE gramstat.wallet_activation_stream(source_id String,registry String,day Date,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=MergeTree ORDER BY (source_id,registry,day,mc_seqno);
CREATE TABLE gramstat.wallet_activation_stream_checkpoints(source_id String,registry String,day Date,step UInt32,bucket UInt32,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=MergeTree ORDER BY (source_id,registry,step,day,bucket,mc_seqno);
CREATE TABLE gramstat.wallet_activation_stream_state(source_id String,registry String,base_mc UInt32,from_utime UInt32,through_mc UInt32,to_utime UInt32,day Date,activations Nullable(UInt64),complete_before UInt32) ENGINE=MergeTree ORDER BY (source_id,registry,through_mc);
`

func TestLiveActivationSnapshotWithoutClosedDay(t *testing.T) {
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		switch name {
		case "wallet_activation_state":
			return json.RawMessage(`[{"base_mc":10,"through_mc":12,"from_utime":1794441599,"to_utime":1794441660}]`), nil
		case "wallet_days", "wallet_active_days":
			return json.RawMessage(`[]`), nil
		case "wallet_live_activations":
			return json.RawMessage(`[{"day":"2026-11-12","activations":"2","complete_before":1794441900}]`), nil
		case "wallet_count":
			return json.RawMessage(`[{"count":2}]`), nil
		case "wallet_activated":
			if p.Get("published") != "[]" || p.Get("live_end") != "12" || p.Get("step") != "0" {
				t.Fatal(p)
			}
			return json.RawMessage(`[{"mc_seqno":11,"utime":1794441660,"value":"9007199254740994"},{"mc_seqno":12,"utime":1794441660,"value":"9007199254740995"}]`), nil
		default:
			t.Fatal(name)
			return nil, nil
		}
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/wallets?from=2026-11-12T00:00:00Z&to=2026-11-12T01:00:00Z", nil))
	var result struct {
		Activated struct {
			CoverageDays []string
			Points       []struct{ Value string }
		}
		Activations struct {
			CoverageDays []string
			Points       []struct {
				Partial bool `json:"is_partial"`
				Value   string
			}
		}
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(result.Activated.CoverageDays) != 1 || len(result.Activated.Points) != 2 || result.Activated.Points[1].Value != "9007199254740995" || len(result.Activations.CoverageDays) != 1 || !result.Activations.Points[0].Partial {
		t.Fatal(w.Body.String())
	}
}

func TestActivationStreamSQLCapsFutureCheckpointAndDeduplicatesRetry(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	path := t.TempDir()
	run := func(q, step string) string {
		t.Helper()
		out, e := exec.Command(binary, "local", "--path", path, "--multiquery", "--max_threads", "2", "--param_source", "s", "--param_registry", "r", "--param_from_ts", "1794441600", "--param_to_ts", "1794445200", "--param_step", step, "--param_published", "[]", "--param_live_base", "10", "--param_live_end", "12", "--query", q).CombinedOutput()
		if e != nil {
			t.Fatal(e, string(out))
		}
		return string(out)
	}
	run(`CREATE DATABASE gramstat;`+walletStreamFixtureSQL+`
CREATE TABLE gramstat.wallet_activations_mc(source_id String,registry String,day Date,run_id UUID,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=MergeTree ORDER BY tuple();
CREATE TABLE gramstat.wallet_activated_checkpoints(source_id String,registry String,day Date,run_id UUID,step UInt32,bucket UInt32,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=MergeTree ORDER BY tuple();
INSERT INTO gramstat.wallet_activation_stream VALUES('s','r','2026-11-12',11,1794441660,9007199254740994),('s','r','2026-11-12',11,1794441660,9007199254740994),('s','r','2026-11-12',12,1794441660,9007199254740995),('s','r','2026-11-12',13,1794441720,9999999999999999);
INSERT INTO gramstat.wallet_activation_stream_checkpoints SELECT source_id,registry,day,3600,1794441600,mc_seqno,utime,activated FROM gramstat.wallet_activation_stream;
INSERT INTO gramstat.wallet_activation_stream_state VALUES('s','r',10,1794441599,12,1794441660,'2026-11-12',2,1794441900);
`, "0")
	if got := run(walletCountSQL, "0"); got != "2\n" {
		t.Fatal(got)
	}
	if got := run(walletActivatedSQL, "0"); got != "11\t1794441660\t9007199254740994\n12\t1794441660\t9007199254740995\n" {
		t.Fatal(got)
	}
	if got := run(walletActivatedSQL, "3600"); got != "12\t1794441660\t9007199254740995\n" {
		t.Fatal("uncommitted checkpoint visible", got)
	}
	if got := run(walletLiveActivationsSQL, "0"); got != "2026-11-12\t2\t1794441900\n" {
		t.Fatal(got)
	}
}
