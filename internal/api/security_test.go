package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestRejectedRequestsNeverReadDatabase(t *testing.T) {
	s := New(readerFunc(func(context.Context, string, url.Values) (json.RawMessage, error) {
		t.Fatal("rejected request reached ClickHouse")
		return nil, nil
	}), logger())
	for _, tc := range []struct {
		method, target, body string
		chunked              bool
		status               int
	}{
		{"POST", "/api/v1/coverage", "", false, 405},
		{"GET", "/api/v1/coverage", "ignored SQL", false, 400},
		{"HEAD", "/api/health", "body", false, 400},
		{"GET", "/api/v1/coverage", "", true, 400},
		{"GET", "/api/v1/coverage?" + strings.Repeat("x", 2048), "", false, 414},
		{"GET", "/api/v1/coverage?query=SELECT+1", "", false, 400},
		{"GET", "/api/v1/accounts/types?limit=1&limit=2", "", false, 400},
		{"GET", "/api/v1/accounts/types?publication=%27+OR+1%3D1", "", false, 400},
		{"GET", "/debug/pprof/", "", false, 404},
	} {
		r := httptest.NewRequest(tc.method, tc.target, strings.NewReader(tc.body))
		if tc.chunked {
			r.ContentLength = -1
			r.TransferEncoding = []string{"chunked"}
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s %s: status %d, want %d", tc.method, tc.target, w.Code, tc.status)
		}
	}
}

func TestDeploymentGrantsMatchFixedQuerySurface(t *testing.T) {
	data, err := os.ReadFile("../../deploy/clickhouse-api-grants.sql")
	if err != nil {
		t.Fatal(err)
	}
	grantPattern := regexp.MustCompile(`(?m)^GRANT SELECT(?:\([^;]+\))?\s+ON ([a-z_]+\.[a-z_]+) TO gramstat_api;`)
	grants := map[string]bool{}
	for _, match := range grantPattern.FindAllStringSubmatch(string(data), -1) {
		grants[match[1]] = true
	}
	references := regexp.MustCompile(`(?i)\b(?:FROM|JOIN)\s+([a-z_]+\.[a-z_]+)\b`)
	used := map[string]bool{}
	for name, query := range queries {
		for _, match := range references.FindAllStringSubmatch(query, -1) {
			table := match[1]
			if !strings.HasPrefix(table, "gramstat.") && table != "gramstat_full.account_deltas" && table != "mainnet_gramstat_full.blocks" {
				t.Errorf("%s reads outside approved Gramstat databases: %s", name, table)
			}
			if !grants[table] {
				t.Errorf("%s has no deployment grant for %s", name, table)
			}
			used[table] = true
		}
	}
	for table := range grants {
		if !used[table] {
			t.Errorf("unused database grant: %s", table)
		}
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "GRANT ") && !strings.HasPrefix(line, "GRANT SELECT") {
			t.Errorf("non-read grant: %s", line)
		}
		if !strings.HasPrefix(line, "--") && strings.Contains(line, "*") {
			t.Errorf("wildcard grant: %s", line)
		}
	}
}
