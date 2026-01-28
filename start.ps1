# Sazinka - Start Full Stack
# Spusti cely stack aplikace: Docker services + Worker + Frontend

param(
    [switch]$NoBuild,
    [switch]$NoDocker,
    [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Setup Visual Studio environment if not already set
if (-not $env:VSINSTALLDIR) {
    # Try to find vswhere.exe
    $vsWherePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe"
    )
    
    $vsWhere = $vsWherePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    
    if ($vsWhere) {
        $vsPath = & $vsWhere -latest -property installationPath 2>$null
        Write-Host "      Nalezeno VS: $vsPath" -ForegroundColor Gray
        
        if ($vsPath) {
            $vcvars = "$vsPath\VC\Auxiliary\Build\vcvars64.bat"
            if (Test-Path $vcvars) {
                Write-Host "      Nastavuji VS prostredi..." -ForegroundColor Gray
                cmd /c "`"$vcvars`" > nul 2>&1 && set" | ForEach-Object {
                    if ($_ -match "^([^=]+)=(.*)$") {
                        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
                    }
                }
            } else {
                Write-Host "      VAROVANI: vcvars64.bat nenalezen v $vcvars" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "      VAROVANI: vswhere.exe nenalezen" -ForegroundColor Yellow
        Write-Host "      Spustte skript z 'Developer Command Prompt for VS'" -ForegroundColor Yellow
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sazinka - Spoustim aplikaci" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Start Docker services
if (-not $NoDocker) {
    Write-Host "[1/4] Spoustim Docker services..." -ForegroundColor Yellow
    
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
    
    Write-Host "      Cekam na PostgreSQL..." -ForegroundColor Gray
    $maxRetries = 30
    $retries = 0
    do {
        Start-Sleep -Seconds 1
        $retries++
        $result = docker exec sazinka-postgres pg_isready -U sazinka 2>$null
    } while ($LASTEXITCODE -ne 0 -and $retries -lt $maxRetries)
    
    if ($retries -ge $maxRetries) {
        Write-Host "CHYBA: PostgreSQL neni pripraven!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "      Docker services bezi [OK]" -ForegroundColor Green
} else {
    Write-Host "[1/4] Preskakuji Docker (pouzit -NoDocker)" -ForegroundColor Gray
}

# 2. Build Worker (if needed)
if (-not $NoBuild) {
    Write-Host "[2/4] Kompiluji Worker..." -ForegroundColor Yellow
    
    Push-Location "$scriptDir\worker"
    try {
        # Run cargo and capture exit code (stderr goes to stdout to avoid PS errors)
        $ErrorActionPreference = "Continue"
        cmd /c "cargo build --release 2>&1"
        $buildResult = $LASTEXITCODE
        $ErrorActionPreference = "Stop"
        
        if ($buildResult -ne 0) {
            Write-Host "CHYBA: Kompilace workeru selhala!" -ForegroundColor Red
            Write-Host "      Spustte 'cargo build --release' manualne pro detaily." -ForegroundColor Gray
            exit 1
        }
        Write-Host "      Worker zkompilovan [OK]" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[2/4] Preskakuji build (pouzit -NoBuild)" -ForegroundColor Gray
}

# 3. Start Worker in new terminal
Write-Host "[3/4] Spoustim Worker..." -ForegroundColor Yellow

$workerPath = "$scriptDir\worker\target\release\sazinka-worker.exe"
if (-not (Test-Path $workerPath)) {
    $workerPath = "$scriptDir\worker\target\debug\sazinka-worker.exe"
}

if (-not (Test-Path $workerPath)) {
    Write-Host "CHYBA: Worker executable nenalezen!" -ForegroundColor Red
    Write-Host "      Spustte 'cargo build --release' v adresari worker/" -ForegroundColor Gray
    exit 1
}

# Start worker in new terminal window
$workerCmd = "Set-Location '$scriptDir\worker'; `$env:RUST_LOG='info,sazinka_worker=debug'; .\target\release\sazinka-worker.exe"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $workerCmd -WindowStyle Normal

Write-Host "      Worker spusten v novem okne [OK]" -ForegroundColor Green

# Wait for worker to connect
Start-Sleep -Seconds 2

# 4. Start Frontend
if (-not $NoFrontend) {
    Write-Host "[4/4] Spoustim Frontend..." -ForegroundColor Yellow
    
    # Start frontend in new terminal
    $frontendCmd = "Set-Location '$scriptDir\apps\web'; pnpm dev"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal
    
    Write-Host "      Frontend spusten v novem okne [OK]" -ForegroundColor Green
} else {
    Write-Host "[4/4] Preskakuji Frontend (pouzit -NoFrontend)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aplikace bezi!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend:  http://localhost:5173" -ForegroundColor White
Write-Host "  NATS:      localhost:4222" -ForegroundColor White
Write-Host "  Postgres:  localhost:5432" -ForegroundColor White
Write-Host ""
Write-Host "  Pro zastaveni: .\stop.ps1" -ForegroundColor Gray
Write-Host ""
