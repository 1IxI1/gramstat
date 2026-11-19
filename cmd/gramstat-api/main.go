// gramstat-api serves precomputed charts; it never runs aggregation or writes data.
package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/1IxI1/gramstat/internal/api"
	"github.com/1IxI1/gramstat/internal/origin"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:2008", "loopback HTTP listener")
	web := flag.Bool("web", false, "serve the embedded dashboard and API")
	cert := flag.String("tls-cert", "", "certificate chain for the systemd HTTPS socket")
	key := flag.String("tls-key", "", "private key for the systemd HTTPS socket")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if os.Getenv("GRAMSTAT_CH_USER") == "" || os.Getenv("GRAMSTAT_CH_PASSWORD") == "" {
		log.Error("dedicated ClickHouse user and password are required")
		os.Exit(1)
	}
	ch, err := api.NewClickHouse(os.Getenv("GRAMSTAT_CH_URL"), os.Getenv("GRAMSTAT_CH_USER"), os.Getenv("GRAMSTAT_CH_PASSWORD"))
	if err != nil {
		log.Error("invalid ClickHouse configuration")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var handler http.Handler = api.New(api.ClickHouseReader{CH: ch}, log)
	if *web {
		handler = origin.Handler(handler, log)
	}
	if err := serve(ctx, *listen, *web, *cert, *key, handler, log); err != nil {
		log.Error("web server failed", "error", err)
		os.Exit(1)
	}
}

func newServer(h http.Handler) *http.Server {
	p := new(http.Protocols)
	p.SetHTTP1(true)
	return &http.Server{Handler: h, Protocols: p, DisableGeneralOptionsHandler: true,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second,
		IdleTimeout: 15 * time.Second, MaxHeaderBytes: 16 << 10}
}

func httpsSocket() (net.Listener, error) {
	if os.Getenv("LISTEN_PID") != strconv.Itoa(os.Getpid()) || os.Getenv("LISTEN_FDS") != "1" || os.Getenv("LISTEN_FDNAMES") != "https" {
		return nil, fmt.Errorf("one systemd socket named https is required")
	}
	f := os.NewFile(3, "https")
	if f == nil {
		return nil, fmt.Errorf("missing socket descriptor")
	}
	defer f.Close()
	ln, err := net.FileListener(f)
	if err != nil {
		return nil, err
	}
	if a, ok := ln.Addr().(*net.TCPAddr); !ok || a.Port != 443 {
		ln.Close()
		return nil, fmt.Errorf("expected TCP port 443")
	}
	return ln, nil
}

func serve(ctx context.Context, addr string, web bool, cert, key string, h http.Handler, log *slog.Logger) error {
	ap, err := netip.ParseAddrPort(addr)
	if err != nil || !ap.Addr().IsLoopback() {
		return fmt.Errorf("plaintext listener requires a literal loopback address")
	}
	local, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer local.Close()
	s := newServer(h)
	servers := []*http.Server{s}
	results := make(chan error, 2)
	if cert != "" || key != "" || os.Getenv("LISTEN_FDS") != "" {
		if !web || cert == "" || key == "" {
			return fmt.Errorf("HTTPS requires web mode, certificate and key")
		}
		pair, err := tls.LoadX509KeyPair(cert, key)
		if err != nil {
			return err
		}
		now := time.Now()
		if pair.Leaf == nil || pair.Leaf.VerifyHostname(origin.Host) != nil || now.Before(pair.Leaf.NotBefore) || !now.Before(pair.Leaf.NotAfter) {
			return fmt.Errorf("certificate is not valid for %s", origin.Host)
		}
		ln, err := httpsSocket()
		if err != nil {
			return err
		}
		defer ln.Close()
		secure := newServer(h)
		secure.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair},
			GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
				if !strings.EqualFold(hello.ServerName, origin.Host) {
					return nil, fmt.Errorf("unexpected TLS server name")
				}
				return nil, nil
			}}
		servers = append(servers, secure)
		go func() { results <- secure.ServeTLS(origin.Listener(ln), "", "") }()
		log.Info("HTTPS origin listening", "address", ln.Addr().String())
	}
	if web {
		local = origin.Listener(local)
	}
	go func() { results <- s.Serve(local) }()
	log.Info("loopback HTTP listening", "address", addr, "web", web)
	select {
	case err = <-results:
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, srv := range servers {
		_ = srv.Shutdown(shutdown)
	}
	return err
}
