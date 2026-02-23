# Sazinka — Development & Deployment Makefile
#
# Usage:
#   make secrets ENV=dev          Decrypt secrets for environment
#   make secrets-edit ENV=staging Edit secrets in $EDITOR (re-encrypts on save)
#   make up ENV=dev               Decrypt + start Docker stack
#   make down                     Stop Docker stack
#   make secrets-clean            Remove all decrypted files
#
# Prerequisites: sops, age (install via: apt install age; see README for sops)

ENV ?= dev
SECRETS_DIR := infra/secrets
ENC_FILE := $(SECRETS_DIR)/.env.$(ENV).enc
DEC_FILE := $(SECRETS_DIR)/.env.$(ENV).dec
COMPOSE_BASE := -f infra/docker-compose.yml

.PHONY: secrets secrets-edit secrets-clean secrets-rotate up down logs status help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

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

secrets-clean: ## Remove all decrypted secret files
	@rm -f $(SECRETS_DIR)/*.dec $(SECRETS_DIR)/*.plain
	@echo "Cleaned decrypted files"

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
	docker compose $(COMPOSE_BASE) down

logs: ## Tail Docker logs
	docker compose $(COMPOSE_BASE) logs -f --tail=50

status: ## Show Docker stack status
	docker compose $(COMPOSE_BASE) ps
