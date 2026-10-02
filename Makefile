# Argentina salary percentile — INDEC microdata pipeline + static web app.
# Run `make` (or `make help`) to see what's available.

PY  := uv run python
WEB := web
CF_PROJECT := argentina-income-analyzer

.DEFAULT_GOAL := help
.PHONY: help setup data up build deploy clean test lint

help:  ## List the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-9s\033[0m %s\n", $$1, $$2}'

setup:  ## Install Python (uv) and web (npm) dependencies
	uv sync
	cd $(WEB) && npm install --ignore-scripts

data:  ## Rebuild the data artifact: fetch → verify → build → validate
	$(PY) -m pipeline.fetch
	$(PY) -m pipeline.verify
	$(PY) -m pipeline.build
	$(PY) -m pipeline.validate

test:  ## Run the test suites (Python + web, each gated at 100% coverage)
	uv run pytest --cov=pipeline --cov-branch
	cd $(WEB) && npm run test:cov

lint:  ## Lint + format-check + typecheck everything (ruff, mypy, tsc)
	uv run ruff check pipeline tests
	uv run ruff format --check pipeline tests
	uv run mypy
	cd $(WEB) && npm run typecheck

up:  ## Run the local dev server (http://localhost:5179)
	cd $(WEB) && npm run dev -- --port 5179

build:  ## Build the static site into web/dist
	cd $(WEB) && npm run build

deploy: build  ## Deploy web/dist to Cloudflare Pages (needs wrangler auth)
	cd $(WEB) && wrangler pages deploy dist --project-name=$(CF_PROJECT)

clean:  ## Remove build artifacts and downloaded raw data
	rm -rf $(WEB)/dist $(WEB)/.vite data/raw/*
