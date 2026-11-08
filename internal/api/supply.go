package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

func supplyInterval(seconds int64, maxPoints int) int64 {
	// Aligned buckets can add one point at either edge.
	needed := (seconds + int64(maxPoints-2)) / int64(maxPoints-1)
	for _, step := range []int64{1, 5, 15, 30, 60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800, 2592000} {
		if step >= needed {
			return step
		}
	}
	return ((needed + 86399) / 86400) * 86400
}

func (s *Server) loadInflation(ctx context.Context, q url.Values) ([]byte, error) {
	from, _ := time.Parse(time.RFC3339, q.Get("from"))
	to, _ := time.Parse(time.RFC3339, q.Get("to"))
	budget, _ := strconv.Atoi(q.Get("maxPoints"))
	step := max(int64(3600), supplyInterval(to.Unix()-from.Unix(), budget))
	p := url.Values{"from_ts": {strconv.FormatInt(from.Unix(), 10)}, "to_ts": {strconv.FormatInt(to.Unix(), 10)}, "step": {strconv.FormatInt(step, 10)}}
	points, err := s.reader.Read(ctx, "inflation_rollup", p)
	if err != nil {
		return nil, err
	}
	var rows []json.RawMessage
	if err = json.Unmarshal(points, &rows); err != nil {
		return nil, err
	}
	if len(rows) > budget {
		return nil, fmt.Errorf("inflation point budget exceeded")
	}
	return json.Marshal(map[string]any{"schemaVersion": 2, "network": "mainnet", "period": map[string]string{"from": q.Get("from"), "to": q.Get("to")}, "intervalSeconds": step, "windowSeconds": 86400, "annualizationDays": 365, "points": points, "servedAt": time.Now().UTC().Format(time.RFC3339)})
}

func (s *Server) loadSupply(ctx context.Context, q url.Values) ([]byte, error) {
	from, _ := time.Parse(time.RFC3339, q.Get("from"))
	to, _ := time.Parse(time.RFC3339, q.Get("to"))
	budget, _ := strconv.Atoi(q.Get("maxPoints"))
	step := supplyInterval(to.Unix()-from.Unix(), budget)
	p := url.Values{"from_ts": {strconv.FormatInt(from.Unix(), 10)}, "to_ts": {strconv.FormatInt(to.Unix(), 10)}, "step": {strconv.FormatInt(step, 10)}}
	var points json.RawMessage
	var err error
	resolution := "hourly"
	if step < 3600 && to.Sub(from) <= 48*time.Hour {
		bounds, e := s.reader.Read(ctx, "supply_bounds", p)
		if e != nil {
			return nil, e
		}
		var rows []struct {
			First   uint32  `json:"first_mc"`
			Last    uint32  `json:"last_mc"`
			Count   uint64  `json:"mc_count"`
			Opening *string `json:"opening_burn"`
		}
		if e = json.Unmarshal(bounds, &rows); e != nil {
			return nil, e
		}
		if len(rows) == 0 || rows[0].Count == 0 {
			points = json.RawMessage(`[]`)
		} else {
			b := rows[0]
			if b.Last < b.First || uint64(b.Last)-uint64(b.First)+1 != b.Count {
				return nil, fmt.Errorf("incomplete supply checkpoints")
			}
			if b.Count <= uint64(budget) {
				step = 0
			}
			p.Set("step", strconv.FormatInt(step, 10))
			p.Set("first_mc", strconv.FormatUint(uint64(b.First), 10))
			p.Set("last_mc", strconv.FormatUint(uint64(b.Last), 10))
			if b.Count > uint64(budget) {
				// A short viewport can contain few MCs even inside a dense hour.
				// Count the requested timestamps, not the whole checkpoint span.
				counts, e := s.reader.Read(ctx, "supply_count", p)
				if e != nil {
					return nil, e
				}
				var n []struct {
					Count uint64 `json:"count"`
				}
				if e = json.Unmarshal(counts, &n); e != nil {
					return nil, e
				}
				if len(n) != 1 {
					return nil, fmt.Errorf("missing supply block count")
				}
				if n[0].Count <= uint64(budget) {
					step = 0
					p.Set("step", "0")
				}
			}
			p.Set("opening_known", "0")
			p.Set("opening_burn", "0")
			if b.Opening != nil {
				p.Set("opening_known", "1")
				p.Set("opening_burn", *b.Opening)
			}
			points, err = s.reader.Read(ctx, "supply_raw", p)
		}
		resolution = "blocks"
	} else {
		if step < 3600 {
			step = 3600
			p.Set("step", "3600")
		}
		points, err = s.reader.Read(ctx, "supply_rollup", p)
	}
	if err != nil {
		return nil, err
	}
	var rows []json.RawMessage
	if err = json.Unmarshal(points, &rows); err != nil {
		return nil, err
	}
	if len(rows) > budget {
		return nil, fmt.Errorf("supply point budget exceeded")
	}
	return json.Marshal(map[string]any{"schemaVersion": 2, "network": "mainnet", "period": map[string]string{"from": q.Get("from"), "to": q.Get("to")}, "intervalSeconds": step, "resolution": resolution, "points": points, "servedAt": time.Now().UTC().Format(time.RFC3339)})
}
