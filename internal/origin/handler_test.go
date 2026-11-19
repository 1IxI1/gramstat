package origin

import (
	"crypto/tls"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"
)

func testHandler() http.Handler {
	return handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}), slog.New(slog.NewTextHandler(io.Discard, nil)), func() time.Time { return time.Unix(1000, 0) })
}

func edgeRequest(path string) *http.Request {
	r := httptest.NewRequest("GET", "https://"+Host+path, nil)
	r.TLS = &tls.ConnectionState{ServerName: Host}
	r.RemoteAddr = "173.245.48.5:12222"
	r.Header.Set("CF-Connecting-IP", "192.0.2.1")
	return r
}

func TestPeerIdentity(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*http.Request)
		want string
	}{
		{"edge", func(r *http.Request) { r.Header.Set("X-Forwarded-For", "192.0.2.9") }, "192.0.2.1"},
		{"ipv6 edge", func(r *http.Request) { r.RemoteAddr = "[2606:4700::1]:222" }, "192.0.2.1"},
		{"direct with CF header", func(r *http.Request) { r.RemoteAddr = "10.0.0.1:2222" }, ""},
		{"untrusted TLS host", func(r *http.Request) { r.Host = "other.test" }, ""},
		{"untrusted SNI", func(r *http.Request) { r.TLS.ServerName = "other.test" }, ""},
		{"plaintext edge", func(r *http.Request) { r.TLS = nil }, ""},
		{"missing client", func(r *http.Request) { r.Header.Del("CF-Connecting-IP") }, ""},
		{"duplicate client", func(r *http.Request) { r.Header.Add("CF-Connecting-IP", "192.0.2.9") }, ""},
		{"malformed client", func(r *http.Request) { r.Header.Set("CF-Connecting-IP", "192.0.2.1,192.0.2.2") }, ""},
		{"loopback ignores forwarded IP", func(r *http.Request) { r.RemoteAddr = "127.0.0.1:1234"; r.TLS = nil }, "127.0.0.1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := edgeRequest("/")
			tc.edit(r)
			ip, ok := client(r)
			if ok != (tc.want != "") || ok && ip.String() != tc.want {
				t.Fatalf("got %v, %t", ip, ok)
			}
		})
	}
}

func TestWebSurface(t *testing.T) {
	handler := testHandler()
	for path, want := range map[string]int{"/": 200, "/app.mjs": 200, "/fonts/InterVariable-Italic.woff2": 200,
		"/api/health": 204, "/README.md": 404, "/ui.test.mjs": 404, "/fonts/": 404, "/%2e%2e/go.mod": 404} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, edgeRequest(path))
		if w.Code != want || w.Header().Get("Content-Security-Policy") == "" || w.Header().Get("Strict-Transport-Security") == "" {
			t.Errorf("%s: %d, headers %v", path, w.Code, w.Header())
		}
	}
	for _, prefix := range []string{"/index.html", "/api/health"} {
		for _, tc := range []struct {
			edit func(*http.Request)
			want int
		}{
			{func(r *http.Request) { r.Method = "POST" }, 405},
			{func(r *http.Request) { r.ContentLength = 1 }, 400},
			{func(r *http.Request) { r.TransferEncoding = []string{"chunked"} }, 400},
			{func(r *http.Request) { r.RequestURI += strings.Repeat("x", 2048) }, 414},
			{func(r *http.Request) { r.RemoteAddr = "192.0.2.25:45" }, 403},
		} {
			r := edgeRequest(prefix)
			tc.edit(r)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Errorf("%s: got %d, want %d", prefix, w.Code, tc.want)
			}
		}
	}
	r := edgeRequest("/index.html")
	r.Method = "HEAD"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") == "" {
		t.Fatal("incorrect HEAD response")
	}
}

func TestBurstIsolation(t *testing.T) {
	h := testHandler()
	request := func(ip string) int {
		r := edgeRequest("/api/health")
		r.Header.Set("CF-Connecting-IP", ip)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < 21; i++ {
		if request("192.0.2.1") != 204 {
			t.Fatal("per-client burst cut short")
		}
	}
	if request("192.0.2.1") != 429 || request("192.0.2.2") != 204 {
		t.Fatal("visitors behind one edge must have independent limits")
	}
	for i := 0; i < 39; i++ {
		if request(netip.AddrFrom4([4]byte{192, 0, 2, byte(i + 3)}).String()) != 204 {
			t.Fatal("global burst cut short")
		}
	}
	if request("192.0.2.100") != 429 {
		t.Fatal("missing global burst limit")
	}
}

type testConn struct {
	net.Conn
	ip     string
	closed bool
}

func (c *testConn) RemoteAddr() net.Addr { return &net.TCPAddr{IP: net.ParseIP(c.ip), Port: 80} }
func (c *testConn) Close() error         { c.closed = true; return nil }

type queue struct {
	net.Listener
	conns []*testConn
}

func (q *queue) Accept() (net.Conn, error) {
	if len(q.conns) == 0 {
		return nil, io.EOF
	}
	c := q.conns[0]
	q.conns = q.conns[1:]
	return c, nil
}

func TestListenerTrustAndConnectionLimitBeforeTLS(t *testing.T) {
	bad, edge, extra := &testConn{ip: "10.1.2.3"}, &testConn{ip: "173.245.48.8"}, &testConn{ip: "127.0.0.1"}
	q := &queue{conns: []*testConn{bad, edge, extra}}
	l := &listener{q, make(chan struct{}, 1)}
	c, err := l.Accept()
	if err != nil || !bad.closed || c.RemoteAddr().String() != edge.RemoteAddr().String() {
		t.Fatal("untrusted peer must be closed before delivery")
	}
	if _, err := l.Accept(); err != io.EOF || !extra.closed {
		t.Fatal("excess connection accepted")
	}
	c.Close()
	c.Close()
	q.conns = []*testConn{{ip: "127.0.0.1"}}
	if c, err = l.Accept(); err != nil {
		t.Fatal("closed connection didn't release the slot")
	}
	c.Close()
}
