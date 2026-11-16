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

const typePublication = "00000000-0000-4000-8000-000000000001"
const typeLeaf = "111111111111111111111111"
const typeHash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

func typeFixture() (accountTypeSnapshot, []accountTypeNode) {
	nodes := []accountTypeNode{
		{ID: "all", Label: "All", Accounts: 9007199254741000, Hashes: 2, Inferred: 9007199254740993, Unknown: 7, Leaves: []string{typeLeaf, "unknown-no-methods"}},
		{ID: typeLeaf, Parent: "all", Label: "By get methods", Accounts: 9007199254740993, Hashes: 1, Inferred: 9007199254740993, Leaves: []string{typeLeaf}, Evidence: "get_methods", Roles: []string{"Jetton wallet"}},
		{ID: "unknown-no-methods", Parent: "all", Label: "Unknown", Accounts: 7, Hashes: 1, Unknown: 7, Leaves: []string{"unknown-no-methods"}, Evidence: "unknown"},
	}
	body, _ := json.Marshal(nodes)
	return accountTypeSnapshot{
		Publication: typePublication, CountsSnapshot: "00000000-0000-4000-8000-000000000002",
		Feature: "00000000-0000-4000-8000-000000000003", Day: "2026-11-15", FeatureDay: "2026-11-15",
		Accounts: 9007199254741000, Hashes: 2, MCMin: 100, MCMax: 102,
		Started: "2026-11-15T12:00:00Z", Finished: "2026-11-15T12:00:10Z", Published: "2026-11-15T12:00:11Z",
		ABI: strings.Repeat("a", 64), Classification: "fixture", NodesJSON: string(body),
	}, nodes
}

