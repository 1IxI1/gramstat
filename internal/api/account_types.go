package api

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const accountTypeLatestSQL = `SELECT toString(publication_id) AS id
 FROM gramstat.account_type_snapshots
 WHERE source_id='mainnet-kvrocks-code-hashes-v1'
 ORDER BY finished_at DESC,published_at DESC,publication_id DESC LIMIT 1`

const accountTypeSnapshotSQL = `SELECT toString(publication_id) AS publicationId,
 toString(counts_snapshot_id) AS countsSnapshotId,toString(observed_day) AS observedDay,
 toString(feature_id) AS featureId,toString(feature_day) AS featureDay,
 abi_revision AS abiRevision,classification_version AS classificationVersion,
 formatDateTime(started_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS startedAt,
 formatDateTime(finished_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS finishedAt,
 formatDateTime(published_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS publishedAt,
 toString(indexed_accounts) AS indexedAccounts,toString(hash_count) AS hashCount,
 source_mc_min AS observedMCMin,source_mc_max AS observedMCMax,nodes_json AS nodesJSON
 FROM gramstat.account_type_snapshots
 WHERE source_id='mainnet-kvrocks-code-hashes-v1' AND publication_id={publication:UUID}`

const accountTypeMembersFromSQL = `FROM (
 SELECT c.hash AS codeHash,lower(hex(base64Decode(c.hash))) AS codeHashHex,n,
 coalesce(nullIf(f.leaf,''),'unknown-no-methods') AS leaf
 FROM (
   SELECT hash,n FROM gramstat.account_code_hash_counts
   ARRAY JOIN mapKeys(counts) AS hash,mapValues(counts) AS n
   WHERE source_id='mainnet-kvrocks-code-hashes-v1'
     AND snapshot_id={counts_snapshot:UUID} AND observed_day={day:Date}
 ) AS c LEFT JOIN (
   SELECT hash,leaf FROM gramstat.account_type_features
   ARRAY JOIN mapKeys(assignments) AS hash,mapValues(assignments) AS leaf
   WHERE feature_id={feature:UUID} AND feature_day={feature_day:Date}
 ) AS f ON c.hash=f.hash
 ) WHERE leaf IN {leaves:Array(String)}
 AND ({search:String}='' OR positionCaseInsensitive(codeHashHex,{search:String})>0
      OR position(codeHash,{search:String})>0)`

const accountTypeMemberTotalsSQL = `SELECT toString(sum(n)) AS accounts,toString(count()) AS hashes ` + accountTypeMembersFromSQL
const accountTypeMembersSQL = `SELECT codeHash,codeHashHex,toString(n) AS accounts,leaf ` + accountTypeMembersFromSQL + `
 ORDER BY n DESC,codeHash LIMIT {limit:UInt32} OFFSET {offset:UInt32}`

const accountTypeDetailSQL = `SELECT toString(c.counts[{hash:String}]) AS accounts,
 if(mapContains(f.assignments,{hash:String}),f.assignments[{hash:String}],'unknown-no-methods') AS leaf,
 toUInt8(mapContains(f.methods,{hash:String})) AS methodsAvailable,
 f.methods[{hash:String}] AS methodIds,
 arrayMap(id->s.method_names[id],f.methods[{hash:String}]) AS methodNames,
 arrayMap(id->s.contracts[id],s.code_contracts[{hash:String}]) AS contracts,
 formatDateTime(s.methods_started_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS methodsStartedAt,
 formatDateTime(s.methods_finished_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC') AS methodsFinishedAt
 FROM (
   SELECT prefix,counts FROM gramstat.account_code_hash_counts
   WHERE source_id='mainnet-kvrocks-code-hashes-v1' AND snapshot_id={counts_snapshot:UUID}
     AND observed_day={day:Date} AND prefix={prefix:String}
 ) AS c INNER JOIN (
   SELECT prefix,assignments,methods FROM gramstat.account_type_features
   WHERE feature_id={feature:UUID} AND feature_day={feature_day:Date} AND prefix={prefix:String}
 ) AS f ON c.prefix=f.prefix
 CROSS JOIN (
   SELECT contracts,code_contracts,method_names,methods_started_at,methods_finished_at
   FROM gramstat.account_type_feature_sets
   WHERE feature_id={feature:UUID} AND feature_day={feature_day:Date}
 ) AS s
 WHERE mapContains(c.counts,{hash:String})`

