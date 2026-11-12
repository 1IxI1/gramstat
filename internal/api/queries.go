// Package api serves bounded, read-only Gramstat chart data.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

type Reader interface {
	Read(context.Context, string, url.Values) (json.RawMessage, error)
}

type ClickHouseReader struct{ CH *ClickHouse }

const locationsFromSQL = `FROM gramstat.validator_geo_rounds AS g FINAL
INNER JOIN gramstat.validator_rounds AS r FINAL
 ON r.utime_since = g.utime_since AND r.utime_until = g.utime_until
 AND r.roster_digest = g.roster_digest AND r.config34_hash = g.config34_hash
`

const locationsSQL = `SELECT g.utime_since, g.utime_until, g.total, g.located, g.unknown, g.data_through, g.status,
formatDateTime(g.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
arrayMap(m -> tuple(m.country, m.city, m.latitude, m.longitude),
 arrayFilter(m -> m.status = 'located', g.members)) AS points
` + locationsFromSQL

// Each route selects a fixed query. No user SQL, identifiers, settings, or URLs
// are forwarded. Every 64-bit integer and monetary amount is a decimal string.
var queries = map[string]string{
	"wallet_active_days": walletActiveDaysSQL,
	"staking_contracts": `SELECT protocol,pool,code_hash AS codeHash,
 arraySort(groupUniqArray(holder)) AS holders,
 formatDateTime(max(checked_at),'%Y-%m-%dT%H:%i:%SZ','UTC') AS lastCheckedAt
 FROM gramstat.validator_stake_affiliations FINAL
 WHERE verification_version='account-identity-v3' AND protocol!=''
 GROUP BY protocol,pool,code_hash ORDER BY protocol,pool,code_hash`,
	"daily_columns":           dailyColumnsSQL,
	"stars_columns":           starsColumnsSQL,
	"chain_columns":           chainColumnsSQL,
	"wallet_days":             walletDaysSQL,
	"wallet_activity":         walletActivitySQL,
	"wallet_activity_average": walletActivityAverageSQL,
	"wallet_monthly":          walletMonthlySQL,
	"wallet_count":            walletCountSQL,
	"wallet_activated":        walletActivatedSQL,
	"accounts_bounds":         accountsBoundsSQL,
	"accounts_count":          accountsCountSQL,
	"accounts_raw":            accountsRawSQL,
	"accounts_rollup":         accountsRollupSQL,
	"inflation_rollup": `SELECT toUInt32(point.1) AS utime,toString(point.2) AS annualized_percent,
toUInt32(point.3) AS window_from,toString(point.4) AS minted_24h_nanoton,
toString(point.5) AS burned_24h_nanoton,toString(point.6) AS supply_nanoton,
point.7 AS supply_utime,point.8 AS supply_mc
FROM (SELECT intDiv(toUInt64(point_at),{step:UInt32}) AS bucket,
argMax(tuple(point_at,annualized_percent,window_from,minted_24h_nanoton,burned_24h_nanoton,
supply_nanoton,supply_utime,supply_mc),point_at) AS point
FROM gramstat.inflation_hourly FINAL
WHERE point_at >= toDateTime({from_ts:UInt32},'UTC') AND point_at < toDateTime({to_ts:UInt32},'UTC')
GROUP BY bucket) ORDER BY utime`,
	"supply_count": `SELECT toUInt32(count()) AS count FROM mainnet_gramstat_full.blocks FINAL
WHERE workchain=-1 AND shard=-9223372036854775808 AND seqno BETWEEN {first_mc:UInt32} AND {last_mc:UInt32}
AND gen_utime >= {from_ts:UInt32} AND gen_utime < {to_ts:UInt32}`,
	"supply_bounds": `SELECT min(first_mc) AS first_mc, max(last_mc) AS last_mc,
toUInt32(sum(mc_count)) AS mc_count, toString(argMin(tuple(opening_burn),hour).1) AS opening_burn
FROM gramstat.supply_hourly FINAL
WHERE hour >= toStartOfHour(toDateTime({from_ts:UInt32},'UTC')) AND hour < toDateTime({to_ts:UInt32},'UTC')`,
	"supply_raw": `WITH corrected AS (
 SELECT seqno,gen_utime,
 multiIf(global_balance IS NULL,NULL,
 seqno >= 103190382 OR seqno < 30410593,global_balance,
 {opening_known:UInt8}=0 OR countIf(burned IS NULL) OVER w > 0,NULL,
 global_balance - {opening_burn:Decimal(38,0)} - sum(burned) OVER w) AS supply,
 count() OVER () AS raw_count
 FROM mainnet_gramstat_full.blocks FINAL
 WHERE workchain=-1 AND shard=-9223372036854775808 AND seqno BETWEEN {first_mc:UInt32} AND {last_mc:UInt32}
 WINDOW w AS (ORDER BY seqno ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
), points AS (
 SELECT if({step:UInt32}=0,toUInt64(seqno),intDiv(toUInt64(gen_utime),greatest({step:UInt32},1))) AS bucket,
 argMax(tuple(supply,gen_utime,seqno),tuple(gen_utime,seqno)) AS point
 FROM corrected WHERE gen_utime >= {from_ts:UInt32} AND gen_utime < {to_ts:UInt32}
 AND throwIf(raw_count != toUInt64({last_mc:UInt32})-{first_mc:UInt32}+1,'Incomplete supply block interval')=0
 GROUP BY bucket
)
SELECT toUInt32(point.2) AS utime,toUInt32(point.3) AS mc_seqno,toString(point.1) AS supply_nanoton
FROM points ORDER BY utime,mc_seqno`,
	"supply_rollup": `SELECT toUInt32(point.2) AS utime,toUInt32(point.3) AS mc_seqno,toString(point.1) AS supply_nanoton
FROM (SELECT intDiv(toUInt64(hour),{step:UInt32}) AS bucket,
argMax(tuple(supply_nanoton,last_utime,last_mc),tuple(last_utime,last_mc)) AS point
FROM gramstat.supply_hourly FINAL
WHERE last_utime >= {from_ts:UInt32} AND last_utime < {to_ts:UInt32}
GROUP BY bucket) ORDER BY utime,mc_seqno`,
	"chain": `SELECT day, toString(transactions) AS transactions,
toString(fees_nanoton) AS fees_nanoton, toString(minted_nanoton) AS minted_nanoton,
toString(burned_nanoton) AS burned_nanoton, toString(supply_nanoton) AS supply_nanoton,
supply_utime, is_partial, source_mc_from, source_mc_to, source_id,
formatDateTime(calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at
FROM gramstat.chain_daily_full FINAL WHERE day >= {from:Date} AND day < {to:Date} ORDER BY day`,
	"daily": `SELECT metric, day, toString(value) AS value, toString(amount_nanoton) AS amount_nanoton,
breakdown, is_partial, source_mc_seqno,
formatDateTime(calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
formatDateTime(data_through, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS data_through
FROM gramstat.daily_metrics FINAL WHERE day >= {from:Date} AND day < {to:Date} ORDER BY metric, day`,
	"stars": `SELECT day, toString(purchases) AS purchases, toString(unknown_purchases) AS unknown_purchases,
toString(stars_total) AS stars_total, toString(known_stars_total) AS known_stars_total,
is_partial, formatDateTime(calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
formatDateTime(data_through, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS data_through
FROM gramstat.telegram_stars_daily FINAL WHERE day >= {from:Date} AND day < {to:Date} ORDER BY day`,
	"validators": `SELECT r.utime_since AS utime_since, r.utime_until AS utime_until,
r.total AS total, r.is_partial AS is_partial, r.data_through AS data_through,
formatDateTime(r.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
s.election_id, toString(s.submitted_nanogram) AS submitted_nanogram,
toString(s.selected_nanogram) AS selected_nanogram, toString(s.remaining_nanogram) AS remaining_nanogram,
toString(s.reward_nanogram) AS reward_nanogram,
s.unfreeze_utime, s.status AS stake_status, ` + aprColumnsSQL + `, ` + stakeChangesColumnsSQL + `, ` + lockedColumnsSQL + `
FROM gramstat.validator_rounds AS r FINAL
LEFT JOIN gramstat.validator_stake_rounds AS s FINAL
 ON r.utime_since = s.utime_since AND r.utime_until = s.utime_until
 AND r.roster_digest = s.roster_digest AND r.config34_hash = s.config34_hash
` + aprJoinSQL + `
` + stakeChangesJoinSQL + `
` + lockedJoinSQL + `
WHERE r.utime_since < toUnixTimestamp(toDateTime({to:Date}, 'UTC'))
 AND r.utime_until > toUnixTimestamp(toDateTime({from:Date}, 'UTC')) ORDER BY r.utime_since`,
	"rounds": `SELECT r.utime_since AS utime_since, r.utime_until AS utime_until,
r.total AS total, r.is_partial AS is_partial, r.data_through AS data_through,
formatDateTime(r.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
g.located, g.unknown, g.countries, g.country_known, g.breakdown,
g.status AS geo_status, g.data_through AS geo_data_through,
formatDateTime(g.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS geo_calculated_at,
s.election_id, toString(s.submitted_nanogram) AS submitted_nanogram,
toString(s.selected_nanogram) AS selected_nanogram, toString(s.remaining_nanogram) AS remaining_nanogram,
toString(s.reward_nanogram) AS reward_nanogram,
s.unfreeze_utime, s.status AS stake_status, ` + aprColumnsSQL + `, ` + stakeChangesColumnsSQL + `, ` + lockedColumnsSQL + `
FROM gramstat.validator_rounds AS r FINAL
LEFT JOIN gramstat.validator_geo_rounds AS g FINAL
 ON r.utime_since = g.utime_since AND r.roster_digest = g.roster_digest AND r.config34_hash = g.config34_hash
LEFT JOIN gramstat.validator_stake_rounds AS s FINAL
 ON r.utime_since = s.utime_since AND r.utime_until = s.utime_until
 AND r.roster_digest = s.roster_digest AND r.config34_hash = s.config34_hash
` + aprJoinSQL + `
` + stakeChangesJoinSQL + `
` + lockedJoinSQL + `
WHERE r.utime_since < toUnixTimestamp(toDateTime({to:Date}, 'UTC'))
 AND r.utime_until > toUnixTimestamp(toDateTime({from:Date}, 'UTC')) ORDER BY r.utime_since`,
	"locations": locationsSQL + `WHERE g.utime_since = {round:UInt32}`,
	// data_through is exclusive; at is the inclusive last selected second.
	// Pick the scalar round first, so historical member arrays are not sorted.
	"locations_at": locationsSQL + `WHERE g.utime_since IN (SELECT g.utime_since
 ` + locationsFromSQL + `WHERE g.data_through > g.utime_since
 AND g.data_through <= g.utime_until
 AND g.data_through <= toUInt64({at:UInt32}) + 1
 ORDER BY g.data_through DESC, g.utime_since DESC LIMIT 1)`,
	"coverage": `SELECT 'chain' AS source, toString(minOrNull(day)) AS first_day,
toString(maxOrNull(day)) AS last_day,
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS updated_at,
CAST(NULL AS Nullable(UInt32)) AS first_utime, CAST(NULL AS Nullable(UInt32)) AS last_utime,
toString(maxOrNullIf(day, is_partial = 0)) AS last_complete_day
FROM gramstat.chain_daily_full FINAL
UNION ALL SELECT 'actions', toString(minOrNull(day)), toString(maxOrNull(day)),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'), NULL, NULL, NULL
FROM gramstat.daily_metrics FINAL WHERE NOT startsWith(metric,'monthly_')
UNION ALL SELECT 'validators', toString(toDate(minOrNull(utime_since), 'UTC')),
toString(toDate(maxOrNull(utime_since), 'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'), NULL, NULL, NULL
FROM gramstat.validator_rounds FINAL
UNION ALL SELECT 'supply',toString(toDate(minOrNull(first_utime),'UTC')),toString(toDate(maxOrNull(last_utime),'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'),minOrNull(first_utime),maxOrNull(last_utime), NULL
FROM gramstat.supply_hourly FINAL
UNION ALL SELECT 'inflation',toString(toDate(minOrNull(point_at),'UTC')),toString(toDate(maxOrNull(point_at),'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'),toUInt32(minOrNull(point_at)),toUInt32(maxOrNull(point_at)), NULL
FROM gramstat.inflation_hourly FINAL
UNION ALL SELECT 'accounts',toString(toDate(minOrNull(first_utime),'UTC')),toString(toDate(maxOrNull(last_utime),'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'),minOrNull(first_utime),maxOrNull(last_utime), NULL
FROM gramstat.accounts_hourly FINAL`,
}

