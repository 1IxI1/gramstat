.PHONY: build test vet security

build:
	go build -trimpath -o build/gramstat-api ./cmd/gramstat-api

test:
	go test -race ./...
	node --test ui/*.test.mjs

vet:
	go vet ./...

security:
	go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
	go run github.com/zricethezav/gitleaks/v8@v8.30.1 git --redact --no-banner --log-opts=--all .