type accountTypeSnapshot struct {
	Publication    string `json:"publicationId"`
	CountsSnapshot string `json:"countsSnapshotId"`
	Day            string `json:"observedDay"`
	Feature        string `json:"featureId"`
	FeatureDay     string `json:"featureDay"`
	ABI            string `json:"abiRevision"`
	Classification string `json:"classificationVersion"`
	Started        string `json:"startedAt"`
	Finished       string `json:"finishedAt"`
	Published      string `json:"publishedAt"`
	Accounts       uint64 `json:"indexedAccounts,string"`
	Hashes         uint64 `json:"hashCount,string"`
	MCMin          uint32 `json:"observedMCMin"`
	MCMax          uint32 `json:"observedMCMax"`
	NodesJSON      string `json:"nodesJSON,omitempty"`
}

type accountTypeNode struct {
	ID       string   `json:"id"`
	Parent   string   `json:"parent"`
	Label    string   `json:"label"`
	Accounts uint64   `json:"accounts,string"`
	Hashes   uint64   `json:"hashes,string"`
	Known    uint64   `json:"known,string"`
	Inferred uint64   `json:"inferred,string"`
	Unknown  uint64   `json:"unknown,string"`
	Leaves   []string `json:"leaves"`
	Roles    []string `json:"roles,omitempty"`
	Evidence string   `json:"evidence,omitempty"`
}

var publicationPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var typeNodePattern = regexp.MustCompile(`^(all|unknown-no-methods|[0-9a-f]{24})$`)

func validateAccountTypes(q url.Values) error {
	for key, values := range q {
		if len(values) != 1 || !slices.Contains([]string{"publication", "node", "hash", "limit", "offset", "search"}, key) {
			return fmt.Errorf("unexpected or repeated parameters")
		}
	}
	if q.Has("publication") && !publicationPattern.MatchString(q.Get("publication")) {
		return fmt.Errorf("publication must be a UUID")
	}
	if (q.Has("node") || q.Has("hash")) && !q.Has("publication") {
		return fmt.Errorf("drill-down requires a captured publication")
	}
	if q.Has("node") && !typeNodePattern.MatchString(q.Get("node")) {
		return fmt.Errorf("invalid node")
	}
	if q.Has("hash") {
		if q.Has("node") || q.Has("limit") || q.Has("offset") || q.Has("search") {
			return fmt.Errorf("hash details cannot be combined with pagination")
		}
		hash := q.Get("hash")
		var b []byte
		var err error
		if len(hash) == 64 {
			b, err = hex.DecodeString(hash)
		} else {
			b, err = base64.StdEncoding.Strict().DecodeString(hash)
		}
		if err != nil || len(b) != 32 {
			return fmt.Errorf("hash must be 32-byte hex or base64")
		}
		q.Set("hash", base64.StdEncoding.EncodeToString(b))
		return nil
	}
	if !q.Has("node") && (q.Has("limit") || q.Has("offset") || q.Has("search")) {
		return fmt.Errorf("pagination requires a node")
	}
	if q.Has("node") {
		for _, spec := range []struct {
			key           string
			def, min, max int
		}{{"limit", 100, 1, 200}, {"offset", 0, 0, 5_000_000}} {
			n := spec.def
			if q.Has(spec.key) {
				var err error
				n, err = strconv.Atoi(q.Get(spec.key))
				if err != nil || n < spec.min || n > spec.max {
					return fmt.Errorf("invalid %s", spec.key)
				}
			}
			q.Set(spec.key, strconv.Itoa(n))
		}
		if len(q.Get("search")) > 64 || strings.ContainsAny(q.Get("search"), "\x00\r\n") {
			return fmt.Errorf("search must be at most 64 characters")
		}
	}
	return nil
}