const lockedColumnsSQL = `lk.previous_utime_since AS locked_previous,
toString(lk.previous_selected_nanogram) AS locked_previous_selected_nanogram,
toString(lk.total_nanogram) AS locked_total_nanogram,
toString(lk.telegram_nanogram) AS locked_telegram_nanogram,
toString(lk.pools_nanogram) AS locked_pools_nanogram,
toString(lk.others_nanogram) AS locked_others_nanogram,
mapApply((k,v)->(k,toString(v)),lk.pool_breakdown) AS locked_pool_breakdown,
lk.positions AS locked_positions, lk.typed_positions AS locked_typed_positions,
lk.isp_observed_positions AS locked_isp_observed_positions,
lk.data_through AS locked_data_through, lk.is_partial AS locked_is_partial,
lk.status AS locked_status`

// The predecessor is checked even when outside the requested date range. The
// API projects only prepared scalar totals; no raw IPs or member evidence arrays.
const lockedJoinSQL = `LEFT JOIN (
 SELECT x.utime_since AS utime_since,x.utime_until AS utime_until,
 x.config34_hash AS config34_hash,x.roster_digest AS roster_digest,
 x.current_selected_nanogram AS current_selected_nanogram,
 x.previous_utime_since AS previous_utime_since,x.previous_selected_nanogram AS previous_selected_nanogram,
 x.total_nanogram AS total_nanogram,x.telegram_nanogram AS telegram_nanogram,
 x.pools_nanogram AS pools_nanogram,x.others_nanogram AS others_nanogram,
 x.pool_breakdown AS pool_breakdown,x.positions AS positions,x.typed_positions AS typed_positions,
 x.isp_observed_positions AS isp_observed_positions,x.data_through AS data_through,
 x.is_partial AS is_partial,x.status AS status
 FROM gramstat.validator_stake_locked_rounds AS x FINAL
 INNER JOIN gramstat.validator_rounds AS lp FINAL
  ON lp.utime_since=x.previous_utime_since AND lp.utime_until=x.utime_since
  AND lp.config34_hash=x.previous_config34_hash AND lp.roster_digest=x.previous_roster_digest
 INNER JOIN gramstat.validator_stake_rounds AS lps FINAL
  ON lps.utime_since=lp.utime_since AND lps.utime_until=lp.utime_until
  AND lps.config34_hash=lp.config34_hash AND lps.roster_digest=lp.roster_digest
 WHERE x.calc_version='stake-locked-v1' AND lp.data_through>=lp.utime_until
  AND lps.status!='invalid_source' AND lps.selected_nanogram=x.previous_selected_nanogram
  AND x.total_nanogram=x.current_selected_nanogram+x.previous_selected_nanogram
 ) AS lk ON lk.utime_since=r.utime_since AND lk.utime_until=r.utime_until
  AND lk.config34_hash=r.config34_hash AND lk.roster_digest=r.roster_digest
  AND lk.current_selected_nanogram=s.selected_nanogram AND s.status!='invalid_source'`

