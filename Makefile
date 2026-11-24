.PHONY: dev dev-daemon dev-web build test

CANVASD_PORT ?= 4242

dev: web/node_modules ## Start daemon + web dev server (prints daemon token once)
	@trap 'kill 0' EXIT; \
	(cd crates && CANVAS_REPO=$(CURDIR) cargo run -p canvasd 2>&1 &); \
	sleep 2; \
	(cd web && npm run dev)

dev-daemon:
	cd crates && CANVAS_REPO=$(CURDIR) cargo run -p canvasd

dev-web: web/node_modules
	cd web && npm run dev

web/node_modules: web/package-lock.json
	cd web && npm ci

build: ## Typecheck + build web, build daemon release
	cd web && npm run build
	cargo build --release

test: ## All unit tests
	cargo test
	cd web && npm run test
