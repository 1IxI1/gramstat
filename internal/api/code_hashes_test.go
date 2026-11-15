package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const codeSnapshotFixture = `[{
 "snapshotId":"00000000-0000-4000-8000-000000000001","observedDay":"2026-11-15",
 "startedAt":"2026-11-15T12:00:00.000000Z","finishedAt":"2026-11-15T12:00:20.000000Z",
 "publishedAt":"2026-11-15T12:00:21.000000Z","hashCount":"3","indexedAccounts":"9007199254741000",
 "observedMCMin":100,"observedMCMax":102,"consistency":"live-index-scan"
}]`

const codeTopFixture = `[
 {"codeHash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","accounts":"9007199254740993"},
 {"codeHash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=","accounts":"5"}
]`

func TestCodeHashTopExactRemainderAndCapturedSnapshot(t *testing.T) {
	calls := 0
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		calls++
		if name == "code_hash_snapshot" {
			return json.RawMessage(codeSnapshotFixture), nil
		}
		if name != "code_hash_top" || p.Get("snapshot_id") != "00000000-0000-4000-8000-000000000001" ||
			p.Get("snapshot_day") != "2026-11-15" || p.Get("limit") != "2" {
			t.Fatal("lost captured identity", name, p)
		}
		return json.RawMessage(codeTopFixture), nil
	}), logger())
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts/code-hashes?limit=2", nil))
		body := w.Body.String()
		if w.Code != 200 || !strings.Contains(body, `"topAccounts":"9007199254740998"`) ||
			!strings.Contains(body, `"otherAccounts":"2"`) || !strings.Contains(body, `"otherCodeHashes":"1"`) {
			t.Fatal(w.Code, body)
		}
	}
	if calls != 2 {
		t.Fatal("snapshot response not cached")
	}
}

func TestCodeHashBoundsAbsenceAndInvalidRows(t *testing.T) {
	s := New(readerFunc(func(context.Context, string, url.Values) (json.RawMessage, error) {
		return json.RawMessage(`[]`), nil
	}), logger())
	for _, q := range []string{"limit=0", "limit=1001", "limit=x", "limit=1&limit=2", "from=2026-11-15", "sql=x"} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts/code-hashes?"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts/code-hashes", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"snapshot":null`) || !strings.Contains(w.Body.String(), `"otherAccounts":null`) {
		t.Fatal(w.Body.String())
	}
	for _, top := range []string{
		`[]`,
		strings.Replace(codeTopFixture, `"5"`, `"50"`, 1),
		strings.Replace(codeTopFixture, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1),
	} {
		s := New(readerFunc(func(_ context.Context, name string, _ url.Values) (json.RawMessage, error) {
			if name == "code_hash_snapshot" {
				return json.RawMessage(codeSnapshotFixture), nil
			}
			return json.RawMessage(top), nil
		}), logger())
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts/code-hashes?limit=2", nil))
		if w.Code != 503 {
			t.Fatal("inconsistent distribution was published", w.Code, w.Body.String())
		}
	}
}

func TestCodeHashQueriesWithClickHouse(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	dir := t.TempDir()
	run := func(query string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, "local", "--path", dir, "--multiquery", "--max_threads", "2",
			"--param_snapshot_id", "00000000-0000-4000-8000-000000000001", "--param_snapshot_day", "2026-11-15", "--param_limit", "2", "--query", query)
		b, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, b)
		}
		return b
	}
	run(`CREATE DATABASE gramstat;
 CREATE TABLE gramstat.account_code_hash_counts(source_id String,snapshot_id UUID,observed_day Date,prefix String,counts Map(String,UInt64))
 ENGINE=MergeTree ORDER BY (source_id,snapshot_id,prefix);
 CREATE TABLE gramstat.account_code_hash_snapshots(source_id String,snapshot_id UUID,observed_day Date,
 started_at DateTime64(6,'UTC'),finished_at DateTime64(6,'UTC'),published_at DateTime64(6,'UTC'),
 hash_count UInt64,indexed_accounts UInt64,source_mc_min UInt32,source_mc_max UInt32,consistency String)
 ENGINE=MergeTree ORDER BY (source_id,finished_at,snapshot_id);
 INSERT INTO gramstat.account_code_hash_snapshots VALUES
 ('mainnet-kvrocks-code-hashes-v1','00000000-0000-4000-8000-000000000001','2026-11-15','2026-11-15 12:00:00','2026-11-15 12:00:20','2026-11-15 12:00:21',3,9007199254741000,100,102,'live-index-scan');
 INSERT INTO gramstat.account_code_hash_counts VALUES
 ('mainnet-kvrocks-code-hashes-v1','00000000-0000-4000-8000-000000000001','2026-11-15','A',
 {'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=':9007199254740993,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=':5,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=':2}),
 ('mainnet-kvrocks-code-hashes-v1','00000000-0000-4000-8000-000000000002','2026-11-15','A',{'orphan':999999999});
 `)
	var metadata codeHashSnapshot
	if err := json.Unmarshal(run(codeHashSnapshotSQL+" FORMAT JSONEachRow"), &metadata); err != nil ||
		metadata.ID != "00000000-0000-4000-8000-000000000001" || metadata.Accounts != "9007199254741000" {
		t.Fatal(metadata, err)
	}
	var result struct {
		Data []codeHashCount `json:"data"`
	}
	if err := json.Unmarshal(run(codeHashTopSQL+" FORMAT JSON"), &result); err != nil ||
		len(result.Data) != 2 || result.Data[0].Accounts != "9007199254740993" || result.Data[1].Accounts != "5" {
		t.Fatal(result, err)
	}
}
