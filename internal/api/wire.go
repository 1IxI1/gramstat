package api

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
)

const binaryContentType = "application/vnd.gramstat.columns.v1"

type missingWireValue struct{}
type wireEncoder struct{ bytes.Buffer }

// GSC1 is a lossless column transport. Integer strings remain strings after
// decoding, including values above JS's safe-integer range. Null and absence
// have separate bitmap states; zero is never a missing-value sentinel.
func encodeColumns(data []byte) ([]byte, error) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	e := &wireEncoder{}
	e.WriteString("GSC1")
	if err := e.value(value); err != nil {
		return nil, err
	}
	return e.Bytes(), nil
}
func (e *wireEncoder) uint(v uint64) { var b [10]byte; n := binary.PutUvarint(b[:], v); e.Write(b[:n]) }
func (e *wireEncoder) text(v string) { e.uint(uint64(len(v))); e.WriteString(v) }
func (e *wireEncoder) value(v any) error {
	switch v := v.(type) {
	case nil:
		e.WriteByte(0)
	case bool:
		if v {
			e.WriteByte(2)
		} else {
			e.WriteByte(1)
		}
	case json.Number:
		if !strings.ContainsAny(string(v), ".eE") {
			x, ok := new(big.Int).SetString(string(v), 10)
			if !ok || x.Abs(x).Cmp(big.NewInt(9007199254740991)) > 0 {
				return fmt.Errorf("unsafe integer token: exact counters must be strings")
			}
		}
		n, err := strconv.ParseFloat(string(v), 64)
		if err != nil {
			return err
		}
		e.WriteByte(3)
		var b [8]byte
		binary.LittleEndian.PutUint64(b[:], math.Float64bits(n))
		e.Write(b[:])
	case string:
		e.WriteByte(4)
		e.text(v)
	case missingWireValue:
		e.WriteByte(8)
	case []any:
		return e.array(v)
	case map[string]any:
		e.WriteByte(6)
		keys := wireKeys(v)
		e.uint(uint64(len(keys)))
		for _, k := range keys {
			e.text(k)
			if err := e.value(v[k]); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("unsupported wire value")
	}
	return nil
}
func wireKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
func sameWireScalar(a, b any) bool {
	switch a := a.(type) {
	case nil:
		return b == nil
	case bool:
		v, ok := b.(bool)
		return ok && v == a
	case string:
		v, ok := b.(string)
		return ok && v == a
	case json.Number:
		v, ok := b.(json.Number)
		return ok && v == a
	case missingWireValue:
		_, ok := b.(missingWireValue)
		return ok
	}
	return false
}
func (e *wireEncoder) array(values []any) error {
	n := len(values)
	if n > 1 {
		constant := true
		for _, v := range values[1:] {
			if !sameWireScalar(values[0], v) {
				constant = false
				break
			}
		}
		if constant {
			e.WriteByte(10)
			e.uint(uint64(n))
			return e.value(values[0])
		}
		if e.dateSequence(values) {
			return nil
		}
	}
	if n > 0 {
		table := true
		keys := map[string]any{}
		for _, v := range values {
			row, ok := v.(map[string]any)
			if !ok {
				table = false
				break
			}
			for k := range row {
				keys[k] = nil
			}
		}
		if table {
			e.WriteByte(7)
			e.uint(uint64(n))
			names := wireKeys(keys)
			e.uint(uint64(len(names)))
			for _, k := range names {
				e.text(k)
				column := make([]any, n)
				for i, v := range values {
					row := v.(map[string]any)
					var ok bool
					column[i], ok = row[k]
					if !ok {
						column[i] = missingWireValue{}
					}
				}
				if err := e.array(column); err != nil {
					return err
				}
			}
			return nil
		}
		if e.integers(values) {
			return nil
		}
	}
	e.WriteByte(5)
	e.uint(uint64(n))
	for _, v := range values {
		if err := e.value(v); err != nil {
			return err
		}
	}
	return nil
}
func (e *wireEncoder) integers(values []any) bool {
	kind := -1
	bits := 0
	mask := make([]byte, (len(values)+3)/4)
	hasMask := false
	numbers := make([]*big.Int, len(values))
	for i, v := range values {
		if v == nil {
			mask[i/4] |= 1 << ((i % 4) * 2)
			hasMask = true
			continue
		}
		if _, ok := v.(missingWireValue); ok {
			mask[i/4] |= 2 << ((i % 4) * 2)
			hasMask = true
			continue
		}
		text := ""
		k := 0
		switch v := v.(type) {
		case string:
			text = v
			k = 1
		case json.Number:
			text = string(v)
		default:
			return false
		}
		if kind >= 0 && kind != k {
			return false
		}
		kind = k
		if text == "" || (len(text) > 1 && text[0] == '0') {
			return false
		}
		for _, c := range text {
			if c < '0' || c > '9' {
				return false
			}
		}
		x, ok := new(big.Int).SetString(text, 10)
		if !ok || x.BitLen() > 128 {
			return false
		}
		if k == 0 && x.Cmp(big.NewInt(9007199254740991)) > 0 {
			return false
		}
		numbers[i] = x
		if x.BitLen() > bits {
			bits = x.BitLen()
		}
	}
	if kind < 0 {
		return false
	}
	if kind == 0 && !hasMask && len(values) > 1 {
		start := numbers[0].Uint64()
		next := numbers[1].Uint64()
		if next >= start && (next == start || uint64(len(values)-1) <= (9007199254740991-start)/(next-start)) {
			step := next - start
			seq := true
			for i, x := range numbers {
				if x.Uint64() != start+uint64(i)*step {
					seq = false
					break
				}
			}
			if seq {
				e.WriteByte(11)
				e.uint(uint64(len(values)))
				e.uint(start)
				e.uint(step)
				return true
			}
		}
	}
	width := 1
	for width*8 < bits {
		width *= 2
	}
	e.WriteByte(9)
	e.uint(uint64(len(values)))
	e.WriteByte(byte(kind))
	e.WriteByte(byte(width))
	if hasMask {
		e.WriteByte(1)
		e.Write(mask)
	} else {
		e.WriteByte(0)
	}
	for _, x := range numbers {
		if x == nil {
			continue
		}
		b := make([]byte, width)
		x.FillBytes(b)
		for j := len(b) - 1; j >= 0; j-- {
			e.WriteByte(b[j])
		}
	}
	return true
}
func (e *wireEncoder) dateSequence(values []any) bool {
	days := make([]int64, len(values))
	months := make([]int64, len(values))
	monthAxis := true
	for i, v := range values {
		text, ok := v.(string)
		if !ok || len(text) != 10 {
			return false
		}
		t, err := time.Parse(time.DateOnly, text)
		if err != nil || t.Unix() < 0 {
			return false
		}
		days[i] = t.Unix() / 86400
		months[i] = int64(t.Year()*12 + int(t.Month()) - 1)
		monthAxis = monthAxis && t.Day() == 1
	}
	for _, kind := range []byte{1, 0} {
		if kind == 1 && !monthAxis {
			continue
		}
		axis := days
		if kind == 1 {
			axis = months
		}
		step := axis[1] - axis[0]
		if step < 0 {
			continue
		}
		seq := true
		for i, v := range axis {
			if v != axis[0]+int64(i)*step {
				seq = false
				break
			}
		}
		if seq {
			e.WriteByte(12)
			e.uint(uint64(len(values)))
			e.WriteByte(kind)
			e.uint(uint64(axis[0]))
			e.uint(uint64(step))
			return true
		}
	}
	return false
}
