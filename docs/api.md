# Gramstat read-only API

`cmd/gramstat-api` serves prepared ClickHouse statistics over HTTP for the
Gramstat dashboard.

## HTTP contract

- `GET /api/v2/dashboard?from=2019-11-15&to=2026-08-16`: UTC `[from,to)`,
  the same 3660-day bound as v1. `schemaVersion: 3` returns compact `chain` and
  `rounds`, plus `activity` columns sharing one `dates` axis. Activity includes
  complete boundary calendar months, capped at tomorrow UTC. Its `metrics`
  vectors contain exact `values`, nullable `amounts`, `partial` flags and optional
  DEX `breakdown` vectors; Stars has `total`, `known`, `unknown`, `partial` vectors.
  Missing rows are null, observed zeros remain zero. `monthly_` metrics are the
  independently prepared unique-address counts. The UI slices Daily to the
  selected range and calculates Monthly from the prefetched months with the same
  adapters as v1, without a second request or summing daily distinct users.

All data routes support `Accept: application/vnd.gramstat.columns.v1` for the
lossless **GSC1** binary representation, and `Accept-Encoding: gzip`. Without the
binary Accept header, responses remain JSON (v1 contracts are unchanged).
Representations are cached separately and advertise `Vary: Accept, Accept-Encoding`.
`Server-Timing: prepare` reports server preparation/cache time, excluding download.

### GSC1 transport

Four ASCII magic bytes `GSC1` precede one recursively encoded value. Lengths are
unsigned base-128 varints; text is UTF-8 preceded by its byte length. Tags:

| Tag | Encoding |
| --- | --- |
| 0 / 1 / 2 | null / false / true |
| 3 | little-endian float64 (JSON floating-point values and safe scalar numbers) |
| 4 | text |
| 5 | array length, recursively encoded items |
| 6 | object key count, text key / value pairs |
| 7 | table row count, column count, text key / encoded column-array pairs |
| 8 | absent object property (distinct from null) |
| 9 | vector length, number/string kind byte, width byte, mask-present byte, optional mask, packed integers |
| 10 | vector length and one repeated scalar value |
| 11 | number sequence length, start and step varints |
| 12 | date sequence length, axis-kind byte (UTC day=0, calendar month=1), start and step varints |

Integer widths are chosen from 1, 2, 4, 8 or 16 bytes after inspecting the entire
vector. Kind 0 restores JSON numbers; kind 1 restores integer strings. Values are
unsigned little-endian. The optional bitmap uses two bits per position, low bits
first: 0=value, 1=null, 2=absent; no integer bytes are stored for null/absent
positions. Numeric strings are restored through BigInt to exact strings in JS;
money never passes through Number. Non-integer strings retain their original
text, including fractional zeros. Unsafe unquoted integer tokens are rejected.
Date-axis starts are Unix days or `year * 12 + month - 1`. The reference decoder
is `ui/wire.mjs`; cross-language tests compare Go encoding with this decoder.

### Legacy routes

- `GET /api/health`: process liveness (not data freshness).
- `GET /api/v1/coverage`: observed first/last day and latest calculation time per
  source. These bounds do not certify gap-free ingestion.
- `GET /api/v1/dashboard?from=2019-11-15&to=2026-10-28`: UTC `[from,to)`, 1–3660 days.
  `chain`, `daily`, `stars`, `rounds` arrays in a `schemaVersion: 2` response.
  All prepared daily Activity observations are retained across the full history.
- `GET /api/v1/activity?from=2026-10-01&to=2026-11-10`: the same date limits,
  returning only prepared `daily` and `stars` data (`chain` and `rounds` are empty).
  Monthly UI requests cover whole UTC calendar months, capped at tomorrow UTC.
  Additive counts/amounts are summed exactly from all available days; a missing day
  leaves the monthly value unknown. Current partial months are marked. Unique
  addresses use `monthly_jetton_senders`, `monthly_jetton_receivers`,
  `monthly_nft_senders`, `monthly_nft_receivers`, and `monthly_swaps_users` rows
  keyed by month start, prepared by the aggregator directly from source actions.
  Daily distinct counts are never summed to estimate monthly distinct addresses.
- `GET /api/v1/chain?from=2019-11-15&to=2026-11-01`: UTC `[from,to)`, up to
  3660 days. Returns `chain` and `period`, with one prepared row per day for fees,
  issuance, burning and transactions. Daily values are not downsampled.
- `GET /api/v1/validators?from=2019-11-15&to=2026-11-01`: UTC `[from,to)`, up to
  3660 days. Returns `rounds` and `period`, with elected validator counts for every
  prepared round overlapping the interval. Geography is not included. Round
  timestamps and partial-coverage flags are retained; counts are not downsampled.
