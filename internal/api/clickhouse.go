package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ClickHouse is the reader's transport. It has no insert/schema helpers and
// always requests readonly mode, in addition to the server's SELECT-only role.
type ClickHouse struct {
	endpoint       *url.URL
	user, password string
	client         *http.Client
}

func NewClickHouse(endpoint, user, password string) (*ClickHouse, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("GRAMSTAT_CH_URL must be an HTTP(S) endpoint without credentials or query parameters")
	}
	return &ClickHouse{u, user, password, &http.Client{
		Timeout:       15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *ClickHouse) Query(ctx context.Context, query string, params url.Values) ([]byte, error) {
	u := *c.endpoint
	p := make(url.Values)
	for k, v := range params {
		p[k] = v
	}
	p.Set("query", query)
	p.Set("readonly", "1")
	p.Set("wait_end_of_query", "1")
	u.RawQuery = p.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.user, c.password)
	resp, err := c.client.Do(req)
	if err != nil {
		if e, ok := err.(*url.Error); ok {
			err = e.Err
		}
		return nil, fmt.Errorf("ClickHouse read: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 8<<20 {
		return nil, fmt.Errorf("ClickHouse response too large")
	}
	if resp.StatusCode != http.StatusOK || resp.Header.Get("X-ClickHouse-Exception-Code") != "" || strings.HasPrefix(string(data), "Code:") {
		message := strings.TrimSpace(string(data))
		if len(message) > 2048 {
			message = message[:2048]
		}
		return nil, fmt.Errorf("ClickHouse HTTP %d: %s", resp.StatusCode, message)
	}
	return data, nil
}
