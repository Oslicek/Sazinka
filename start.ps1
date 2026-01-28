# Sazinka - Start Full Stack
# Spustí celý stack aplikace: Docker services + Worker + Frontend

param(
    [switch]$NoBuild,      # Přeskočit build workeru
    [switch]$NoDocker,     # Přeskočit Docker (pokud už běží)
    [switch]$NoFrontend    # Nespouštět frontend
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sazinka - Spouštím aplikaci" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Start Docker services
if (-not $NoDocker) {
    Write-Host "[1/4] Spouštím Docker services..." -ForegroundColor Yellow
    
    Push-Location "$scriptDir\infra"
    try {
        docker-compose up -d nats postgres
        if ($LASTEXITCODE -ne 0) {
            Write-Host "CHYBA: Docker compose selhal!" -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
    
    Write-Host "      Čekám na PostgreSQL..." -ForegroundColor Gray
    $maxRetries = 30
    $retries = 0
    do {
        Start-Sleep -Seconds 1
        $retries++
        $result = docker exec sazinka-postgres pg_isready -U sazinka 2>$null
    } while ($LASTEXITCODE -ne 0 -and $retries -lt $maxRetries)
    
    if ($retries -ge $maxRetries) {
        Write-Host "CHYBA: PostgreSQL není připraven!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "      Docker services běží ✓" -ForegroundColor Green
} else {
    Write-Host "[1/4] Přeskakuji Docker (--NoDocker)" -ForegroundColor Gray
}

# 2. Build Worker (if needed)
if (-not $NoBuild) {
    Write-Host "[2/4] Kompiluji Worker..." -ForegroundColor Yellow
    
    Push-Location "$scriptDir\worker"
    try {
        cargo build --release 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "CHYBA: Kompilace workeru selhala!" -ForegroundColor Red
            Write-Host "      Spusťte 'cargo build --release' manuálně pro detaily." -ForegroundColor Gray
            exit 1
        }
        Write-Host "      Worker zkompilován ✓" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[2/4] Přeskakuji build (--NoBuild)" -ForegroundColor Gray
}

# 3. Start Worker in new terminal
Write-Host "[3/4] Spouštím Worker..." -ForegroundColor Yellow

$workerPath = "$scriptDir\worker\target\release\sazinka-worker.exe"
if (-not (Test-Path $workerPath)) {
    $workerPath = "$scriptDir\worker\target\debug\sazinka-worker.exe"
}

if (-not (Test-Path $workerPath)) {
    Write-Host "CHYBA: Worker executable nenalezen!" -ForegroundColor Red
    Write-Host "      Spusťte 'cargo build --release' v adresáři worker/" -ForegroundColor Gray
    exit 1
}

# Start worker in new terminal window
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$scriptDir\worker'; `$env:RUST_LOG='info,sazinka_worker=debug'; .\target\release\sazinka-worker.exe"
) -WindowStyle Normal

Write-Host "      Worker spuštěn v novém okně ✓" -ForegroundColor Green

# Wait for worker to connect
Start-Sleep -Seconds 2

# 4. Start Frontend
if (-not $NoFrontend) {
    Write-Host "[4/4] Spouštím Frontend..." -ForegroundColor Yellow
    
    # Start frontend in new terminal
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$scriptDir\apps\web'; pnpm dev"
    ) -WindowStyle Normal
    
    Write-Host "      Frontend spuštěn v novém okně ✓" -ForegroundColor Green
} else {
    Write-Host "[4/4] Přeskakuji Frontend (--NoFrontend)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aplikace běží!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend:  http://localhost:5173" -ForegroundColor White
Write-Host "  NATS:      localhost:4222" -ForegroundColor White
Write-Host "  Postgres:  localhost:5432" -ForegroundColor White
Write-Host ""
Write-Host "  Pro zastavení: .\stop.ps1" -ForegroundColor Gray
Write-Host ""