- `GET /api/v1/locations?round=<utime_since>`: selected round's coordinate points,
  coverage, cutoff and update timestamp. No raw IP, ADNL or internal record IDs.
- `GET /api/v1/locations?at=<Unix-second>`: latest prepared location snapshot
  whose exclusive cutoff is at most `at + 1`. `at` is the inclusive selected
  end second, no later than today UTC; use exactly one of `at` or `round`.
  Both variants return `locations`, including the round's `utime_until`.
  Roster, config hash and round interval must match. The map displays the actual
  snapshot time and coverage, not an interpolated position at an arbitrary second.
  Missing snapshots return an empty array; unlocated snapshots retain unknown counts.
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

- `GET /api/v1/wallets?from=2024-08-01T00:00:00Z&to=2024-08-02T00:00:00Z&maxPoints=800`:
  the same timestamp contract. Returns `activated`, `activations`, `active`, each
  with `points` (`utime`, exact integer-string `value`, and MC for cumulative
  points) and `intervalSeconds`. Cumulative points obey the budget and preserve
   same-second MCs at interval 0. `activity=hourly|daily|monthly` selects a fixed
   window; default `daily`. Hourly uses 3600-second UTC buckets, daily 86400.
   Monthly returns one exact unique count per complete UTC calendar month,
   requiring all 28–31 days certified. Each point's `utime` is month start and
   `end_utime` is next month start (exclusive). `calendarMonths=true` marks this
   variable-length calendar window; `intervalSeconds` and `windowSeconds` are 0.
   `active.coverageDays` contains month-start dates in this mode. Other modes use
   fixed `windowSeconds` and `intervalSeconds` and daily coverage dates.
   Wide hourly views select the last exact hourly observation in each display bin,
   never sum or union hours: `sampleStepSeconds` reports this sampling stride.
   Sampled hourly responses also include `active.average` with exact integer-string
   `sum` and integer `count` across every covered hour, so the displayed mean is
   independent of plot sampling. Missing hours are excluded rather than zeroed.
   Daily/monthly activity and activations retain all buckets beyond the target
   point budget. Boundary buckets are whole aligned intervals. `coverageDays`
  identifies prepared days, `registry` identifies the frozen code registry.
   Hourly/daily series bind to the same published run per day; monthly counts
   retain all contributing verified day versions in `wallet_months`.
   The API role needs SELECT on that scalar table. Unverified preparations are
  excluded and missing days are gaps. The source epoch is fixed server-side;
  clients cannot select arbitrary databases, registries or run IDs.

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
gramstat.validator_stake_rounds
```

`chain_daily_full` contains daily transactions, fees, issuance, burning and supply.
`supply_hourly` contains UTC-hour MC boundaries, opening/closing cumulative burned
amounts, and the corrected last-MC supply. Coverage also reports the `supply`
source with `first_utime` and `last_utime`. The Supply reader has SELECT access to
indexed `blocks` for short intervals; it bounds reads by MC primary-key ranges.
`daily_metrics` contains action counts and amounts; `telegram_stars_daily` provides
Stars purchase totals. The validator tables contain round-level rosters and
geographical observations.

Validator responses also contain `submitted_nanogram`, `selected_nanogram` and
`remaining_nanogram`: nullable exact integer strings for the three stages of
one election. They are aligned to its validation round, with `election_id`,
`unfreeze_utime` and `stake_status` retaining the stage context. Remaining is
principal immediately before release, after fines and **without rewards**.
Stake snapshots join only matching verified intervals, config hashes and rosters.
Each line can have different historical coverage; missing final results remain
NULL even for closed rounds. The API role requires SELECT on the new table.
`reward_nanogram` is the separately recorded accumulated election reward before
distribution, from the same verified release result. It excludes principal and
is plotted as lower-panel bars with a right-hand GRAM axis. It is not an APR or
a claim about final per-holder credits after rounding and banned positions.

`apr_percent` is the prepared, nullable decimal percentage string (up to 12 decimal
places), not an APY. Formula: `reward_nanogram / selected_nanogram *
31,536,000 / apr_cycle_seconds * 100`. The cycle comprises this round and its
immediate successor, using their verified intervals; `apr_next_utime_until`
identifies its end. Both rounds must be complete, with no gap or overlap, the
selected principal must be positive, and a verified release reward must exist.
A known zero reward yields zero APR; missing inputs yield NULL with `apr_status`.
The API rechecks both interval proofs, including the successor outside the
requested date range, and hides stale APR after corrections. This is gross reward
APR relative to selected capital, without reinvestment, pool fee deductions or
subtraction of lost principal. It is not an individual depositor's realized yield.

Round responses also expose `stake_change_*` fields for comparisons with `n−2`:
`previous` (the earlier round start), `previous_holders`, `current_holders`,
`matched`, `new`, `exited`, and five mutually exclusive counts: `near_reward`,
`below_reward`, `above_reward`, `unchanged`, `decreased`. Counts are nullable UInt32
JSON numbers; known zeros stay zero. The five counts sum to `matched`; `status`
must be `complete` to plot percentages. Holder addresses combine all their keys;
new/exited addresses are not in the denominator. This describes stake changes,
not proven reinvestment. A positive change is near the old proportional reward
within the greater of 2% or 5 GRAM. Unchanged/decreased take precedence.

Both predecessor intervals and their config/roster proofs are checked even when
outside the requested window. Missing mappings, unreconciled penalty allocation,
late releases or gaps leave unknown points. The API reads only the prepared
`gramstat.validator_stake_changes` table (grant SELECT to its read-only role).

### Total Stake Locked

`rounds` and `validators` project the prepared
`gramstat.validator_stake_locked_rounds` table (the API role needs SELECT).
`locked_total_nanogram`, `locked_telegram_nanogram`, `locked_pools_nanogram`,
`locked_others_nanogram` and `locked_previous_selected_nanogram` are nullable
exact decimal strings. `locked_pool_breakdown` maps protocol/`-like` labels to
exact decimal strings. `locked_previous` identifies the adjacent prior round;
coverage fields are `locked_positions`, `locked_typed_positions`,
`locked_isp_observed_positions`, `locked_data_through`, `locked_is_partial`,
and `locked_status`.

Both config/roster proofs, adjacency, previous-round completion and both selected
principal snapshots are rechecked at read time. Source corrections suppress stale
totals until aggregation catches up. No member arrays, raw IPs or internal evidence
record IDs are returned. Long round reads use at most 732-day chunks within the
existing source result budget; a round crossing a chunk boundary appears once.

The UI replaces Telegram share / Liquid staking share with **Total Stake Locked**:
three stepped areas (Telegram, Liquid Staking, Others), plus an independent Total
line. The line preserves known total history when the breakdown is unavailable;
it is never added into the stack. Tooltip money, including the total and pool-type
breakdown, is formatted directly from exact decimal strings. Hiding series does
not renormalize amounts. The chart links to the aggregator's full address registry
and attribution rules; the agreed two-paragraph description is displayed verbatim.

The `chain` coverage row also exposes nullable `last_complete_day`, the latest
UTC day with `is_partial = 0`. The dashboard's `Last…` presets and initial 90-day
range end no later than this day's end, even when newer blocks are available.

UI theme colors use TON blue (`#0098EA`) and the current official `ton.org`
dark UI palette: background `#10161F`, surface `#101B2A`, accent `#1EAEFB`,
text `#D9E6F2`, muted `#93A5B8`, and border `#364459` (verified from
`https://ton.org/_astro/global.vqBiqSff.css`). The light theme adapts these to
white surfaces; auxiliary chart categories retain distinct semantic colors.

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
Wallet counts have an interval-first projection so daily queries do not scan
the neighboring minute/hour rows across the full history.
Full-history Activity reads prepared daily rows in at most 366-day batches to
respect these per-query limits, then returns the complete history in one response.

