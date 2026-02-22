#!/bin/bash
set -e

echo "=== Sazinka: System-level dependencies ==="
echo "This script installs Docker, build-essential, and other packages that require sudo."
echo ""

sudo apt-get update

echo ""
echo "--- Installing build tools (gcc, pkg-config, libssl-dev) ---"
sudo apt-get install -y build-essential pkg-config libssl-dev

echo ""
echo "--- Installing Docker ---"
sudo apt-get install -y docker.io docker-compose-v2

echo ""
echo "--- Adding user 'dev' to docker group (no sudo needed for docker commands) ---"
sudo usermod -aG docker dev

echo ""
echo "--- Starting Docker service ---"
sudo systemctl enable docker
sudo systemctl start docker

echo ""
echo "============================================"
echo "  System dependencies installed!"
echo ""
echo "  IMPORTANT: Log out and back in (or run"
echo "  'newgrp docker') for Docker group to take"
echo "  effect without sudo."
echo "============================================"
