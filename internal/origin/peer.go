package origin

import (
	_ "embed"
	"net"
	"net/netip"
	"strings"
	"sync"
)

// https://api.cloudflare.com/client/v4/ips (no runtime DNS or network dependency).
//
//go:embed cloudflare.txt
var cidrs string

var edge = func() []netip.Prefix {
	var p []netip.Prefix
	for _, s := range strings.Fields(cidrs) {
		p = append(p, netip.MustParsePrefix(s))
	}
	return p
}()

func trusted(ip netip.Addr) bool {
	for _, p := range edge {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// Screen the TCP peer before the TLS handshake and bound idle/handshaking sockets.
type listener struct {
	net.Listener
	slots chan struct{}
}

func Listener(ln net.Listener) net.Listener {
	return &listener{ln, make(chan struct{}, 128)}
}

type countedConn struct {
	net.Conn
	release func()
}

func (c *countedConn) Close() error {
	err := c.Conn.Close()
	c.release()
	return err
}

func (l *listener) Accept() (net.Conn, error) {
	for {
		c, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		addr, err := netip.ParseAddrPort(c.RemoteAddr().String())
		ip := addr.Addr().Unmap()
		if err == nil && (ip.IsLoopback() || trusted(ip)) {
			select {
			case l.slots <- struct{}{}:
				return &countedConn{c, sync.OnceFunc(func() { <-l.slots })}, nil
			default:
			}
		}
		_ = c.Close()
	}
}
