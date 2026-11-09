package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func checkJS(t *testing.T, legacy, wire []byte, activity bool) {
	t.Helper()
	dir := t.TempDir()
	a := filepath.Join(dir, "expected.json")
	b := filepath.Join(dir, "encoded.bin")
	if err := os.WriteFile(a, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b, wire, 0600); err != nil {
		t.Fatal(err)
	}
	decoder, _ := filepath.Abs("../../ui/wire.mjs")
	adapter, _ := filepath.Abs("../../ui/data.mjs")
	script := `import fs from 'node:fs';import assert from 'node:assert/strict';
 const {decodeColumns}=await import(process.argv[1]);
 const expected=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 const bytes=fs.readFileSync(process.argv[4]);
 const actual=decodeColumns(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 for(const key of Object.keys(actual)) assert.equal(Object.getOwnPropertyDescriptor(actual,key).configurable,true);
 // Separate HTTP representations may be prepared on opposite UTC seconds.
 if(expected.servedAt && actual.servedAt) actual.servedAt=expected.servedAt;
 if(process.argv[5]==='activity') {
  const {expandActivityColumns,readObservedMetrics,monthlyActivity}=await import(process.argv[2]);
  const expanded=expandActivityColumns(actual);
  assert.deepEqual(readObservedMetrics(expanded),readObservedMetrics(expected));
  assert.deepEqual(monthlyActivity(expanded),monthlyActivity(expected));
 } else assert.deepEqual(actual,expected);
 assert.throws(()=>decodeColumns(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength-1)));
 `
	mode := "value"
	if activity {
		mode = "activity"
	}
	cmd := exec.Command("node", "--input-type=module", "-e", script, "file://"+decoder, "file://"+adapter, a, b, mode)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Go/JS round trip: %v\n%s", err, out)
	}
}

func TestColumnsRoundTripExactValuesAndMissing(t *testing.T) {
	original := []byte(`{"u8":["0","255",null,"17"],"u16":["256","65535","0"],"u32":["65536","4294967295","5"],"u64":["4294967296","9007199254740993","18446744073709551615"],"u128":["18446744073709551616","99999999999999999999999999999999999999",null],"tooBig":["340282366920938463463374607431768211456","0"],"decimals":["0.000000001","-0.120000000000","001","unknown"],"flags":[0,1,0,1],"time":[1584316800,1584403200,1584489600],"days":["2024-02-28","2024-02-29","2024-03-01"],"months":["2023-12-01","2024-01-01","2024-02-01"],"floats":[-1.25,0.123456789,180.1],"constant":[null,null,null],"rows":[{"a":"0","b":null},{"a":null},{"b":"1"},{}],"unicode":"GRAM · UTC → ✓"}`)
	encoded, err := encodeColumns(original)
	if err != nil {
		t.Fatal(err)
	}
	checkJS(t, original, encoded, false)
	if _, err := encodeColumns([]byte(`[9007199254740993]`)); err == nil {
		t.Fatal("unsafe unquoted counter silently rounded")
	}
	// Dense small counters really use a byte per value, not decimal text/objects.
	values := make([]string, 1000)
	for i := range values {
		if i%2 == 0 {
			values[i] = "17"
		} else {
			values[i] = "28"
		}
	}
	raw, _ := json.Marshal(values)
	small, err := encodeColumns(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(small) > 1020 {
		t.Fatalf("small counter vector not packed: %d bytes", len(small))
	}
}

func TestBinaryCompressionNegotiation(t *testing.T) {
	calls := 0
	s := New(readerFunc(func(context.Context, string, url.Values) (json.RawMessage, error) {
		calls++
		return json.RawMessage(`[{"source":"chain","first_day":"2019-11-15","last_day":"2026-11-09"}]`), nil
	}), logger())
	request := func(accept, encoding string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/v1/coverage", nil)
		r.Header.Set("Accept", accept)
		r.Header.Set("Accept-Encoding", encoding)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return w
	}
	plain := request("application/json", "")
	packed := request(binaryContentType, "gzip")
	if packed.Header().Get("Content-Type") != binaryContentType || packed.Header().Get("Content-Encoding") != "gzip" || packed.Header().Get("Vary") != "Accept, Accept-Encoding" {
		t.Fatal(packed.Header())
	}
	gz, err := gzip.NewReader(bytes.NewReader(packed.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(gz)
	if err != nil {
		t.Fatal(err)
	}
	gz.Close()
	checkJS(t, plain.Body.Bytes(), decoded, false)
	repeated := request(binaryContentType, "gzip")
	if calls != 2 || !bytes.Equal(repeated.Body.Bytes(), packed.Body.Bytes()) {
		t.Fatal("representation cache missed")
	}
	excluded := request(binaryContentType+";q=0", "gzip;q=0")
	if excluded.Header().Get("Content-Encoding") != "" || excluded.Header().Get("Content-Type") == binaryContentType {
		t.Fatal("ignored negotiation exclusion")
	}
}

func TestActivityColumnsPreserveDailyMonthlyAndUnknowns(t *testing.T) {
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 4, 1, 0, 0, 0, 0, time.UTC)
	daily := []map[string]any{}
	stars := []map[string]any{}
	for day := from; day.Before(to); day = day.AddDate(0, 0, 1) {
		date := day.Format(time.DateOnly)
		partial := 0
		if date == "2024-03-31" {
			partial = 1
		}
		row := func(metric, value string, amount any, breakdown map[string]string) {
			daily = append(daily, map[string]any{"metric": metric, "day": date, "value": value, "amount_nanoton": amount, "is_partial": partial, "breakdown": breakdown})
		}
		if date != "2024-02-15" {
			row("jetton_transfers", "9007199254740993", nil, nil)
		}
		row("jetton_senders", "2", nil, nil)
		amount := any("100000000000000000001")
		if date == "2024-01-10" {
			amount = nil
		}
		row("liquid_staking_deposits_tonstakers", "1", amount, nil)
		dex := map[string]string{"a": "2"}
		if day.Day()%2 == 0 {
			dex = map[string]string{"b": "2"}
		}
		row("swaps_total", "2", nil, dex)
		if day.Day() == 1 {
			row("monthly_jetton_senders", "7", nil, nil)
		}
		total := any("9007199254740993")
		unknown := "0"
		if date == "2024-01-03" {
			total = nil
			unknown = "1"
		}
		stars = append(stars, map[string]any{"day": date, "stars_total": total, "known_stars_total": "9007199254740993", "unknown_purchases": unknown, "is_partial": partial})
	}
	d, _ := json.Marshal(daily)
	st, _ := json.Marshal(stars)
	compact, err := makeActivityColumns(from, to, d, st)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(compact)
	encoded, err := encodeColumns(raw)
	if err != nil {
		t.Fatal(err)
	}
	legacy, _ := json.Marshal(map[string]any{"schemaVersion": 2, "network": "mainnet", "period": compact.Period, "chain": []any{}, "rounds": []any{}, "daily": daily, "stars": stars})
	checkJS(t, legacy, encoded, true)
}
