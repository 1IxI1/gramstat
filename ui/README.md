# Gramstat UI

Dependency-free browser UI for the read-only Go `gramstat-api`. nginx serves UI
and `/api/` from one origin on private port **2007**. The intended public hostname
is `https://stats.ton.org` behind HAProxy; the external route is configured separately.

API and deployment documentation:
[`docs/api.md`](../docs/api.md).

## Data

- Default range: the verified **21–27 October 2026** replay. Date controls use UTC;
  the visible end date is inclusive and API `to` is exclusive. Maximum: 93 days.
- Chain charts: prepared `gramstat.chain_daily` (supply, transactions, fees,
  issuance, burning). Edge days are partial. This fixed week is not live history.
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
Visible pages refresh every five minutes. A bare Python static server is no longer
sufficient; run the API and proxy `/api/` as shown in its nginx example.

Historical September research artifacts are archived in
[jetton-bomb](https://github.com/1IxI1/jetton-bomb/tree/main/docs/gramstat-september).
`ui.test.mjs` checks the live API adapter.

```
node --test ui/*.test.mjs
```

Deployment copies only `index.html`, `app.mjs`, `catalogue.mjs`, `charts.mjs`,
`data.mjs`, `style.css`, `favicon.svg`. Never serve the repository directory as-is.
