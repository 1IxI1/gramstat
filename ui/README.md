# Gramstat UI

Dependency-free browser UI for the read-only Go `gramstat-api`. nginx serves UI
and `/api/` from one origin on private port **2007**.

API and deployment documentation:
[`docs/api.md`](../docs/api.md).

## Data

- Default range: seven days ending at the latest indexed Supply block. The time
  picker has UTC datetime/calendar inputs, searchable quick ranges, recent ranges,
  previous/next period and zoom out. Its end second is inclusive; API `to` is exclusive.
- Drag horizontally on a chart to select a range. Supply loads a pixel-budgeted
  series from `/api/v1/supply`, down to individual MCs. Daily/validator charts use
  whole UTC days. Fees, issuance, burning and transactions retain daily points
  across the indexed history via `/api/v1/chain`. Activity and validator datasets
  support the full history (up to ten years), including every prepared daily Activity point.
- Click or tap a reading to pin its tooltip; pinned values can be selected and
  copied. Click the same reading again, click outside, or press Escape to dismiss.
- Activity has one Daily / Monthly switch beside its section heading, persisted
  as `activityInterval` in the URL independently of Active wallets' `activity` mode.
  Monthly means UTC calendar months, including entire boundary months. Missing
  daily inputs remain gaps; partial current months are marked. Unique senders,
  receivers and swap users require independently prepared monthly distinct counts.
  Every Activity chart shows an exact-arithmetic mean per displayed series below
  the plot, in units/day or units/month, excluding unknown buckets.
- Supply, daily fees, daily burning and annual inflation show a green dashed marker at
  protocol burning activation: 2023-06-17 06:33:26 UTC, MC 30410593. The marker
  remains visible within the selected range even when the series is unavailable.
- Supply, daily issuance and annual inflation mark **2.5 → 0.4s blocks** at 2026-04-09 07:12:24 UTC,
  MC 59238081: the key block enabling the new consensus on both chains in config
  #30. This marks configuration activation, not a claim of a fixed interval for
  every following block. Sources: [TON Docs](https://docs.ton.org/subsecond),
  config #30 [before](https://toncenter.com/api/v2/getConfigParam?config_id=30&seqno=59238080)
  and [after](https://toncenter.com/api/v2/getConfigParam?config_id=30&seqno=59238081),
  [activation header](https://toncenter.com/api/v2/getBlockHeader?workchain=-1&shard=-9223372036854775808&seqno=59238081).
- Each chart has an expand button. Expanded charts fill most of the viewport;
  Escape or the close button restores the dashboard. The URL keeps the selected
  time range and adds `chart=<catalogue id>` (for example `chart=supply`), so the
  expanded view can be shared or opened directly. Browser Back/Forward restores
  both the selected interval and the corresponding chart view. Range changes
  create history entries immediately; background refreshes do not rewrite them.
- Chain charts: hourly prepared `gramstat.chain_daily_full` (supply, transactions,
  fees, issuance, burning). Days near the indexing boundary are partial.
- Fees, issuance, burning and transactions show `Avg (<selected duration>)` inside
  the plot. It is the arithmetic mean of available displayed UTC-day totals,
  rounded to two decimals using integer arithmetic. Missing values are excluded,
  not replaced by zero. Missing days or included partial totals mark the average
  `partial`; the hover text gives the available-day count. Intraday selections
  still use the whole UTC-day totals shown by these daily charts.
- Annual inflation uses `/api/v1/inflation`: hourly estimates of net supply growth
  annualized from the preceding 24 complete UTC hours. The 24-hour window stays
  fixed when zooming. Negative estimates are supported; incomplete windows and
  unknown/zero supply stay NULL. Supply and inflation support ranges beyond 93 days.
- Accounts uses `/api/v1/accounts`: a stepped stacked area with frozen (light blue)
  at the bottom, uninitialized (yellow) in the middle, and active (green) on top,
  with the total above
  the chart and component counts in the tooltip. It supports full
  history and per-MC zoom, including the verified initial system accounts.
- Activity charts: hourly `daily_metrics` and `telegram_stars_daily`.
- Wallets has three panels: Activated wallets, Activations per day and Active
  wallets. Full definitions remain visible below the plots. Inline `wallet code`
  / `wallet` buttons open the shared registry dialog with 19 hashes (hex and
  base64), 18 type names and source links. The registry digest is tested against
  the aggregator's frozen registry. Standard source references follow
  [TON Docs: Wallet sources](https://docs.ton.org/llms/contracts/standard/wallets/sources/content.md);
  legacy Highload and V5 beta entries link source history, rather than asserting
  that a particular unverified compiler/revision reproduces their hash.
  `/api/v1/wallets` supplies prepared per-MC cumulative values, daily activations
  and exact activity counts with Hourly / Daily / Monthly tabs (Daily by default).
  Monthly shows one exact unique count per complete UTC calendar month.
  Partial months are omitted; tooltips show the exact month boundaries.
  Wide hourly views sample exact hourly observations; zoom does not change the
  chosen counting window. The tab is retained in the `activity` URL parameter.
  Missing
  preparation days remain gaps; the status shows partial coverage during backfill.
- Validators/countries: actual validation rounds, not daily resampling. Location
  details group coordinates and show unknown/located coverage.
- Source update times and coverage are visible. Unknown values remain empty.
  Unsupported metrics show their missing prerequisites. **No generated/demo
  numbers are used by the live UI.**
- Monetary integers stay decimal strings in the API; tooltips retain exact units.
  Floating-point conversion is only for plotting. Stars known subtotal is labelled
  separately and does not replace a NULL full total.

The page reads `/api/v1/coverage`, `/api/v1/dashboard` and `/api/v1/locations`.
Visible pages refresh every five minutes. Serve the UI and proxy `/api/` as shown
in the nginx example.

`ui.test.mjs` checks the live API adapter.

```
node --test ui/*.test.mjs
```

Deployment copies only `index.html`, `app.mjs`, `catalogue.mjs`, `charts.mjs`,
`data.mjs`, `wallet-registry.mjs`, `style.css`, `favicon.svg`. Never serve the repository directory as-is.
