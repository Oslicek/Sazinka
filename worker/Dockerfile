# Build context: monorepo root (.)
# Command: docker build -t sazinka-worker:TAG -f worker/Dockerfile .
#
# The worker embeds packages/countries/countries.json via include_str! at
# compile time, so the build context must include both worker/ and packages/.

# Pin Rust toolchain — update deliberately, not via floating tags
ARG RUST_VERSION=1.93
ARG DEBIAN_VERSION=bookworm

# ============================================================
# Stage 1: Planner — dependency analysis for cargo-chef
# ============================================================
FROM rust:${RUST_VERSION}-slim-${DEBIAN_VERSION} AS planner
WORKDIR /app
RUN cargo install cargo-chef
COPY worker/ worker/
COPY packages/ packages/
WORKDIR /app/worker
RUN SQLX_OFFLINE=true cargo chef prepare --recipe-path recipe.json

# ============================================================
# Stage 2: Builder — compile with Docker layer caching
# ============================================================
FROM rust:${RUST_VERSION}-slim-${DEBIAN_VERSION} AS builder
WORKDIR /app/worker

RUN cargo install cargo-chef

RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Compile dependencies first (cached until Cargo.toml/Cargo.lock changes)
COPY --from=planner /app/worker/recipe.json recipe.json
RUN SQLX_OFFLINE=true cargo chef cook --release --recipe-path recipe.json

# Compile application source (runs on every source change)
# SQLX_OFFLINE=true: pre-generated .sqlx cache — no DB needed at build time
COPY worker/ .
COPY packages/ /app/packages/
RUN touch src/main.rs && SQLX_OFFLINE=true cargo build --release

# ============================================================
# Stage 3: Runtime — minimal image with binary only
# ============================================================
FROM debian:${DEBIAN_VERSION}-slim AS runtime

# OCI labels (https://github.com/opencontainers/image-spec/blob/main/annotations.md)
LABEL org.opencontainers.image.title="sazinka-worker" \
      org.opencontainers.image.description="Sazinka CRM backend worker" \
      org.opencontainers.image.source="https://github.com/Oslicek/Sazinka" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="Sazinka"

WORKDIR /opt/sazinka

# ca-certificates: required for outbound HTTPS (rustls needs root CA bundle)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r sazinka && \
    useradd -r -g sazinka -d /opt/sazinka sazinka && \
    mkdir -p /opt/sazinka/logs && \
    chown -R sazinka:sazinka /opt/sazinka

# Binary owned by root, executed by non-root user
COPY --from=builder --chown=root:root /app/worker/target/release/sazinka-worker /usr/local/bin/sazinka-worker

USER sazinka

# Lightweight healthcheck: reads /proc/1 instead of requiring procps package
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD test -f /proc/1/status || exit 1

CMD ["sazinka-worker"]
