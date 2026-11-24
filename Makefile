.PHONY: dev dev-daemon dev-web build test migrate-state

CANVASD_PORT ?= 4242

dev: web/node_modules migrate-state ## Start daemon + web dev server (prints daemon token once)
	@trap 'kill 0' EXIT; \
	(cd crates && CANVAS_REPO="$(CURDIR)" cargo run -p canvasd 2>&1 &); \
	sleep 2; \
	(cd web && npm run dev)

dev-daemon: migrate-state
	cd crates && CANVAS_REPO="$(CURDIR)" cargo run -p canvasd

# Older recipes ran canvasd from crates/, so the board DB and worktrees
# landed there — adopt them at the repo root once instead of starting empty.
migrate-state:
	@[ ! -d crates/.canvas ] || [ -d .canvas ] || mv crates/.canvas .canvas
	@if [ -d crates/.canvas-worktrees ] && [ ! -d .canvas-worktrees ]; then \
		mkdir -p .canvas-worktrees; \
		for d in crates/.canvas-worktrees/*/; do \
			git worktree move "$${d%/}" ".canvas-worktrees/$$(basename "$$d")"; \
		done; \
		rmdir crates/.canvas-worktrees; \
	fi

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
