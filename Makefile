# Sazinka — Development & Deployment Makefile
#
# Usage:
#   make dev                       Full local dev start (decrypt + envs + Docker + worker + frontend)
#   make secrets ENV=dev           Decrypt secrets for environment
#   make secrets-edit ENV=staging  Edit secrets in $EDITOR (re-encrypts on save)
#   make up ENV=dev                Decrypt + start Docker stack
#   make down                      Stop Docker stack
#   make secrets-clean             Remove all decrypted files + generated .env
#   make cf-secrets-push           Push Cloudflare secrets from SOPS to Wrangler
#   make cf-secrets-edit           Edit Cloudflare secrets in $EDITOR
#   make cf-secrets-list           List currently set Wrangler secrets
#
# Prerequisites: sops, age (install via: apt install age; see PRJ_DEVOPS.MD for sops)

ENV ?= dev
SECRETS_DIR := infra/secrets
ENC_FILE := $(SECRETS_DIR)/.env.$(ENV).enc
DEC_FILE := $(SECRETS_DIR)/.env.$(ENV).dec
COMPOSE_BASE := -f infra/docker-compose.yml

CF_ENC_FILE := $(SECRETS_DIR)/.env.cloudflare.enc
CF_DEC_FILE := $(SECRETS_DIR)/.env.cloudflare.dec
CF_PROJECT := apps/site

.PHONY: secrets secrets-edit secrets-clean secrets-rotate \
        worker-env web-env up down logs status dev \
        cf-secrets-push cf-secrets-edit cf-secrets-list help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Secrets management
# ---------------------------------------------------------------------------

secrets: ## Decrypt secrets for ENV (dev|staging|production)
	@if [ ! -f "$(ENC_FILE)" ]; then \
		echo "Error: $(ENC_FILE) not found"; exit 1; \
	fi
	@sops decrypt --input-type dotenv --output-type dotenv "$(ENC_FILE)" > "$(DEC_FILE)"
	@echo "Decrypted → $(DEC_FILE)"

secrets-edit: ## Edit secrets for ENV in $$EDITOR (re-encrypts on save)
	@if [ ! -f "$(ENC_FILE)" ]; then \
		echo "Error: $(ENC_FILE) not found"; exit 1; \
	fi
	sops edit --input-type dotenv --output-type dotenv "$(ENC_FILE)"

secrets-rotate: ## Re-encrypt after .sops.yaml key changes
	@if [ ! -f "$(ENC_FILE)" ]; then \
		echo "Error: $(ENC_FILE) not found"; exit 1; \
	fi
	sops updatekeys "$(ENC_FILE)"

secrets-clean: ## Remove all decrypted + generated secret files
	@rm -f $(SECRETS_DIR)/*.dec $(SECRETS_DIR)/*.plain
	@rm -f worker/.env apps/web/.env
	@echo "Cleaned all decrypted and generated files"

# ---------------------------------------------------------------------------
# Generate component .env files from the decrypted SOPS source
# ---------------------------------------------------------------------------

worker-env: secrets ## Generate worker/.env from SOPS
	@echo "# Auto-generated from SOPS ($(ENV)) — do not edit" > worker/.env
	@grep -E '^(DATABASE_URL|JWT_SECRET|NATS_URL|NOMINATIM_URL|VALHALLA_URL|GEOCODER_BACKEND|RUST_LOG|LOGS_DIR|ADMIN_EMAIL|ADMIN_PASSWORD_HASH)=' \
		"$(DEC_FILE)" >> worker/.env 2>/dev/null || true
	@echo "NATS_USER=worker" >> worker/.env
	@WORKER_PASS=$$(grep '^NATS_WORKER_PASSWORD=' "$(DEC_FILE)" | cut -d= -f2-); \
		echo "NATS_PASSWORD=$$WORKER_PASS" >> worker/.env
	@echo "Generated → worker/.env"

web-env: secrets ## Generate apps/web/.env from SOPS
	@echo "# Auto-generated from SOPS ($(ENV)) — do not edit" > apps/web/.env
	@grep -E '^VITE_' "$(DEC_FILE)" >> apps/web/.env 2>/dev/null || true
	@echo "Generated → apps/web/.env"

# ---------------------------------------------------------------------------
# Docker stack
# ---------------------------------------------------------------------------

up: secrets ## Decrypt secrets + start Docker stack for ENV
	@if [ "$(ENV)" = "staging" ] && [ -f infra/docker-compose.staging.yml ]; then \
		docker compose --env-file "$(DEC_FILE)" $(COMPOSE_BASE) -f infra/docker-compose.staging.yml up -d; \
	elif [ "$(ENV)" = "production" ] && [ -f infra/docker-compose.production.yml ]; then \
		docker compose --env-file "$(DEC_FILE)" $(COMPOSE_BASE) -f infra/docker-compose.production.yml up -d; \
	else \
		docker compose --env-file "$(DEC_FILE)" $(COMPOSE_BASE) up -d; \
	fi
	@echo "Stack running (ENV=$(ENV))"

down: ## Stop Docker stack
	@if [ -f "$(DEC_FILE)" ]; then \
		docker compose --env-file "$(DEC_FILE)" $(COMPOSE_BASE) down; \
	else \
		docker compose $(COMPOSE_BASE) down 2>/dev/null || \
		docker stop sazinka-postgres sazinka-nats sazinka-nominatim sazinka-valhalla 2>/dev/null; \
	fi

logs: ## Tail Docker logs
	docker compose $(COMPOSE_BASE) logs -f --tail=50 2>/dev/null || \
		docker logs -f --tail=50 sazinka-postgres sazinka-nats

status: ## Show Docker stack status
	@docker ps --filter "name=sazinka-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# ---------------------------------------------------------------------------
# Full dev workflow
# ---------------------------------------------------------------------------

dev: worker-env web-env up ## Decrypt + generate envs + start Docker (then run worker/frontend manually)
	@echo ""
	@echo "Infrastructure ready. Start the app:"
	@echo "  cd worker && cargo run"
	@echo "  cd apps/web && pnpm dev"

# ---------------------------------------------------------------------------
# Cloudflare Workers secrets (apps/site)
# ---------------------------------------------------------------------------

cf-secrets-push: ## Push Cloudflare secrets from SOPS → Wrangler
	@if [ ! -f "$(CF_ENC_FILE)" ]; then \
		echo "Error: $(CF_ENC_FILE) not found"; exit 1; \
	fi
	@sops decrypt --input-type dotenv --output-type dotenv "$(CF_ENC_FILE)" > "$(CF_DEC_FILE)"
	@echo "Pushing secrets to Cloudflare Workers..."
	@grep -v '^\s*#' "$(CF_DEC_FILE)" | grep -v '^\s*$$' | while IFS='=' read -r key value; do \
		printf '%s' "$$value" | npx --yes wrangler secret put "$$key" --config "$(CF_PROJECT)/wrangler.toml" 2>&1 && \
		echo "  ✓ $$key"; \
	done
	@rm -f "$(CF_DEC_FILE)"
	@echo "Done. Decrypted file removed."

cf-secrets-edit: ## Edit Cloudflare secrets in $$EDITOR (re-encrypts on save)
	@if [ ! -f "$(CF_ENC_FILE)" ]; then \
		echo "Error: $(CF_ENC_FILE) not found"; exit 1; \
	fi
	sops edit --input-type dotenv --output-type dotenv "$(CF_ENC_FILE)"

cf-secrets-list: ## List Wrangler secrets currently set
	npx --yes wrangler secret list --config "$(CF_PROJECT)/wrangler.toml"
