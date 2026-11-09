package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestFullHistoryPublicationParameters(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	var tuples []string
	start := time.Date(2019, 11, 15, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 3660; i++ {
		tuples = append(tuples, fmt.Sprintf("('%s','00000000-0000-0000-0000-%012d')", start.AddDate(0, 0, i).Format(time.DateOnly), i))
	}
	p := url.Values{"param_published": {"[" + strings.Join(tuples, ",") + "]"}}
	query := walletPublicationParams("WITH {published:Array(Tuple(Date,String))} AS p SELECT length(p), tupleElement(p[3660],2)", p)
	args := []string{"local", "--path", t.TempDir(), "--query", query}
	for k, values := range p {
		if len(values[0]) > 32*1024 {
			t.Fatal("oversized HTTP field", k)
		}
		args = append(args, "--"+k, values[0])
	}
	out, err := exec.Command(binary, args...).CombinedOutput()
	if err != nil || string(out) != "3660\t00000000-0000-0000-0000-000000003659\n" {
		t.Fatalf("%v: %s", err, out)
	}
}

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
			if p.Get("step") != "86400" {
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
	for _, extra := range []string{"&source=evil", "&registry=evil", "&step=1", "&activity=weekly", "&activity=daily&activity=hourly"} {
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
		args := append([]string{"local", "--path", dir, "--max_threads", "2", "--multiquery", "--param_step", step, "--param_sample_step", "60", "--query", q}, p...)
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
 CREATE TABLE gramstat.wallet_monthly(source_id String,registry String,day Date,active UInt64,calculated_at DateTime64(6)) ENGINE=Memory;
 INSERT INTO gramstat.wallet_monthly VALUES('SOURCE','REGISTRY','2024-10-13',7,now64(6));
 INSERT INTO gramstat.wallet_counts VALUES('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',3600,1728777600,3),('SOURCE','REGISTRY','2024-10-13','00000000-0000-0000-0000-000000000001',3600,1728781200,7);
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
	if r := run(strings.ReplaceAll(walletActivitySQL, "{sample_step:UInt32}", "7200")+" FORMAT JSON", "3600"); len(r) != 1 || r[0]["value"] != "7" || r[0]["utime"] != float64(1728781200) {
		t.Fatal("hourly sample must not sum hours", r)
	}
	if r := run(walletMonthlySQL+" FORMAT JSON", "86400"); len(r) != 1 || r[0]["value"] != "7" {
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

func TestWalletActivityModes(t *testing.T) {
	for _, mode := range []string{"hourly", "daily", "monthly"} {
		t.Run(mode, func(t *testing.T) {
			s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
				switch name {
				case "wallet_days":
					return json.RawMessage(`[{"day":"2024-10-13","run_id":"00000000-0000-0000-0000-000000000001","activations":"2"},{"day":"2024-10-14","run_id":"00000000-0000-0000-0000-000000000001","activations":"3"}]`), nil
				case "wallet_activated":
					return json.RawMessage(`[]`), nil
				case "wallet_activity", "wallet_monthly":
					if (name == "wallet_monthly") != (mode == "monthly") {
						t.Fatal(name, mode)
					}
					want := "86400"
					if mode == "hourly" {
						want = "3600"
					}
					if p.Get("step") != want {
						t.Fatal(p)
					}
					return json.RawMessage(`[{"utime":1728864000,"value":"7"}]`), nil
				}
				t.Fatal(name)
				return nil, nil
			}), logger())
			w := httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/wallets?from=2024-01-01T00:00:00Z&to=2024-11-01T00:00:00Z&activity="+mode, nil))
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			var result struct {
				Active struct {
					Mode              string
					WindowSeconds     int
					CoverageDays      []string
					SampleStepSeconds int
					IntervalSeconds   int
				}
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Active.Mode != mode {
				t.Fatal(result)
			}
			if mode == "monthly" && (result.Active.WindowSeconds != 2592000 || len(result.Active.CoverageDays) != 1) {
				t.Fatal(result)
			}
			if mode == "hourly" && (result.Active.WindowSeconds != 3600 || result.Active.IntervalSeconds != 3600 || result.Active.SampleStepSeconds <= 3600) {
				t.Fatal(result)
			}
		})
	}
}

func TestWalletPartialEdgesPruneInteriorDays(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	setup := `CREATE DATABASE gramstat;
CREATE TABLE gramstat.wallet_activations_mc (source_id String,registry String,day Date,run_id UUID,mc_seqno UInt32,utime UInt32,activated UInt64)
ENGINE=MergeTree ORDER BY (source_id,registry,day,run_id,mc_seqno) SETTINGS index_granularity=1024;
CREATE TABLE gramstat.wallet_activated_checkpoints (source_id String,registry String,day Date,run_id UUID,step UInt32,bucket UInt32,mc_seqno UInt32,utime UInt32,activated UInt64) ENGINE=Memory;
INSERT INTO gramstat.wallet_activations_mc SELECT 's','r',toDate('2025-01-01')+toUInt32(intDiv(number,4096)),toUUID('00000000-0000-0000-0000-000000000001'),number+1,toUnixTimestamp('2025-01-01 00:00:00','UTC')+intDiv(number,4096)*86400+modulo(number,4096)*20,number+1 FROM numbers(409600);
`
	var tuples []string
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 100; i++ {
		tuples = append(tuples, fmt.Sprintf("('%s','00000000-0000-0000-0000-000000000001')", start.AddDate(0, 0, i).Format(time.DateOnly)))
	}
	args := []string{"local", "--path", t.TempDir(), "--multiquery", "--max_threads", "2", "--param_source", "s", "--param_registry", "r", "--param_step", "86400", "--param_from_ts", fmt.Sprint(start.Unix() + 43200), "--param_to_ts", fmt.Sprint(start.AddDate(0, 0, 99).Unix() + 43200), "--param_published", "[" + strings.Join(tuples, ",") + "]", "--query", setup + walletActivatedSQL + " SETTINGS max_rows_to_read=100000 FORMAT JSON"}
	out, err := exec.Command(binary, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	var result struct {
		Data []struct {
			Value string `json:"value"`
		}
	}
	if err = json.Unmarshal(out, &result); err != nil {
		t.Fatal(err, string(out))
	}
	if len(result.Data) != 2 || result.Data[0].Value != "4096" || result.Data[1].Value != "407664" {
		t.Fatal(string(out))
	}
	for i := range args {
		if args[i] == "--query" {
			args[i+1] = walletCountSQL + " SETTINGS max_rows_to_read=100000"
		}
		if args[i] == "--param_from_ts" {
			args[i+1] = fmt.Sprint(start.AddDate(0, 0, 99).Unix())
		}
		if args[i] == "--param_to_ts" {
			args[i+1] = fmt.Sprint(start.AddDate(0, 0, 100).Unix())
		}
	}
	out, err = exec.Command(binary, args...).CombinedOutput()
	if err != nil || string(out) != "4096\n" {
		t.Fatalf("bounded single-day count: %v: %s", err, out)
	}
}
