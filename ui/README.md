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
  whole UTC days up to 93 days; wider ranges show Supply and an explanatory message.
- Supply, daily burning and annual inflation show a green dashed marker at
  protocol burning activation: 2023-06-17 06:33:26 UTC, MC 30410593. The marker
  remains visible within the selected range even when the series is unavailable.
- Chain charts: hourly prepared `gramstat.chain_daily_full` (supply, transactions,
  fees, issuance, burning). Days near the indexing boundary are partial.
- Activity charts: hourly `daily_metrics` and `telegram_stars_daily`.
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
`data.mjs`, `style.css`, `favicon.svg`. Never serve the repository directory as-is.
