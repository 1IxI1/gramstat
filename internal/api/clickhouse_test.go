package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
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

func TestDatabaseTransportIgnoresEnvironmentProxy(t *testing.T) {
	// net/http caches proxy environment values at first use. A fresh process is
	// necessary so earlier transport tests cannot hide a proxy regression.
	if os.Getenv("GRAMSTAT_TEST_PROXY_CHILD") != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestDatabaseTransportIgnoresEnvironmentProxy$")
		cmd.Env = append(os.Environ(), "GRAMSTAT_TEST_PROXY_CHILD=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("proxy isolation: %v\n%s", err, output)
		}
		return
	}
	// Use a non-loopback hostname: Go bypasses environment proxies for localhost.
	// Replacing the dialer lets this exercise the HTTP transport without DNS.
	var leaked atomic.Bool
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked.Store(true)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer proxy.Close()
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("NO_PROXY", "")
	ch, err := NewClickHouse("http://database.invalid:8123", "reader", "secret")
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer upstream.Close()
	transport := ch.client.Transport.(*http.Transport)
	target, _ := url.Parse(upstream.URL)
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "database.invalid:8123" {
			t.Errorf("unexpected outbound target: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, target.Host)
	}
	defer transport.CloseIdleConnections()
	if _, err := ch.Query(context.Background(), "SELECT 1", nil); err != nil {
		t.Fatal(err)
	}
	if leaked.Load() {
		t.Fatal("database credentials sent to environment proxy")
	}
}
