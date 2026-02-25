# Build context: monorepo root (.)
# Command: docker build -t sazinka-worker:TAG -f worker/Dockerfile .
#
# The worker embeds packages/countries/countries.json via include_str! at
# compile time, so the build context must include both worker/ and packages/.

# ============================================================
# Stage 1: Planner — dependency analysis
# ============================================================
FROM rust:1-slim-bookworm AS planner
WORKDIR /app
RUN cargo install cargo-chef
# Copy only what cargo-chef needs for dependency analysis
COPY worker/ worker/
COPY packages/ packages/
WORKDIR /app/worker
RUN SQLX_OFFLINE=true cargo chef prepare --recipe-path recipe.json

# ============================================================
# Stage 2: Builder — compile with Docker layer caching
# ============================================================
FROM rust:1-slim-bookworm AS builder
WORKDIR /app/worker

RUN cargo install cargo-chef

# System dependencies for compilation (rustls does not need libssl-dev)
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Step 2a: compile dependencies (cached until Cargo.toml/Cargo.lock changes)
COPY --from=planner /app/worker/recipe.json recipe.json
RUN SQLX_OFFLINE=true cargo chef cook --release --recipe-path recipe.json

# Step 2b: compile application source (runs on every source change)
# SQLX_OFFLINE=true uses pre-generated .sqlx query cache (no DB needed at build time)
COPY worker/ .
COPY packages/ /app/packages/
RUN touch src/main.rs && SQLX_OFFLINE=true cargo build --release

# ============================================================
# Stage 3: Runtime — minimal image with binary only
# ============================================================
FROM debian:bookworm-slim
WORKDIR /opt/sazinka

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates procps && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r sazinka && useradd -r -g sazinka -d /opt/sazinka sazinka
RUN mkdir -p /opt/sazinka/logs && chown -R sazinka:sazinka /opt/sazinka

COPY --from=builder /app/worker/target/release/sazinka-worker /usr/local/bin/sazinka-worker

USER sazinka

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -x sazinka-worker > /dev/null || exit 1

CMD ["sazinka-worker"]
