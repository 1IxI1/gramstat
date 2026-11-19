package origin

import (
	"net/netip"
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	at     time.Time
}

func (b *bucket) refill(now time.Time, rate, burst float64) {
	if b.at.IsZero() {
		b.tokens = burst
	} else {
		b.tokens = min(burst, b.tokens+now.Sub(b.at).Seconds()*rate)
	}
	b.at = now
}

type visitor struct {
	bucket
	active int
	seen   time.Time
}

type limits struct {
	mu      sync.Mutex
	global  bucket
	clients map[netip.Addr]*visitor
	now     func() time.Time
	sweep   time.Time
	active  int
}

func (l *limits) begin(ip netip.Addr, api bool) (func(), bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if l.active >= 128 {
		return nil, false
	}
	if now.After(l.sweep) {
		for k, v := range l.clients {
			if v.active == 0 && now.Sub(v.seen) > time.Minute {
				delete(l.clients, k)
			}
		}
		l.sweep = now.Add(time.Minute)
	}
	if api {
		l.global.refill(now, 30, 61)
		if l.global.tokens < 1 {
			return nil, false
		}
	}
	v := l.clients[ip]
	if v == nil {
		if len(l.clients) >= 16384 {
			return nil, false
		}
		v = &visitor{}
		l.clients[ip] = v
	}
	v.seen = now
	if v.active >= 32 {
		return nil, false
	}
	if api {
		v.refill(now, 5, 21)
		if v.tokens < 1 {
			return nil, false
		}
		v.tokens--
		l.global.tokens--
	}
	v.active++
	l.active++
	return func() {
		l.mu.Lock()
		v.active--
		l.active--
		l.mu.Unlock()
	}, true
}