func TestAccountTypeHTTPAndCapturedSources(t *testing.T) {
	snapshot, _ := typeFixture()
	s := New(readerFunc(func(_ context.Context, name string, p url.Values) (json.RawMessage, error) {
		switch name {
		case "account_type_latest":
			return json.RawMessage(`[{"id":"` + typePublication + `"}]`), nil
		case "account_type_snapshot":
			if p.Get("publication") != typePublication {
				t.Fatal("publication identity lost")
			}
			b, _ := json.Marshal([]accountTypeSnapshot{snapshot})
			return b, nil
		case "account_type_member_totals", "account_type_members", "account_type_detail":
			if p.Get("feature") != snapshot.Feature || p.Get("counts_snapshot") != snapshot.CountsSnapshot {
				t.Fatal("mixed source generations", p)
			}
		}
		switch name {
		case "account_type_member_totals":
			return json.RawMessage(`[{"accounts":"9007199254740993","hashes":"1"}]`), nil
		case "account_type_members":
			return json.RawMessage(`[{"codeHash":"` + typeHash + `","codeHashHex":"` + strings.Repeat("0", 64) + `","accounts":"9007199254740993","leaf":"` + typeLeaf + `"}]`), nil
		case "account_type_detail":
			return json.RawMessage(`[{"accounts":"9007199254740993","leaf":"` + typeLeaf + `","methodsAvailable":1,"methodIds":[97026],"methodNames":[["get_wallet_data"]],"contracts":[]}]`), nil
		}
		t.Fatal(name)
		return nil, nil
	}), logger())
	for _, path := range []string{
		"/api/v1/accounts/types",
		"/api/v1/accounts/types?publication=" + typePublication + "&node=" + typeLeaf,
		"/api/v1/accounts/types?publication=" + typePublication + "&hash=" + strings.Repeat("0", 64),
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Accept", binaryContentType)
		s.ServeHTTP(w, req)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"9007199254740993"`) || !strings.Contains(w.Header().Get("Content-Type"), "application/json") {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	for _, q := range []string{"node=all", "publication=x", "publication=" + typePublication + "&node=all&limit=201",
		"publication=" + typePublication + "&hash=xyz", "from=2026-11-15", "publication=" + typePublication + "&node=all&node=all"} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/accounts/types?"+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
}

func TestTypeTreeRejectsOverlapAndCycles(t *testing.T) {
	m, nodes := typeFixture()
	if err := checkAccountTypeTree(m, nodes); err != nil {
		t.Fatal(err)
	}
	nodes[2].Leaves = nodes[1].Leaves
	if err := checkAccountTypeTree(m, nodes); err == nil {
		t.Fatal("overlapping children accepted")
	}
	m, nodes = typeFixture()
	nodes[1].Parent = nodes[1].ID
	if err := checkAccountTypeTree(m, nodes); err == nil {
		t.Fatal("parent cycle accepted")
	}
}

func TestAccountTypesRealSQL(t *testing.T) {
	binary, err := exec.LookPath("clickhouse")
	if err != nil {
		t.Skip("clickhouse-local unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	dir := t.TempDir()
	run := func(sql string) []byte {
		t.Helper()
		args := []string{"local", "--path", dir, "--max_threads", "2", "--join_use_nulls", "1", "--multiquery",
			"--param_publication", typePublication, "--param_counts_snapshot", "00000000-0000-4000-8000-000000000002",
			"--param_feature", "00000000-0000-4000-8000-000000000003", "--param_day", "2026-11-15", "--param_feature_day", "2026-11-15",
			"--param_leaves", "['" + typeLeaf + "','unknown-no-methods']", "--param_search", "", "--param_limit", "100", "--param_offset", "0",
			"--param_hash", typeHash, "--param_prefix", "A", "--query", sql}
		b, err := exec.CommandContext(ctx, binary, args...).CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, b)
		}
		return b
	}
	m, _ := typeFixture()
	tree := strings.ReplaceAll(m.NodesJSON, "'", "\\'")
	run(`CREATE DATABASE gramstat;
CREATE TABLE gramstat.account_code_hash_counts(source_id String,snapshot_id UUID,observed_day Date,prefix String,counts Map(String,UInt64))
ENGINE=MergeTree ORDER BY (source_id,snapshot_id,prefix);
CREATE TABLE gramstat.account_type_features(feature_id UUID,feature_day Date,prefix String,assignments Map(String,String),methods Map(String,Array(UInt32)))
ENGINE=MergeTree ORDER BY (feature_id,prefix);
CREATE TABLE gramstat.account_type_feature_sets(feature_id UUID,feature_day Date,contracts Map(String,String),code_contracts Map(String,Array(String)),
method_names Map(UInt32,Array(String)),methods_started_at DateTime64(6,'UTC'),methods_finished_at DateTime64(6,'UTC'))
ENGINE=MergeTree ORDER BY feature_id;
CREATE TABLE gramstat.account_type_snapshots(publication_id UUID,source_id String,counts_snapshot_id UUID,observed_day Date,feature_id UUID,feature_day Date,
abi_revision String,classification_version String,started_at DateTime64(6,'UTC'),finished_at DateTime64(6,'UTC'),published_at DateTime64(6,'UTC'),
indexed_accounts UInt64,hash_count UInt64,source_mc_min UInt32,source_mc_max UInt32,nodes_json String)
ENGINE=MergeTree ORDER BY (source_id,publication_id);
INSERT INTO gramstat.account_code_hash_counts VALUES
('mainnet-kvrocks-code-hashes-v1','00000000-0000-4000-8000-000000000002','2026-11-15','A',{'` + typeHash + `':9007199254740993,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=':7});
INSERT INTO gramstat.account_type_features VALUES
('00000000-0000-4000-8000-000000000003','2026-11-15','A',{'` + typeHash + `':'` + typeLeaf + `'},{'` + typeHash + `':[97026]});
INSERT INTO gramstat.account_type_feature_sets VALUES
('00000000-0000-4000-8000-000000000003','2026-11-15',map(),map(),{97026:['get_wallet_data']},'2026-11-15 12:00:00','2026-11-15 12:00:10');
INSERT INTO gramstat.account_type_snapshots VALUES
('` + typePublication + `','mainnet-kvrocks-code-hashes-v1','00000000-0000-4000-8000-000000000002','2026-11-15',
'00000000-0000-4000-8000-000000000003','2026-11-15','` + strings.Repeat("a", 64) + `','fixture',
'2026-11-15 12:00:00','2026-11-15 12:00:10','2026-11-15 12:00:11',9007199254741000,2,100,102,'` + tree + `');`)
	for _, sql := range []string{accountTypeLatestSQL, accountTypeSnapshotSQL, accountTypeMemberTotalsSQL, accountTypeMembersSQL, accountTypeDetailSQL} {
		b := run(sql + " FORMAT JSONEachRow")
		if len(b) == 0 {
			t.Fatal("empty result", sql)
		}
	}
	for _, tc := range []struct{ sql, want string }{
		{accountTypeMemberTotalsSQL, `"accounts":"9007199254741000"`},
		{accountTypeDetailSQL, `"methodsAvailable":1`},
		{accountTypeMembersSQL, `"leaf":"unknown-no-methods"`},
	} {
		b := run(tc.sql + " FORMAT JSONEachRow")
		if !strings.Contains(string(b), tc.want) {
			t.Fatal(fmt.Sprintf("missing %s: %s", tc.want, b))
		}
	}
}