// Recheck both interval proofs at read time so a corrected/removed successor
// cannot expose stale APR before the next hourly reconciliation.
const aprReadySQL = `s.calc_version = 'stake-v3' AND s.apr_status = 'complete'
 AND r.data_through >= r.utime_until AND n.data_through >= n.utime_until
 AND n.utime_until <= toUnixTimestamp(now()) AND s.apr_percent IS NOT NULL`

const aprColumnsSQL = `toString(if(` + aprReadySQL + `, s.apr_percent, NULL)) AS apr_percent,
s.apr_cycle_seconds, s.apr_next_utime_until,
if(s.apr_status = 'complete' AND NOT coalesce((` + aprReadySQL + `), false), 'stale_intervals', s.apr_status) AS apr_status`

const aprJoinSQL = `LEFT JOIN gramstat.validator_rounds AS n FINAL
 ON n.utime_since = s.utime_until AND n.utime_until = s.apr_next_utime_until
 AND n.config34_hash = s.apr_next_config34_hash AND n.roster_digest = s.apr_next_roster_digest`

const stakeChangesColumnsSQL = `ch.previous_utime_since AS stake_change_previous,
ch.previous_holders AS stake_change_previous_holders, ch.current_holders AS stake_change_current_holders,
ch.matched AS stake_change_matched, ch.new_holders AS stake_change_new, ch.exited_holders AS stake_change_exited,
ch.near_reward AS stake_change_near_reward, ch.below_reward AS stake_change_below_reward,
ch.above_reward AS stake_change_above_reward, ch.unchanged AS stake_change_unchanged,
ch.decreased AS stake_change_decreased, ch.status AS stake_change_status`

