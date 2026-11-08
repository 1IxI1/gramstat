package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

const accountsBoundsSQL = `SELECT first_mc,last_mc,mc_count,
toString(opening.1) AS opening_uninit,toString(opening.2) AS opening_active,toString(opening.3) AS opening_frozen
FROM (SELECT min(first_mc) AS first_mc,max(last_mc) AS last_mc,toUInt32(sum(mc_count)) AS mc_count,
argMin(tuple(opening_uninit,opening_active,opening_frozen),hour) AS opening
FROM gramstat.accounts_hourly FINAL
WHERE hour>=toStartOfHour(toDateTime({from_ts:UInt32},'UTC')) AND hour<toDateTime({to_ts:UInt32},'UTC'))`

const accountsCountSQL = `SELECT toUInt32(count()) AS count FROM gramstat_full.account_deltas FINAL
WHERE gen_utime>=toDateTime({from_ts:UInt32},'UTC') AND gen_utime<toDateTime({to_ts:UInt32},'UTC')
AND mc_seqno BETWEEN {first_mc:UInt32} AND {last_mc:UInt32}`

const accountsRawSQL = `WITH counted AS (
 SELECT mc_seqno,toUInt32(gen_utime) AS utime,
 toInt64({opening_uninit:UInt64})+sum(delta_uninit) OVER w AS uninit,
 toInt64({opening_active:UInt64})+sum(delta_active) OVER w AS active,
 toInt64({opening_frozen:UInt64})+sum(delta_frozen) OVER w AS frozen,count() OVER () AS raw_count
 FROM gramstat_full.account_deltas FINAL
 WHERE gen_utime>=toStartOfHour(toDateTime({from_ts:UInt32},'UTC'))
 AND gen_utime<toStartOfHour(toDateTime({to_ts:UInt32}-1,'UTC'))+INTERVAL 1 HOUR
 AND mc_seqno BETWEEN {first_mc:UInt32} AND {last_mc:UInt32}
 WINDOW w AS (ORDER BY mc_seqno ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
), points AS (
 SELECT if({step:UInt32}=0,toUInt64(mc_seqno),intDiv(toUInt64(utime),greatest({step:UInt32},1))) AS bucket,
 argMax(tuple(utime,mc_seqno,uninit,active,frozen),tuple(utime,mc_seqno)) AS point
 FROM counted WHERE utime>={from_ts:UInt32} AND utime<{to_ts:UInt32}
 AND throwIf(raw_count!=toUInt64({last_mc:UInt32})-{first_mc:UInt32}+1 OR least(uninit,active,frozen)<0,'Invalid Accounts interval')=0
 GROUP BY bucket
)
SELECT point.1 AS utime,point.2 AS mc_seqno,toString(point.3) AS uninit,
toString(point.4) AS active,toString(point.5) AS frozen,toString(point.3+point.4+point.5) AS total
FROM points ORDER BY utime,mc_seqno`

const accountsRollupSQL = `SELECT point.1 AS utime,point.2 AS mc_seqno,toString(point.3) AS uninit,
toString(point.4) AS active,toString(point.5) AS frozen,toString(point.3+point.4+point.5) AS total
FROM (SELECT intDiv(toUInt64(hour),{step:UInt32}) AS bucket,
argMax(tuple(last_utime,last_mc,uninit,active,frozen),tuple(last_utime,last_mc)) AS point
FROM gramstat.accounts_hourly FINAL WHERE last_utime>={from_ts:UInt32} AND last_utime<{to_ts:UInt32}
GROUP BY bucket) ORDER BY utime,mc_seqno`

func (s *Server) loadAccounts(ctx context.Context, q url.Values) ([]byte, error) {
	from, _ := time.Parse(time.RFC3339, q.Get("from"))
	to, _ := time.Parse(time.RFC3339, q.Get("to"))
	budget, _ := strconv.Atoi(q.Get("maxPoints"))
	step := supplyInterval(to.Unix()-from.Unix(), budget)
	p := url.Values{"from_ts": {strconv.FormatInt(from.Unix(), 10)}, "to_ts": {strconv.FormatInt(to.Unix(), 10)}}
	var points json.RawMessage
	var err error
	resolution := "hourly"
	if step < 3600 && to.Sub(from) <= 48*time.Hour {
		data, e := s.reader.Read(ctx, "accounts_bounds", p)
		if e != nil {
			return nil, e
		}
		var bounds []struct {
			First  uint32 `json:"first_mc"`
			Last   uint32 `json:"last_mc"`
			Count  uint32 `json:"mc_count"`
			Uninit string `json:"opening_uninit"`
			Active string `json:"opening_active"`
			Frozen string `json:"opening_frozen"`
		}
		if e = json.Unmarshal(data, &bounds); e != nil {
			return nil, e
		}
		if len(bounds) == 0 || bounds[0].Count == 0 {
			points = json.RawMessage(`[]`)
		} else {
			b := bounds[0]
			if b.Last < b.First || b.Last-b.First+1 != b.Count {
				return nil, fmt.Errorf("incomplete Accounts checkpoints")
			}
			p.Set("first_mc", strconv.FormatUint(uint64(b.First), 10))
			p.Set("last_mc", strconv.FormatUint(uint64(b.Last), 10))
			p.Set("opening_uninit", b.Uninit)
			p.Set("opening_active", b.Active)
			p.Set("opening_frozen", b.Frozen)
			if b.Count <= uint32(budget) {
				step = 0
			} else {
				data, e = s.reader.Read(ctx, "accounts_count", p)
				if e != nil {
					return nil, e
				}
				var n []struct {
					Count uint32 `json:"count"`
				}
				if e = json.Unmarshal(data, &n); e != nil {
					return nil, e
				}
				if len(n) != 1 {
					return nil, fmt.Errorf("missing Accounts count")
				}
				if n[0].Count <= uint32(budget) {
					step = 0
				}
			}
			p.Set("step", strconv.FormatInt(step, 10))
			points, err = s.reader.Read(ctx, "accounts_raw", p)
		}
		resolution = "blocks"
	} else {
		step = max(step, 3600)
		p.Set("step", strconv.FormatInt(step, 10))
		points, err = s.reader.Read(ctx, "accounts_rollup", p)
	}
	if err != nil {
		return nil, err
	}
	var rows []json.RawMessage
	if err = json.Unmarshal(points, &rows); err != nil {
		return nil, err
	}
	if len(rows) > budget {
		return nil, fmt.Errorf("Accounts point budget exceeded")
	}
	return json.Marshal(map[string]any{"schemaVersion": 2, "network": "mainnet", "period": map[string]string{"from": q.Get("from"), "to": q.Get("to")}, "intervalSeconds": step, "resolution": resolution, "points": points, "servedAt": time.Now().UTC().Format(time.RFC3339)})
}
