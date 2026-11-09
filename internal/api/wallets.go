package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

const walletRegistry = "fc96280e446129a605659a022311bba1d0d6bef9a03960be77c86a259dc876f9"
const walletSource = "mainnet-wallets-v1"

const walletDaysSQL = `SELECT day,toString(argMax(d.run_id,tuple(through_mc,calculated_at,d.run_id))) AS run_id,
 toString(argMax(d.activations,tuple(through_mc,calculated_at,d.run_id))) AS activations
 FROM gramstat.wallet_days d WHERE source_id={source:String} AND registry={registry:String} AND history_verified=1
 AND day>=toDate(toDateTime({from_ts:UInt32},'UTC')) AND day<=toDate(toDateTime({to_ts:UInt32}-1,'UTC'))
 GROUP BY day ORDER BY day`

const walletActivitySQL = `SELECT max(bucket) AS utime,toString(argMax(active,bucket)) AS value FROM gramstat.wallet_counts
 WHERE source_id={source:String} AND registry={registry:String} AND step={step:UInt32}
 AND bucket>=intDiv({from_ts:UInt32},{step:UInt32})*{step:UInt32} AND bucket<{to_ts:UInt32}
 AND day>=toDate(toDateTime({from_ts:UInt32},'UTC')) AND day<=toDate(toDateTime({to_ts:UInt32}-1,'UTC'))
 AND (day,toString(run_id)) IN {published:Array(Tuple(Date,String))}
 GROUP BY intDiv(bucket,{sample_step:UInt32}) ORDER BY utime`

const walletMonthlySQL = `SELECT toUInt32(toUnixTimestamp(toDateTime(day,'UTC'))) AS utime,
 toString(argMax(active,calculated_at)) AS value FROM gramstat.wallet_monthly
 WHERE source_id={source:String} AND registry={registry:String}
 AND day>=toDate(toDateTime({from_ts:UInt32},'UTC')) AND day<=toDate(toDateTime({to_ts:UInt32}-1,'UTC'))
 GROUP BY day ORDER BY day`

const walletCountSQL = `SELECT toUInt32(count()) AS count FROM gramstat.wallet_activations_mc
 WHERE source_id={source:String} AND registry={registry:String}
 AND day>=toDate(toDateTime({from_ts:UInt32},'UTC')) AND day<=toDate(toDateTime({to_ts:UInt32}-1,'UTC'))
 AND utime>={from_ts:UInt32} AND utime<{to_ts:UInt32}
 AND (day,toString(run_id)) IN {published:Array(Tuple(Date,String))}`

const walletActivatedSQL = `WITH if({step:UInt32}>=86400,86400,3600) AS base_step,
 ({step:UInt32}>=3600 AND modulo({step:UInt32},base_step)=0) AS use_checkpoints,
 intDiv(toUInt64({from_ts:UInt32})+base_step-1,base_step)*base_step AS inner_from,
 intDiv({to_ts:UInt32},base_step)*base_step AS inner_to,
 points AS (
 SELECT mc_seqno,utime,activated FROM gramstat.wallet_activations_mc
 WHERE (NOT use_checkpoints OR (modulo({from_ts:UInt32},base_step)!=0 AND utime<inner_from)
 OR (modulo({to_ts:UInt32},base_step)!=0 AND utime>=inner_to))
 AND day>=toDate(toDateTime({from_ts:UInt32},'UTC')) AND day<=toDate(toDateTime({to_ts:UInt32}-1,'UTC'))
 AND (NOT use_checkpoints
 OR (modulo({from_ts:UInt32},base_step)!=0 AND day=toDate(toDateTime({from_ts:UInt32},'UTC')))
 OR (modulo({to_ts:UInt32},base_step)!=0 AND day=toDate(toDateTime({to_ts:UInt32}-1,'UTC'))))
 AND source_id={source:String} AND registry={registry:String}
 AND utime>={from_ts:UInt32} AND utime<{to_ts:UInt32}
 AND (day,toString(run_id)) IN {published:Array(Tuple(Date,String))}
 UNION ALL
 SELECT mc_seqno,utime,activated FROM gramstat.wallet_activated_checkpoints
 WHERE use_checkpoints AND step=base_step AND bucket>=inner_from AND bucket<inner_to
 AND source_id={source:String} AND registry={registry:String}
 AND (day,toString(run_id)) IN {published:Array(Tuple(Date,String))}
 )
 SELECT max(p.mc_seqno) AS mc_seqno,argMax(p.utime,p.mc_seqno) AS utime,toString(argMax(p.activated,p.mc_seqno)) AS value
 FROM points p GROUP BY if({step:UInt32}=0,toUInt64(p.mc_seqno),toUInt64(intDiv(p.utime,greatest({step:UInt32},1)))) ORDER BY mc_seqno`