// Check all three interval proofs plus the source release/selected snapshots.
// Restrict only the output round to the requested window, not its predecessors.
const stakeChangesJoinSQL = `LEFT JOIN (
 SELECT x.utime_since AS utime_since, x.utime_until AS utime_until,
 x.config34_hash AS config34_hash, x.roster_digest AS roster_digest,
 x.current_selected_nanogram AS current_selected_nanogram, x.previous_utime_since AS previous_utime_since,
 x.previous_holders AS previous_holders, x.current_holders AS current_holders,
 x.matched AS matched, x.new_holders AS new_holders, x.exited_holders AS exited_holders,
 x.near_reward AS near_reward, x.below_reward AS below_reward, x.above_reward AS above_reward,
 x.unchanged AS unchanged, x.decreased AS decreased, x.status AS status
 FROM gramstat.validator_stake_changes AS x FINAL
 INNER JOIN gramstat.validator_rounds AS p FINAL
  ON p.utime_since=x.previous_utime_since AND p.utime_until=x.middle_utime_since
  AND p.config34_hash=x.previous_config34_hash AND p.roster_digest=x.previous_roster_digest
 INNER JOIN gramstat.validator_rounds AS m FINAL
  ON m.utime_since=x.middle_utime_since AND m.utime_until=x.utime_since
  AND m.config34_hash=x.middle_config34_hash AND m.roster_digest=x.middle_roster_digest
 INNER JOIN gramstat.validator_stake_rounds AS ps FINAL
  ON ps.utime_since=p.utime_since AND ps.utime_until=p.utime_until
  AND ps.config34_hash=p.config34_hash AND ps.roster_digest=p.roster_digest
 WHERE x.calc_version='stake-changes-v1' AND p.data_through>=p.utime_until AND m.data_through>=m.utime_until
 AND (x.status!='complete' OR (ps.selected_nanogram=x.previous_selected_nanogram
  AND ps.remaining_nanogram=x.previous_remaining_nanogram AND ps.reward_nanogram=x.previous_reward_nanogram
  AND ps.unfreeze_mc_seqno=x.result_mc AND ps.status!='invalid_source'))
) AS ch ON ch.utime_since=r.utime_since AND ch.utime_until=r.utime_until
 AND ch.config34_hash=r.config34_hash AND ch.roster_digest=r.roster_digest
 AND ch.current_selected_nanogram=s.selected_nanogram`