func checkAccountTypeTree(m accountTypeSnapshot, nodes []accountTypeNode) error {
	byID := map[string]accountTypeNode{}
	for _, n := range nodes {
		if !typeNodePattern.MatchString(n.ID) || n.Label == "" || len(n.Leaves) == 0 || n.Accounts == 0 || n.Hashes == 0 ||
			n.Known > n.Accounts || n.Inferred > n.Accounts-n.Known || n.Unknown != n.Accounts-n.Known-n.Inferred {
			return fmt.Errorf("invalid prepared account-type node")
		}
		if _, duplicate := byID[n.ID]; duplicate {
			return fmt.Errorf("duplicate account-type node")
		}
		for _, leaf := range n.Leaves {
			if !typeNodePattern.MatchString(leaf) || leaf == "all" {
				return fmt.Errorf("invalid prepared leaf")
			}
		}
		byID[n.ID] = n
	}
	root, ok := byID["all"]
	if !ok || root.Parent != "" || root.Accounts != m.Accounts || root.Hashes != m.Hashes {
		return fmt.Errorf("account-type root differs from publication")
	}
	for _, n := range nodes {
		if n.ID != "all" {
			if _, ok := byID[n.Parent]; !ok {
				return fmt.Errorf("account-type parent missing")
			}
			at := n
			for depth := 0; at.ID != "all"; depth++ {
				if depth > 12 {
					return fmt.Errorf("account-type parent cycle")
				}
				at = byID[at.Parent]
			}
		}
		var accounts, hashes, known, inferred, unknown uint64
		leaves := map[string]bool{}
		children := 0
		for _, child := range nodes {
			if child.Parent != n.ID {
				continue
			}
			children++
			if child.Accounts > n.Accounts-accounts || child.Hashes > n.Hashes-hashes {
				return fmt.Errorf("account-type children exceed parent")
			}
			accounts += child.Accounts
			hashes += child.Hashes
			known += child.Known
			inferred += child.Inferred
			unknown += child.Unknown
			for _, leaf := range child.Leaves {
				if leaves[leaf] || !slices.Contains(n.Leaves, leaf) {
					return fmt.Errorf("overlapping account-type children")
				}
				leaves[leaf] = true
			}
		}
		if children > 0 && (accounts != n.Accounts || hashes != n.Hashes || known != n.Known ||
			inferred != n.Inferred || unknown != n.Unknown || len(leaves) != len(n.Leaves)) {
			return fmt.Errorf("non-additive account-type tree")
		}
		if children == 0 && (len(n.Leaves) != 1 || n.Leaves[0] != n.ID) {
			return fmt.Errorf("invalid terminal account-type node")
		}
	}
	return nil
}

