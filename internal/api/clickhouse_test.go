package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestReadTransportCredentialsAndErrors(t *testing.T) {
	for _, endpoint := range []string{"file:///etc/passwd", "https://user:secret@example.com", "https://example.com/?password=secret"} {
		if _, err := NewClickHouse(endpoint, "reader", "secret"); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatal("credential-bearing endpoint accepted or echoed")
		}
	}
	var redirected atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Store(true) }))
	defer target.Close()
	for _, mode := range []string{"ok", "exception", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				u, p, ok := r.BasicAuth()
				if !ok || u != "reader" || p != "secret" || strings.Contains(r.URL.String(), "secret") {
					t.Error("unsafe credential transport")
				}
				if r.URL.Query().Get("readonly") != "1" || r.URL.Query().Has("async_insert") {
					t.Error("read-only settings lost")
				}
				switch mode {
				case "exception":
					w.Header().Set("X-ClickHouse-Exception-Code", "241")
					_, _ = w.Write([]byte("Code: 241. read failed"))
				case "redirect":
					http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
				default:
					_, _ = w.Write([]byte(`{"data":[]}`))
				}
			}))
			defer upstream.Close()
			ch, err := NewClickHouse(upstream.URL, "reader", "secret")
			if err != nil {
				t.Fatal(err)
			}
			_, err = ch.Query(context.Background(), "SELECT 1", url.Values{"readonly": {"0"}})
			if (err == nil) != (mode == "ok") {
				t.Fatalf("mode %s: %v", mode, err)
			}
		})
	}
	if redirected.Load() {
		t.Fatal("credentials could follow a redirect")
	}
}