The [nginx example](../deploy/nginx.conf) binds port
**2007 only on the private address** (`PRIVATE_BIND_ADDRESS`). `/` serves the UI,
`/api/` proxies the loopback service. Static paths are allowlisted; historical
snapshots, provenance and repository files are not served. Copy only `index.html`,
`app.mjs`, `catalogue.mjs`, `charts.mjs`, `data.mjs`, `wire.mjs`, `wallet-registry.mjs`, `style.css`, `favicon.svg`
from this repository's `ui/` into `/opt/gramstat/ui`. Validate with `nginx -t` before reload.
Also copy `ui/fonts/` for the self-hosted Inter variable fonts (normal and italic)
and their SIL Open Font License. These are unmodified Inter v4.1 files from
`rsms/inter`, commit `e3a3d4c57d5ecc01453a575621882a384c1995a3`,
`docs/font-files/InterVariable{,-Italic}.woff2`. The nginx allowlist serves only
the two WOFF2 files; no third-party font service is required.

For HTTPS deployment through HAProxy, terminate TLS at the proxy and forward
requests to the private nginx listener. All frontend API requests are same-origin.
Configure trusted proxy IPs explicitly before enabling real-IP forwarding and
rate limiting; never trust client-supplied X-Forwarded-For globally.

The API caches complete successful responses for five minutes, coalesces same-key
misses, allows four source loads concurrently and retains at most 32 entries of
at most 32 MiB, with a 64-MiB total cache budget. HTTP has a 15-second request deadline; nginx also limits request
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
