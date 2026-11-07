.PHONY: build test vet

build:
	go build -trimpath -o build/gramstat-api ./cmd/gramstat-api

test:
	go test -race ./...
	node --test ui/*.test.mjs

vet:
	go vet ./...
