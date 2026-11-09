package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"time"
)

const dailyColumnsSQL = `SELECT metric,day,toString(value) AS value,
 toString(amount_nanoton) AS amount_nanoton,is_partial,
 mapApply((k,v)->(k,toString(v)),breakdown) AS breakdown
 FROM gramstat.daily_metrics FINAL WHERE day >= {from:Date} AND day < {to:Date} ORDER BY metric,day`
const starsColumnsSQL = `SELECT day,toString(stars_total) AS stars_total,
 toString(known_stars_total) AS known_stars_total,toString(unknown_purchases) AS unknown_purchases,is_partial
 FROM gramstat.telegram_stars_daily FINAL WHERE day >= {from:Date} AND day < {to:Date} ORDER BY day`
const chainColumnsSQL = `SELECT day,toString(transactions) AS transactions,
 toString(fees_nanoton) AS fees_nanoton,toString(minted_nanoton) AS minted_nanoton,
 toString(burned_nanoton) AS burned_nanoton,toString(supply_nanoton) AS supply_nanoton,supply_utime,is_partial
 FROM gramstat.chain_daily_full FINAL WHERE day >= {from:Date} AND day < {to:Date} ORDER BY day`

type metricColumn struct {
	Metric    string               `json:"metric"`
	Values    []*string            `json:"values"`
	Amounts   []*string            `json:"amounts"`
	Partial   []int                `json:"partial"`
	Breakdown map[string][]*string `json:"breakdown,omitempty"`
}
type starsColumn struct {
	Total   []*string `json:"total"`
	Known   []*string `json:"known"`
	Unknown []*string `json:"unknown"`
	Partial []int     `json:"partial"`
}
type activityColumns struct {
	Period  map[string]string `json:"period"`
	Dates   []string          `json:"dates"`
	Metrics []*metricColumn   `json:"metrics"`
	Stars   starsColumn       `json:"stars"`
}

// Both display modes share these prepared observations. Fetch full boundary
// months once, so toggling Daily/Monthly needs neither another scan nor download.
func (s *Server) loadColumns(ctx context.Context, q url.Values) ([]byte, error) {
	result := map[string]any{"schemaVersion": 3, "network": "mainnet", "period": map[string]string{"from": q.Get("from"), "to": q.Get("to")}, "servedAt": time.Now().UTC().Format(time.RFC3339)}
	for key, query := range map[string]string{"chain": "chain_columns", "rounds": "rounds"} {
		rows, err := s.reader.Read(ctx, query, q)
		if err != nil {
			return nil, err
		}
		result[key] = rows
	}
	from, _ := time.Parse(time.DateOnly, q.Get("from"))
	to, _ := time.Parse(time.DateOnly, q.Get("to"))
	from = time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := to.AddDate(0, 0, -1)
	to = time.Date(last.Year(), last.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	tomorrow := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, 1)
	if to.After(tomorrow) {
		to = tomorrow
	}
	params := url.Values{"from": {from.Format(time.DateOnly)}, "to": {to.Format(time.DateOnly)}}
	daily, err := s.reader.Read(ctx, "daily_columns", params)
	if err != nil {
		return nil, err
	}
	stars, err := s.reader.Read(ctx, "stars_columns", params)
	if err != nil {
		return nil, err
	}
	activity, err := makeActivityColumns(from, to, daily, stars)
	if err != nil {
		return nil, err
	}
	result["activity"] = activity
	return json.Marshal(result)
}

func makeActivityColumns(from, to time.Time, daily, stars json.RawMessage) (activityColumns, error) {
	n := int(to.Sub(from) / (24 * time.Hour))
	result := activityColumns{Period: map[string]string{"from": from.Format(time.DateOnly), "to": to.Format(time.DateOnly)}, Dates: make([]string, n), Metrics: []*metricColumn{}, Stars: starsColumn{make([]*string, n), make([]*string, n), make([]*string, n), make([]int, n)}}
	positions := map[string]int{}
	for i := range result.Dates {
		day := from.AddDate(0, 0, i).Format(time.DateOnly)
		result.Dates[i] = day
		positions[day] = i
	}
	var rows []struct {
		Metric    string            `json:"metric"`
		Day       string            `json:"day"`
		Value     *string           `json:"value"`
		Amount    *string           `json:"amount_nanoton"`
		Partial   int               `json:"is_partial"`
		Breakdown map[string]string `json:"breakdown"`
	}
	if err := json.Unmarshal(daily, &rows); err != nil {
		return result, err
	}
	metrics := map[string]*metricColumn{}
	for _, r := range rows {
		i, ok := positions[r.Day]
		if !ok {
			return result, fmt.Errorf("activity day outside requested range")
		}
		m := metrics[r.Metric]
		if m == nil {
			m = &metricColumn{Metric: r.Metric, Values: make([]*string, n), Amounts: make([]*string, n), Partial: make([]int, n), Breakdown: map[string][]*string{}}
			metrics[r.Metric] = m
		}
		if m.Values[i] != nil {
			return result, fmt.Errorf("duplicate prepared activity day")
		}
		m.Values[i], m.Amounts[i], m.Partial[i] = r.Value, r.Amount, r.Partial
		for key := range r.Breakdown {
			if m.Breakdown[key] == nil {
				m.Breakdown[key] = make([]*string, n)
			}
		}
	}
	// A missing DEX on an observed swaps row is zero. A missing source row is null.
	zero := "0"
	for _, r := range rows {
		m := metrics[r.Metric]
		i := positions[r.Day]
		for key, values := range m.Breakdown {
			v, ok := r.Breakdown[key]
			if ok {
				values[i] = &v
			} else if r.Value != nil {
				values[i] = &zero
			}
		}
	}
	names := make([]string, 0, len(metrics))
	for name := range metrics {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		result.Metrics = append(result.Metrics, metrics[name])
	}
	var starRows []struct {
		Day     string  `json:"day"`
		Total   *string `json:"stars_total"`
		Known   *string `json:"known_stars_total"`
		Unknown *string `json:"unknown_purchases"`
		Partial int     `json:"is_partial"`
	}
	if err := json.Unmarshal(stars, &starRows); err != nil {
		return result, err
	}
	for _, r := range starRows {
		i, ok := positions[r.Day]
		if !ok {
			return result, fmt.Errorf("Stars day outside requested range")
		}
		if result.Stars.Known[i] != nil {
			return result, fmt.Errorf("duplicate prepared Stars day")
		}
		result.Stars.Total[i], result.Stars.Known[i], result.Stars.Unknown[i], result.Stars.Partial[i] = r.Total, r.Known, r.Unknown, r.Partial
	}
	return result, nil
}
