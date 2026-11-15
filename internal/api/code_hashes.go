package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

const codeHashSnapshotSQL = `SELECT toString(snapshot_id) AS snapshotId,observed_day AS observedDay,
 formatDateTime(started_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS startedAt,
 formatDateTime(finished_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS finishedAt,
 formatDateTime(published_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS publishedAt,
 toString(hash_count) AS hashCount,toString(indexed_accounts) AS indexedAccounts,
 source_mc_min AS observedMCMin,source_mc_max AS observedMCMax,consistency
 FROM gramstat.account_code_hash_snapshots
 WHERE source_id='mainnet-kvrocks-code-hashes-v1'
 ORDER BY finished_at DESC,snapshot_id DESC LIMIT 1`

const codeHashTopSQL = `SELECT code_hash AS codeHash,toString(n) AS accounts
 FROM gramstat.account_code_hash_counts
 ARRAY JOIN mapKeys(counts) AS code_hash,mapValues(counts) AS n
 WHERE source_id='mainnet-kvrocks-code-hashes-v1'
   AND snapshot_id={snapshot_id:UUID} AND observed_day={snapshot_day:Date}
 ORDER BY n DESC,code_hash LIMIT {limit:UInt32}`

type codeHashSnapshot struct {
	ID          string `json:"snapshotId"`
	Day         string `json:"observedDay"`
	StartedAt   string `json:"startedAt"`
	FinishedAt  string `json:"finishedAt"`
	PublishedAt string `json:"publishedAt"`
	HashCount   string `json:"hashCount"`
	Accounts    string `json:"indexedAccounts"`
	MCMin       uint32 `json:"observedMCMin"`
	MCMax       uint32 `json:"observedMCMax"`
	Consistency string `json:"consistency"`
}

type codeHashCount struct {
	Hash     string `json:"codeHash"`
	Accounts string `json:"accounts"`
}

func (s *Server) loadCodeHashes(ctx context.Context, q url.Values) ([]byte, error) {
	limit, _ := strconv.Atoi(q.Get("limit"))
	response := struct {
		SchemaVersion int               `json:"schemaVersion"`
		Network       string            `json:"network"`
		Scope         string            `json:"scope"`
		Snapshot      *codeHashSnapshot `json:"snapshot"`
		Limit         int               `json:"limit"`
		Counts        []codeHashCount   `json:"codeHashes"`
		TopAccounts   *string           `json:"topAccounts"`
		OtherAccounts *string           `json:"otherAccounts"`
		OtherHashes   *string           `json:"otherCodeHashes"`
		ServedAt      string            `json:"servedAt"`
	}{
		SchemaVersion: 1, Network: "mainnet", Scope: "latest-code-hash-indexes",
		Limit: limit, Counts: []codeHashCount{}, ServedAt: time.Now().UTC().Format(time.RFC3339),
	}
	data, err := s.reader.Read(ctx, "code_hash_snapshot", nil)
	if err != nil {
		return nil, err
	}
	var snapshots []codeHashSnapshot
	if err := json.Unmarshal(data, &snapshots); err != nil {
		return nil, err
	}
	if len(snapshots) == 0 {
		// Absence is unknown, not an observed empty network.
		return json.Marshal(response)
	}
	if len(snapshots) != 1 {
		return nil, fmt.Errorf("ambiguous code-hash snapshot")
	}
	m := snapshots[0]
	total, e1 := strconv.ParseUint(m.Accounts, 10, 64)
	hashes, e2 := strconv.ParseUint(m.HashCount, 10, 64)
	start, e3 := time.Parse(time.RFC3339Nano, m.StartedAt)
	end, e4 := time.Parse(time.RFC3339Nano, m.FinishedAt)
	day, e5 := time.Parse(time.DateOnly, m.Day)
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil || total == 0 || hashes == 0 ||
		m.ID == "" || m.Consistency != "live-index-scan" || end.Before(start) || day.Format(time.DateOnly) != start.UTC().Format(time.DateOnly) ||
		m.MCMin == 0 || m.MCMax < m.MCMin {
		return nil, fmt.Errorf("invalid code-hash snapshot metadata")
	}
	// Capture one completed UUID. A newer publication during the second query
	// must not mix its top rows with the previous snapshot's total.
	p := url.Values{"snapshot_id": {m.ID}, "snapshot_day": {m.Day}, "limit": {q.Get("limit")}}
	data, err = s.reader.Read(ctx, "code_hash_top", p)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &response.Counts); err != nil {
		return nil, err
	}
	if uint64(len(response.Counts)) != min(uint64(limit), hashes) {
		return nil, fmt.Errorf("incomplete code-hash top rows")
	}
	var sum, previous uint64
	var previousHash string
	seen := make(map[string]bool, len(response.Counts))
	for i, row := range response.Counts {
		n, err := strconv.ParseUint(row.Accounts, 10, 64)
		hash, hashErr := base64.StdEncoding.Strict().DecodeString(row.Hash)
		if err != nil || hashErr != nil || len(hash) != 32 || len(row.Hash) != 44 || seen[row.Hash] || n == 0 || n > total-sum ||
			(i > 0 && (n > previous || (n == previous && row.Hash <= previousHash))) {
			return nil, fmt.Errorf("inconsistent code-hash top rows")
		}
		sum += n
		seen[row.Hash] = true
		previous, previousHash = n, row.Hash
	}
	top, other, otherHashes := strconv.FormatUint(sum, 10), strconv.FormatUint(total-sum, 10), strconv.FormatUint(hashes-uint64(len(response.Counts)), 10)
	if otherHashes == "0" && other != "0" {
		return nil, fmt.Errorf("code-hash counts disagree with snapshot total")
	}
	response.Snapshot, response.TopAccounts, response.OtherAccounts, response.OtherHashes = &m, &top, &other, &otherHashes
	return json.Marshal(response)
}
