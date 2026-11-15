package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func versionFixture() map[string]string {
	m := map[string]string{}
	for _, key := range strings.Fields(walletVersions) {
		m[key] = "0"
	}
	m["wallet_tg"], m["wallet_v3r2"] = "9007199254740993", "7"
	return m
}

func TestActivationVersionsExactValidation(t *testing.T) {
	for _, mutate := range []func(map[string]string){
		func(m map[string]string) { delete(m, "wallet_v3r2") },
		func(m map[string]string) { m["unknown"] = "0" },
		func(m map[string]string) { m["wallet_v3r2"] = "8" },
		func(m map[string]string) { m["wallet_v3r2"] = "18446744073709551615" },
	} {
		m := versionFixture()
		mutate(m)
		if err := validateActivationVersions("9007199254741000", m); err == nil {
			t.Fatal(m)
		}
	}
	if err := validateActivationVersions("9007199254741000", versionFixture()); err != nil {
		t.Fatal(err)
	}
	if err := validateActivationVersions("1", nil); err != nil {
		t.Fatal("legacy breakdown must remain unknown")
	}
}

func TestActivationVersionsLiveAndClosedWire(t *testing.T) {
	s := New(readerFunc(func(_ context.Context, name string, _ url.Values) (json.RawMessage, error) {
		switch name {
		case "wallet_activation_state":
			return json.RawMessage(`[{"base_mc":10,"through_mc":12,"from_utime":1794441599,"to_utime":1794441660}]`), nil
		case "wallet_days":
			return json.Marshal([]any{map[string]any{"day": "2026-11-11", "run_id": "00000000-0000-0000-0000-000000000001", "activations": "9007199254741000", "versions": versionFixture()}})
		case "wallet_live_activations":
			return json.Marshal([]any{map[string]any{"day": "2026-11-12", "activations": "9007199254741000", "versions": versionFixture(), "complete_before": 1794441900}})
		default:
			return json.RawMessage(`[]`), nil
		}
	}), logger())
	for _, accept := range []string{"application/json", binaryContentType} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/wallets?from=2026-11-11T00:00:00Z&to=2026-11-12T01:00:00Z", nil)
		req.Header.Set("Accept", accept)
		s.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		if accept == binaryContentType {
			if !strings.HasPrefix(w.Body.String(), "GSC1") {
				t.Fatal("missing binary response")
			}
		} else {
			var result struct {
				Activations struct {
					VersionCoverageDays []string
					Points              []struct {
						Versions map[string]string
						Partial  bool `json:"is_partial"`
					}
				}
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Activations.VersionCoverageDays) != 2 || len(result.Activations.Points) != 2 ||
				result.Activations.Points[0].Versions["wallet_tg"] != "9007199254740993" ||
				!result.Activations.Points[1].Partial {
				t.Fatal(w.Body.String())
			}
		}
	}
}