func (s *Server) loadWallets(ctx context.Context, q url.Values) ([]byte, error) {
	from, _ := time.Parse(time.RFC3339, q.Get("from"))
	to, _ := time.Parse(time.RFC3339, q.Get("to"))
	budget, _ := strconv.Atoi(q.Get("maxPoints"))
	p := url.Values{"source": {walletSource}, "registry": {walletRegistry}, "from_ts": {strconv.FormatInt(from.Unix(), 10)}, "to_ts": {strconv.FormatInt(to.Unix(), 10)}}
	days, err := s.reader.Read(ctx, "wallet_days", p)
	if err != nil {
		return nil, err
	}
	var coverage []struct {
		Day         string `json:"day"`
		Run         string `json:"run_id"`
		Activations string `json:"activations"`
	}
	if err = json.Unmarshal(days, &coverage); err != nil {
		return nil, err
	}
	published := "["
	dates := []string{}
	daily := []map[string]any{}
	for i, d := range coverage {
		date, e := time.Parse(time.DateOnly, d.Day)
		if e != nil {
			return nil, e
		}
		// Only internal, canonical identifiers are serialized into the array parameter.
		if len(d.Run) != 36 {
			return nil, fmt.Errorf("invalid wallet publication ID")
		}
		for _, c := range d.Run {
			if !(c == '-' || c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return nil, fmt.Errorf("invalid wallet publication ID")
			}
		}
		if i > 0 {
			published += ","
		}
		published += "('" + d.Day + "','" + d.Run + "')"
		dates = append(dates, d.Day)
		daily = append(daily, map[string]any{"utime": date.Unix(), "value": d.Activations})
	}
	p.Set("published", published+"]")
	mode := q.Get("activity")
	if mode == "" {
		mode = "daily"
	}
	activityStep, windowSeconds := int64(86400), int64(86400)
	if mode == "hourly" {
		activityStep = 3600
		windowSeconds = 3600
	}
	if mode == "monthly" {
		windowSeconds = 30 * 86400
	}
	sampleStep := activityStep
	if mode == "hourly" {
		hours := (to.Unix()-1)/3600 - from.Unix()/3600 + 1
		sampleStep = ((hours + int64(budget) - 1) / int64(budget)) * 3600
	}
	p.Set("sample_step", strconv.FormatInt(sampleStep, 10))
	activatedStep := supplyInterval(to.Unix()-from.Unix(), budget)
	activated, activity := json.RawMessage(`[]`), json.RawMessage(`[]`)
	if len(coverage) > 0 {
		if to.Sub(from) <= 48*time.Hour {
			counts, e := s.reader.Read(ctx, "wallet_count", p)
			if e != nil {
				return nil, e
			}
			var n []struct {
				Count uint32 `json:"count"`
			}
			if e = json.Unmarshal(counts, &n); e != nil {
				return nil, e
			}
			if len(n) == 1 && n[0].Count <= uint32(budget) {
				activatedStep = 0
			}
		}
		p.Set("step", strconv.FormatInt(activatedStep, 10))
		activated, err = s.reader.Read(ctx, "wallet_activated", p)
		if err != nil {
			return nil, err
		}
		p.Set("step", strconv.FormatInt(activityStep, 10))
		query := "wallet_activity"
		if mode == "monthly" {
			query = "wallet_monthly"
		}
		activity, err = s.reader.Read(ctx, query, p)
		if err != nil {
			return nil, err
		}
	}
	activeDates := dates
	if mode == "monthly" {
		var points []struct {
			Utime uint32 `json:"utime"`
		}
		if err = json.Unmarshal(activity, &points); err != nil {
			return nil, err
		}
		activeDates = []string{}
		for _, point := range points {
			activeDates = append(activeDates, time.Unix(int64(point.Utime), 0).UTC().Format(time.DateOnly))
		}
	}
	result := map[string]any{"schemaVersion": 2, "network": "mainnet", "registry": walletRegistry, "period": map[string]string{"from": q.Get("from"), "to": q.Get("to")}, "coverageDays": dates,
		"activated":   map[string]any{"intervalSeconds": activatedStep, "points": activated},
		"activations": map[string]any{"intervalSeconds": 86400, "points": daily},
		"active":      map[string]any{"mode": mode, "intervalSeconds": activityStep, "windowSeconds": windowSeconds, "sampleStepSeconds": sampleStep, "coverageDays": activeDates, "points": activity}, "servedAt": time.Now().UTC().Format(time.RFC3339)}
	return json.Marshal(result)
}
