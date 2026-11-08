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

func TestWalletEndpointAndPublicationBinding(t *testing.T) {
	calls := 0
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		calls++
		if name == "wallet_days" {
			return json.RawMessage(`[{"day":"2024-10-13","run_id":"00000000-0000-0000-0000-000000000001","activations":"2"}]`), nil
		}
		if p.Get("published") != "[('2024-10-13','00000000-0000-0000-0000-000000000001')]" {
			t.Fatal(p)
		}
		switch name {
		case "wallet_count":
			return json.RawMessage(`[{"count":2}]`), nil
		case "wallet_activated":
			if p.Get("step") != "0" {
				t.Fatal(p)
			}
			return json.RawMessage(`[{"utime":1728777601,"mc_seqno":10,"value":"9007199254740993"}]`), nil
		case "wallet_activity":
			if p.Get("step") != "60" {
				t.Fatal(p)
			}
			return json.RawMessage(`[{"utime":1728777600,"value":"0"}]`), nil
		}
		t.Fatal(name)
		return nil, nil
	}), logger())
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/wallets?from=2024-10-13T00:00:00Z&to=2024-10-13T00:10:00Z", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"value":"9007199254740993"`) || !strings.Contains(w.Body.String(), `"value":"0"`) || calls != 4 {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
	for _, extra := range []string{"&source=evil", "&registry=evil", "&step=1"} {
		w = httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/wallets?from=2024-10-13T00:00:00Z&to=2024-10-13T00:10:00Z"+extra, nil))
		if w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	s = New(readerFunc(func(_ context.Context, name string, _ url.Values) (json.RawMessage, error) {
		if name != "wallet_days" {
			t.Fatal("read unavailable rows", name)
		}
		return json.RawMessage(`[]`), nil
	}), logger())
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/wallets?from=2024-10-13T00:00:00Z&to=2024-10-14T00:00:00Z", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"coverageDays":[]`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestWalletReaderSQL(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	dir := t.TempDir()
	p := []string{"--param_source", walletSource, "--param_registry", walletRegistry, "--param_from_ts", "1728777600", "--param_to_ts", "1728864000", "--param_published", "[('2024-10-13','00000000-0000-0000-0000-000000000001')]"}
	run := func(q, step string) []map[string]any {
		t.Helper()
		args := append([]string{"local", "--path", dir, "--max_threads", "2", "--multiquery", "--param_step", step, "--query", q}, p...)
		out, e := exec.Command(binary, args...).CombinedOutput()
		if e != nil {
			t.Fatal(e, string(out))
		}
		if len(out) == 0 {
			return nil
		}
		var v struct{ Data []map[string]any }
		if e = json.Unmarshal(out, &v); e != nil {
			t.Fatal(e, string(out))
		}
		return v.Data
	}
	fixture := `CREATE DATABASE gramstat;
 CREATE TABLE gramstat.wallet_days(source_id String,registry String,day Date,run_id UUID,through_mc UInt32,calculated_at DateTime64(6),history_verified UInt8,activations UInt64) ENGINE=Memory;
 CREATE TABLE gramstat.wallet_counts(source_id String,registry String,day Date,run_id UUID,step UInt32,bucket UInt32,active UInt64) ENGINE=Memory;
 CREATE TABLE gramstat.wallet_activations_mc(source_id String,registry String,day Date,run_id UUID,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=Memory;
 CREATE TABLE gramstat.wallet_activated_checkpoints(source_id String,registry String,day Date,run_id UUID,step UInt32,bucket UInt32,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=Memory;
 INSERT INTO gramstat.wallet_days VALUES('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',12,now64(6),1,2),('SOURCE','REGISTRY','2024-10-14','00000000-0000-0000-0000-000000000002',20,now64(6),0,99);
 INSERT INTO gramstat.wallet_counts VALUES('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',60,1728777600,0),('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000002',60,1728777600,99);
 INSERT INTO gramstat.wallet_activations_mc VALUES('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',10,1728777601,4),('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',11,1728777601,5);
 INSERT INTO gramstat.wallet_activated_checkpoints VALUES('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',86400,1728777600,11,1728777601,5);`
	fixture = strings.ReplaceAll(strings.ReplaceAll(fixture, "SOURCE", walletSource), "REGISTRY", walletRegistry)
	fixture = strings.ReplaceAll(fixture, "ENGINE=Memory", "ENGINE=MergeTree ORDER BY tuple()")
	run(fixture, "0")
	if r := run(walletDaysSQL+" FORMAT JSON", "0"); len(r) != 1 || r[0]["activations"] != "2" {
		t.Fatal(r)
	}
	if r := run(walletActivitySQL+" FORMAT JSON", "60"); len(r) != 1 || r[0]["value"] != "0" {
		t.Fatal(r)
	}
	if r := run(walletCountSQL+" FORMAT JSON", "0"); r[0]["count"] != float64(2) {
		t.Fatal(r)
	}
	if r := run(walletActivatedSQL+" FORMAT JSON", "0"); len(r) != 2 || r[1]["value"] != "5" {
		t.Fatal(r)
	}
	if r := run(walletActivatedSQL+" FORMAT JSON", "86400"); len(r) != 1 || r[0]["mc_seqno"] != float64(11) {
		t.Fatal(r)
	}
}
