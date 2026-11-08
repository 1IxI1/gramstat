# Gramstat read-only API

`cmd/gramstat-api` serves prepared ClickHouse statistics over HTTP for the
Gramstat dashboard.

## HTTP contract

- `GET /api/health`: process liveness (not data freshness).
- `GET /api/v1/coverage`: observed first/last day and latest calculation time per
  source. These bounds do not certify gap-free ingestion.
- `GET /api/v1/dashboard?from=2026-10-21&to=2026-10-28`: UTC `[from,to)`, 1–93 days.
  `chain`, `daily`, `stars`, `rounds` arrays in a `schemaVersion: 2` response.
- `GET /api/v1/chain?from=2019-11-15&to=2026-11-01`: UTC `[from,to)`, up to
  3660 days. Returns `chain` and `period`, with one prepared row per day for fees,
  issuance, burning and transactions. Daily values are not downsampled.
- `GET /api/v1/locations?round=<utime_since>`: selected round's coordinate points,
  coverage, cutoff and update timestamp. No raw IP, ADNL or internal record IDs.
- `GET /api/v1/supply?from=2024-08-01T00:00:00Z&to=2024-08-02T00:00:00Z&maxPoints=800`:
  RFC3339 timestamps, exclusive `to`, second precision, up to ten years.
  `maxPoints` defaults to 800 (100–2000). Returns `points` with `utime`, `mc_seqno`
  and exact nullable `supply_nanoton`, plus `intervalSeconds` and `resolution`.
  An interval of 0 means every MC; multiple MCs can have the same Unix second.
  Short windows (at most 48 hours) use bounded MC reads and an opening burn
  checkpoint; larger windows select last observations from hourly checkpoints.
  The actual time/MC of each observation is retained, including NULL final values.
- `GET /api/v1/inflation?from=2024-08-01T00:00:00Z&to=2024-08-02T00:00:00Z&maxPoints=800`:
  the same timestamp and point-budget contract. Reads prepared hourly observations
  of `(minted_24h - burned_24h) / supply × 365 × 100` percent. The calculation
  window is always 86400 seconds; downsampling never changes it. Returns
  `annualized_percent` as a signed decimal string (NULL when unknown), exact input
  nanoGRAM strings, `window_from`, `supply_utime`, and `supply_mc`. Points are stamped
  at closed UTC-hour boundaries; supply is the last MC observation before that
  boundary. Responses include `windowSeconds: 86400` and `annualizationDays: 365`.
- `GET /api/v1/accounts?from=2024-08-01T00:00:00Z&to=2024-08-02T00:00:00Z&maxPoints=800`:
  the same timestamp/point-budget contract. Each point includes `utime`, `mc_seqno`,
  and exact integer strings `total`, `active`, `uninit`, `frozen`. Counts include
  all existing accounts, not just wallets. Deleted accounts are excluded. Hourly
  checkpoints contain a verified opening-state baseline plus all preceding deltas;
  short intervals use bounded per-MC delta reads. Missing coverage produces an
  error or no observations, not a zero opening balance.

GET and HEAD only. Unknown/repeated parameters, invalid dates and future days are
rejected before querying the source. Read failures return a generic 503; SQL and
internal error details stay in server logs. Missing records are empty arrays,
unknown values remain NULL. Integer money and 64-bit counters are decimal strings.
Only UI plot coordinates are converted to floating point; exact monetary strings
remain available in tooltips.

Count and geography snapshots join only when their roster digest and #34 hash
match. A stale geography snapshot never attaches to a changed roster. Round
timestamps are preserved rather than assigned to UTC daily buckets.

## Sources

The API reads these prepared tables:

```
gramstat.chain_daily_full
gramstat.supply_hourly
gramstat.inflation_hourly
gramstat.accounts_hourly
gramstat.daily_metrics
gramstat.telegram_stars_daily
gramstat.validator_rounds
gramstat.validator_geo_rounds
```

