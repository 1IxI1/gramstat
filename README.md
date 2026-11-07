# Gramstat

Standalone read-only API and browser UI for **stats.ton.org**.
Gramstat consumes prepared statistics from ClickHouse. This is an independent
application, not part of the TON Center API product or the indexer binary.

## Layout

- `cmd/gramstat-api/` — Go HTTP service (standard library only).
- `internal/api/` — fixed read queries, bounded caching and HTTP contract.
- `ui/` — dependency-free browser interface.
- `deploy/` — systemd and nginx configuration.
- [`docs/api.md`](docs/api.md) — endpoints, database contract and deployment.

## Build and test

Requires Go 1.26.3+ and Node.js 22+ for UI tests. There is no npm install step.

```sh
make build
make test
make vet
# Linux deployment build from another platform:
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o build/gramstat-api ./cmd/gramstat-api
```

SQL integration tests run against isolated `clickhouse local` storage when the
ClickHouse binary is available. Test fixtures are consumer contracts only; the
application does not contain production schema creation or aggregation commands.

## Run

Configure `GRAMSTAT_CH_URL`, `GRAMSTAT_CH_USER`, `GRAMSTAT_CH_PASSWORD` in a
protected server environment. Use a dedicated SELECT-only database user.

```sh
./build/gramstat-api --listen 127.0.0.1:2008
```

nginx serves the allowlisted `ui/` assets and proxies `/api/` on private port
**2007**. The planned public endpoint is **https://stats.ton.org** through HAProxy.
See [`deploy/nginx.conf`](deploy/nginx.conf) and
[`deploy/gramstat-api.service`](deploy/gramstat-api.service).

## Data ownership

The [Gramstat aggregator](https://github.com/1IxI1/ton-indexer/blob/gramstat/docs/gramstat-aggregate.md)
and on-chain collectors own ingestion, ClickHouse DDL, backfills and prepared
metrics. They remain in `1IxI1/ton-indexer`. This repository has no code dependency
on that project; the integration boundary is the documented ClickHouse tables.

The UI displays actual coverage/freshness, exact monetary tooltips and unknown
values. Historical September exports and demo data remain archived in
[jetton-bomb](https://github.com/1IxI1/jetton-bomb/tree/main/docs/gramstat-september),
outside the live application.
