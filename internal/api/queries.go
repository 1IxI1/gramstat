// Package api serves bounded, read-only Gramstat chart data.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

type Reader interface {
	Read(context.Context, string, url.Values) (json.RawMessage, error)
}

type ClickHouseReader struct{ CH *ClickHouse }

// Each route selects a fixed query. No user SQL, identifiers, settings, or URLs
// are forwarded. Every 64-bit integer and monetary amount is a decimal string.
var queries = map[string]string{
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
	"validators": `SELECT utime_since, utime_until, total, is_partial, data_through,
formatDateTime(calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at
FROM gramstat.validator_rounds FINAL
WHERE utime_since < toUnixTimestamp(toDateTime({to:Date}, 'UTC'))
 AND utime_until > toUnixTimestamp(toDateTime({from:Date}, 'UTC')) ORDER BY utime_since`,
	"rounds": `SELECT r.utime_since, r.utime_until, r.total, r.is_partial, r.data_through,
formatDateTime(r.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
g.located, g.unknown, g.countries, g.country_known, g.breakdown,
g.status AS geo_status, g.data_through AS geo_data_through,
formatDateTime(g.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS geo_calculated_at
FROM gramstat.validator_rounds AS r FINAL
LEFT JOIN gramstat.validator_geo_rounds AS g FINAL
 ON r.utime_since = g.utime_since AND r.roster_digest = g.roster_digest AND r.config34_hash = g.config34_hash
WHERE r.utime_since < toUnixTimestamp(toDateTime({to:Date}, 'UTC'))
 AND r.utime_until > toUnixTimestamp(toDateTime({from:Date}, 'UTC')) ORDER BY r.utime_since`,
	"locations": `SELECT g.utime_since, g.total, g.located, g.unknown, g.data_through, g.status,
formatDateTime(g.calculated_at, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS calculated_at,
arrayMap(m -> tuple(m.country, m.city, m.latitude, m.longitude),
 arrayFilter(m -> m.status = 'located', g.members)) AS points
FROM gramstat.validator_geo_rounds AS g FINAL
INNER JOIN gramstat.validator_rounds AS r FINAL
 ON r.utime_since = g.utime_since AND r.roster_digest = g.roster_digest AND r.config34_hash = g.config34_hash
WHERE g.utime_since = {round:UInt32}`,
	"coverage": `SELECT 'chain' AS source, toString(minOrNull(day)) AS first_day,
toString(maxOrNull(day)) AS last_day,
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS updated_at,
CAST(NULL AS Nullable(UInt32)) AS first_utime, CAST(NULL AS Nullable(UInt32)) AS last_utime
FROM gramstat.chain_daily_full FINAL
UNION ALL SELECT 'actions', toString(minOrNull(day)), toString(maxOrNull(day)),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'), NULL, NULL
FROM gramstat.daily_metrics FINAL
UNION ALL SELECT 'validators', toString(toDate(minOrNull(utime_since), 'UTC')),
toString(toDate(maxOrNull(utime_since), 'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'), NULL, NULL
FROM gramstat.validator_rounds FINAL
UNION ALL SELECT 'supply',toString(toDate(minOrNull(first_utime),'UTC')),toString(toDate(maxOrNull(last_utime),'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'),minOrNull(first_utime),maxOrNull(last_utime)
FROM gramstat.supply_hourly FINAL
UNION ALL SELECT 'inflation',toString(toDate(minOrNull(point_at),'UTC')),toString(toDate(maxOrNull(point_at),'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'),toUInt32(minOrNull(point_at)),toUInt32(maxOrNull(point_at))
FROM gramstat.inflation_hourly FINAL
UNION ALL SELECT 'accounts',toString(toDate(minOrNull(first_utime),'UTC')),toString(toDate(maxOrNull(last_utime),'UTC')),
formatDateTime(maxOrNull(calculated_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC'),minOrNull(first_utime),maxOrNull(last_utime)
FROM gramstat.accounts_hourly FINAL`,
}

func (c ClickHouseReader) Read(ctx context.Context, name string, params url.Values) (json.RawMessage, error) {
	query, ok := queries[name]
	if !ok {
		return nil, fmt.Errorf("unknown chart query")
	}
	p := url.Values{
		"readonly": {"1"}, "max_execution_time": {"10"}, "max_threads": {"2"},
		"max_memory_usage": {"268435456"}, "max_result_rows": {"100000"},
		"max_result_bytes": {"33554432"}, "result_overflow_mode": {"throw"},
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