func (c ClickHouseReader) Read(ctx context.Context, name string, params url.Values) (json.RawMessage, error) {
	// Keep individual reads within the SELECT-only role's fixed result budget.
	// The public response still includes every daily observation for the range.
	roundRows := name == "rounds" || name == "validators"
	if name == "daily" || name == "daily_columns" || roundRows {
		chunkDays := 366
		if roundRows {
			chunkDays = 732
		} // Far fewer rows than daily metrics; retain the same result budget.
		from, e1 := time.Parse(time.DateOnly, params.Get("from"))
		to, e2 := time.Parse(time.DateOnly, params.Get("to"))
		if e1 == nil && e2 == nil && to.Sub(from) > time.Duration(chunkDays)*24*time.Hour {
			var rows []json.RawMessage
			seen := map[uint32]bool{}
			for start := from; start.Before(to); {
				end := start.AddDate(0, 0, chunkDays)
				if end.After(to) {
					end = to
				}
				part, err := c.Read(ctx, name, url.Values{"from": {start.Format(time.DateOnly)}, "to": {end.Format(time.DateOnly)}})
				if err != nil {
					return nil, err
				}
				var batch []json.RawMessage
				if err := json.Unmarshal(part, &batch); err != nil {
					return nil, err
				}
				for _, row := range batch {
					if roundRows {
						var id struct {
							Since uint32 `json:"utime_since"`
						}
						if err := json.Unmarshal(row, &id); err != nil {
							return nil, err
						}
						if seen[id.Since] {
							continue
						}
						seen[id.Since] = true
					}
					rows = append(rows, row)
				}
				start = end
			}
			if rows == nil {
				return json.RawMessage(`[]`), nil
			}
			return json.Marshal(rows)
		}
	}
	query, ok := queries[name]
	if !ok {
		return nil, fmt.Errorf("unknown chart query")
	}
	p := url.Values{
		"readonly": {"1"}, "max_execution_time": {"10"}, "max_threads": {"2"},
		"max_memory_usage": {"268435456"}, "max_result_rows": {"20000"},
		"max_result_bytes": {"4194304"}, "result_overflow_mode": {"throw"},
		"max_rows_to_read": {"2000000"}, "read_overflow_mode": {"throw"},
		"join_use_nulls": {"1"}, "output_format_json_quote_64bit_integers": {"1"},
	}
	for k, v := range params {
		p["param_"+k] = v
	}
	query = walletPublicationParams(query, p)
	data, err := c.CH.Query(ctx, query+" FORMAT JSON", p)
	if err != nil {
		return nil, err
	}
	var result struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	if len(result.Data) == 0 || result.Data[0] != '[' {
		return nil, fmt.Errorf("missing chart rows")
	}
	return result.Data, nil
}

// Keep each HTTP field below ClickHouse's form-field limit even for the full
// history. All queries still use the same captured publication snapshot.
func walletPublicationParams(query string, p url.Values) string {
	const placeholder = "{published:Array(Tuple(Date,String))}"
	const chunkSize = 32 * 1024
	value := p.Get("param_published")
	if !strings.Contains(query, placeholder) {
		delete(p, "param_published")
		return query
	}
	if len(value) <= chunkSize {
		return query
	}
	delete(p, "param_published")
	var chunks []string
	for i := 0; len(value) > 0; i++ {
		n := min(len(value), chunkSize)
		key := fmt.Sprintf("published_chunk_%d", i)
		p.Set("param_"+key, value[:n])
		chunks = append(chunks, "{"+key+":String}")
		value = value[n:]
	}
	return strings.ReplaceAll(query, placeholder, "CAST(concat("+strings.Join(chunks, ",")+"), 'Array(Tuple(Date,String))')")
}
