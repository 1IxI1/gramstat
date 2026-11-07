# Gramstat

Read-only API and browser UI for **stats.ton.org**, backed by prepared statistics
in ClickHouse.

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
ClickHouse binary is available, using a fixture schema for the expected tables.

## Run

Configure `GRAMSTAT_CH_URL`, `GRAMSTAT_CH_USER`, `GRAMSTAT_CH_PASSWORD` in a
protected server environment. Use a dedicated SELECT-only database user.

```sh
./build/gramstat-api --listen 127.0.0.1:2008
```

The nginx example serves the allowlisted `ui/` assets and proxies `/api/` on
private port **2007**. An HTTPS reverse proxy can forward traffic to this listener.
See [`deploy/nginx.conf`](deploy/nginx.conf) and
[`deploy/gramstat-api.service`](deploy/gramstat-api.service).

## Data

The API reads the tables described in the [database contract](docs/api.md#sources).
They must be populated before serving charts. The UI displays data coverage,
update times, exact monetary tooltips and unknown values.