func (s *Server) loadAccountTypes(ctx context.Context, q url.Values) ([]byte, error) {
	publication := q.Get("publication")
	if publication == "" {
		raw, err := s.reader.Read(ctx, "account_type_latest", nil)
		if err != nil {
			return nil, err
		}
		var latest []struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &latest); err != nil {
			return nil, err
		}
		if len(latest) == 0 {
			return []byte(`{"schemaVersion":1,"network":"mainnet","scope":"latest-code-hash-indexes","snapshot":null,"nodes":[]}`), nil
		}
		if len(latest) != 1 || !publicationPattern.MatchString(latest[0].ID) {
			return nil, fmt.Errorf("invalid latest type publication")
		}
		publication = latest[0].ID
	}
	raw, err := s.reader.Read(ctx, "account_type_snapshot", url.Values{"publication": {publication}})
	if err != nil {
		return nil, err
	}
	var snapshots []accountTypeSnapshot
	if err := json.Unmarshal(raw, &snapshots); err != nil {
		return nil, err
	}
	if len(snapshots) != 1 {
		return nil, fmt.Errorf("account-type publication unavailable")
	}
	m := snapshots[0]
	if m.Publication != publication || !publicationPattern.MatchString(m.CountsSnapshot) ||
		!publicationPattern.MatchString(m.Feature) || m.Accounts == 0 || m.Hashes == 0 {
		return nil, fmt.Errorf("invalid account-type publication")
	}
	var nodes []accountTypeNode
	if err := json.Unmarshal([]byte(m.NodesJSON), &nodes); err != nil {
		return nil, err
	}
	if err := checkAccountTypeTree(m, nodes); err != nil {
		return nil, err
	}
	m.NodesJSON = ""
	response := map[string]any{"schemaVersion": 1, "network": "mainnet", "scope": "latest-code-hash-indexes",
		"consistency": "live-index-scan", "snapshot": m}
	if !q.Has("node") && !q.Has("hash") {
		response["nodes"] = nodes
		return json.Marshal(response)
	}
	p := url.Values{
		"counts_snapshot": {m.CountsSnapshot}, "day": {m.Day},
		"feature": {m.Feature}, "feature_day": {m.FeatureDay},
	}
	if q.Has("hash") {
		hash := q.Get("hash")
		p.Set("hash", hash)
		p.Set("prefix", hash[:1])
		raw, err := s.reader.Read(ctx, "account_type_detail", p)
		if err != nil {
			return nil, err
		}
		var rows []struct {
			Accounts    uint64     `json:"accounts,string"`
			Leaf        string     `json:"leaf"`
			Available   uint8      `json:"methodsAvailable"`
			MethodIDs   []uint32   `json:"methodIds"`
			MethodNames [][]string `json:"methodNames"`
			Contracts   []string   `json:"contracts"`
			Started     string     `json:"methodsStartedAt"`
			Finished    string     `json:"methodsFinishedAt"`
		}
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			response["detail"] = nil
			return json.Marshal(response)
		}
		if len(rows) != 1 || len(rows[0].MethodIDs) != len(rows[0].MethodNames) || rows[0].Accounts == 0 {
			return nil, fmt.Errorf("invalid account-type detail")
		}
		r := rows[0]
		contracts := []json.RawMessage{}
		for _, text := range r.Contracts {
			if !json.Valid([]byte(text)) {
				return nil, fmt.Errorf("invalid ABI metadata")
			}
			contracts = append(contracts, json.RawMessage(text))
		}
		methods := []map[string]any{}
		for i, id := range r.MethodIDs {
			methods = append(methods, map[string]any{"id": id, "names": r.MethodNames[i]})
		}
		bytes, _ := base64.StdEncoding.DecodeString(hash)
		response["detail"] = map[string]any{"codeHash": hash, "codeHashHex": hex.EncodeToString(bytes),
			"accounts": strconv.FormatUint(r.Accounts, 10), "leaf": r.Leaf,
			"methodsAvailable": r.Available != 0, "methods": methods, "contracts": contracts,
			"methodsStartedAt": r.Started, "methodsFinishedAt": r.Finished}
		return json.Marshal(response)
	}
	var selected *accountTypeNode
	for i := range nodes {
		if nodes[i].ID == q.Get("node") {
			selected = &nodes[i]
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("node is not in captured publication")
	}
	// Leaf IDs are validated fixed-format identifiers read from the publication.
	p.Set("leaves", "['"+strings.Join(selected.Leaves, "','")+"']")
	p.Set("search", q.Get("search"))
	p.Set("offset", q.Get("offset"))
	p.Set("limit", q.Get("limit"))
	raw, err = s.reader.Read(ctx, "account_type_member_totals", p)
	if err != nil {
		return nil, err
	}
	var totals []struct {
		Accounts uint64 `json:"accounts,string"`
		Hashes   uint64 `json:"hashes,string"`
	}
	if err := json.Unmarshal(raw, &totals); err != nil {
		return nil, err
	}
	if len(totals) != 1 || totals[0].Accounts > selected.Accounts || totals[0].Hashes > selected.Hashes ||
		(q.Get("search") == "" && (totals[0].Accounts != selected.Accounts || totals[0].Hashes != selected.Hashes)) {
		return nil, fmt.Errorf("code-hash members disagree with prepared node")
	}
	raw, err = s.reader.Read(ctx, "account_type_members", p)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Hash     string `json:"codeHash"`
		Hex      string `json:"codeHashHex"`
		Accounts uint64 `json:"accounts,string"`
		Leaf     string `json:"leaf"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	offset, _ := strconv.ParseUint(q.Get("offset"), 10, 32)
	limit, _ := strconv.ParseUint(q.Get("limit"), 10, 32)
	if uint64(len(rows)) != min(limit, totals[0].Hashes-min(offset, totals[0].Hashes)) {
		return nil, fmt.Errorf("incomplete account-type member page")
	}
	var sum uint64
	for i, row := range rows {
		b, err := base64.StdEncoding.Strict().DecodeString(row.Hash)
		if err != nil || len(b) != 32 || hex.EncodeToString(b) != row.Hex || !slices.Contains(selected.Leaves, row.Leaf) ||
			row.Accounts == 0 || row.Accounts > totals[0].Accounts-sum ||
			(i > 0 && (row.Accounts > rows[i-1].Accounts || (row.Accounts == rows[i-1].Accounts && row.Hash <= rows[i-1].Hash))) {
			return nil, fmt.Errorf("invalid account-type member")
		}
		sum += row.Accounts
	}
	if rows == nil {
		rows = []struct {
			Hash     string `json:"codeHash"`
			Hex      string `json:"codeHashHex"`
			Accounts uint64 `json:"accounts,string"`
			Leaf     string `json:"leaf"`
		}{}
	}
	response["node"], response["rows"] = selected, rows
	response["matchedAccounts"], response["matchedHashes"] = strconv.FormatUint(totals[0].Accounts, 10), strconv.FormatUint(totals[0].Hashes, 10)
	response["offset"], response["limit"] = offset, limit
	return json.Marshal(response)
}