`chain_daily_full` contains daily transactions, fees, issuance, burning and supply.
`supply_hourly` contains UTC-hour MC boundaries, opening/closing cumulative burned
amounts, and the corrected last-MC supply. Coverage also reports the `supply`
source with `first_utime` and `last_utime`. The Supply reader has SELECT access to
indexed `blocks` for short intervals; it bounds reads by MC primary-key ranges.
`daily_metrics` contains action counts and amounts; `telegram_stars_daily` provides
Stars purchase totals. The validator tables contain round-level rosters and
geographical observations.

Each source can have different coverage and update times. Use `/api/v1/coverage`
and the timestamps and partial flags on individual records. Bounded chain datasets
can have partial edge days because shard generation timestamps can straddle the
including-MC bounds. Missing monetary inputs remain NULL.
Supply uses the last masterchain block of each UTC day; its own timestamp is
returned. Before mainnet MC 103190382, the value is the stored global balance
minus cumulative masterchain burning through that block. From that block onward,
the stored balance already accounts for burning. Missing balances or an incomplete
required burn prefix remain NULL; the last non-NULL balance is not used as a fallback.

Absolute account and token counts require complete historical coverage; wallet
activity also depends on prior wallet deployments. Unavailable metrics display
their missing prerequisites in the UI.

## Deployment

Build with `go build ./cmd/gramstat-api`. The provided
[systemd unit](../deploy/gramstat-api.service) runs as
an unprivileged `gramstat-api` user, bound to `127.0.0.1:2008`.
Its root-owned mode-0600 `/etc/gramstat-api.env` contains:

```
GRAMSTAT_CH_URL=http://clickhouse.example.com:8123/
GRAMSTAT_CH_USER=gramstat_api
GRAMSTAT_CH_PASSWORD=<server-managed secret>
```

Use a separate ClickHouse user restricted to the application host, with `readonly=1`
and SELECT on the tables above plus indexed `blocks` and `account_deltas`. Set its profile limits to match the fixed
query settings: `max_execution_time=10`, `max_threads=2`,
`max_memory_usage=268435456`, `max_result_rows=20000`,
`max_result_bytes=4194304`, `result_overflow_mode='throw'`,
`max_rows_to_read=2000000`, `read_overflow_mode='throw'`,
`join_use_nulls=1`, `output_format_json_quote_64bit_integers=1`,
`max_concurrent_queries_for_user=4`. No INSERT/DDL or raw-database grants.

The [nginx example](../deploy/nginx.conf) binds port
**2007 only on the private address** (`PRIVATE_BIND_ADDRESS`). `/` serves the UI,
`/api/` proxies the loopback service. Static paths are allowlisted; historical
snapshots, provenance and repository files are not served. Copy only `index.html`,
`app.mjs`, `catalogue.mjs`, `charts.mjs`, `data.mjs`, `style.css`, `favicon.svg`
from this repository's `ui/` into `/opt/gramstat/ui`. Validate with `nginx -t` before reload.

For HTTPS deployment through HAProxy, terminate TLS at the proxy and forward
requests to the private nginx listener. All frontend API requests are same-origin.
Configure trusted proxy IPs explicitly before enabling real-IP forwarding and
rate limiting; never trust client-supplied X-Forwarded-For globally.

The API caches complete successful responses for five minutes, coalesces same-key
misses, allows four source loads concurrently and retains at most 32 entries of
at most 4 MiB. HTTP has a 15-second request deadline; nginx also limits request
rate. Failed loads are not cached as successful zero data. The UI refreshes every
five minutes while visible and shows per-source freshness and per-point partial
coverage. Public GET responses can be cached for 60 seconds.

## Verification

```
make test
make vet
```

The SQL integration test uses isolated ClickHouse-local consumer fixtures and
executes every read query: exact money, NULL fees, partial flags and rejecting
stale geo joins. HTTP tests cover input limits, cache coalescing, rejected writes
and safe errors. Before exposing an installation,
check read access and denial of writes for its actual ClickHouse role, API payloads,
static allowlist, headers and the UI in a browser.
