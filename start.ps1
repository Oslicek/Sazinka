# Sazinka - Start Full Stack
# Spusti cely stack aplikace: Docker services + Worker + Frontend

param(
    [switch]$NoBuild,
    [switch]$NoDocker,
    [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Setup Visual Studio environment - FORCE Community over Insiders
$vsCommunity = "C:\Program Files\Microsoft Visual Studio\18\Community"
$vsInsiders = "C:\Program Files\Microsoft Visual Studio\18\Insiders"

# Prefer Community
if (Test-Path "$vsCommunity\VC\Auxiliary\Build\vcvars64.bat") {
    $vsPath = $vsCommunity
} elseif (Test-Path "$vsInsiders\VC\Auxiliary\Build\vcvars64.bat") {
    $vsPath = $vsInsiders
} else {
    # Fallback to vswhere
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $vsPath = & $vsWhere -latest -property installationPath 2>$null
    }
}

if ($vsPath) {
    Write-Host "      Pouzivam VS: $vsPath" -ForegroundColor Gray
    $vcvars = "$vsPath\VC\Auxiliary\Build\vcvars64.bat"
    
    if (Test-Path $vcvars) {
        Write-Host "      Nastavuji VS prostredi..." -ForegroundColor Gray
        
        # Run vcvars and capture environment
        cmd /c "`"$vcvars`" > nul 2>&1 && set" | ForEach-Object {
            if ($_ -match "^([^=]+)=(.*)$") {
                [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
            }
        }
        
        # IMPORTANT: Force Rust to use this VS installation
        $env:VCINSTALLDIR = "$vsPath\VC\"
        $env:VSINSTALLDIR = "$vsPath\"
        
        Write-Host "      VS prostredi nastaveno [OK]" -ForegroundColor Green
    }
} else {
    Write-Host "      VAROVANI: Visual Studio nenalezeno" -ForegroundColor Yellow
    Write-Host "      Spustte z Developer Command Prompt" -ForegroundColor Yellow
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
        docker-compose up -d nats postgres nominatim valhalla
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
    Write-Host "      (Nominatim a Valhalla mohou potrebovat chvili na zahrati)" -ForegroundColor Gray
} else {
    Write-Host "[1/4] Preskakuji Docker (pouzit -NoDocker)" -ForegroundColor Gray
}

# 2. Build Worker (if needed)
if (-not $NoBuild) {
    Write-Host "[2/4] Kompiluji Worker..." -ForegroundColor Yellow
    
    # Find vcvars64.bat
    $vcvars = "$vsPath\VC\Auxiliary\Build\vcvars64.bat"
    if (-not (Test-Path $vcvars)) {
        Write-Host "CHYBA: vcvars64.bat nenalezen!" -ForegroundColor Red
        Write-Host "      Nainstalujte 'Desktop development with C++' ve VS Installer" -ForegroundColor Gray
        exit 1
    }
    
    # Run cargo inside vcvars environment using cmd
    Write-Host "      Pouzivam: $vcvars" -ForegroundColor Gray
    
    $cargoCmd = @"
call "$vcvars" > nul 2>&1
cd /d "$scriptDir\worker"
cargo build
"@
    
    # Write temp batch file and execute
    $tempBat = "$env:TEMP\sazinka_build.bat"
    $cargoCmd | Out-File -FilePath $tempBat -Encoding ascii
    
    cmd /c $tempBat
    $buildResult = $LASTEXITCODE
    
    Remove-Item $tempBat -ErrorAction SilentlyContinue
    
    if ($buildResult -ne 0) {
        Write-Host "CHYBA: Kompilace workeru selhala!" -ForegroundColor Red
        Write-Host "      Spustte z 'Developer Command Prompt for VS 2026'" -ForegroundColor Gray
        exit 1
    }
    Write-Host "      Worker zkompilovan [OK]" -ForegroundColor Green
} else {
    Write-Host "[2/4] Preskakuji build (pouzit -NoBuild)" -ForegroundColor Gray
}

# 3. Start Worker in new terminal
Write-Host "[3/4] Spoustim Worker..." -ForegroundColor Yellow

$workerPath = "$scriptDir\worker\target\debug\sazinka-worker.exe"
if (-not (Test-Path $workerPath)) {
    $workerPath = "$scriptDir\worker\target\release\sazinka-worker.exe"
}

if (-not (Test-Path $workerPath)) {
    Write-Host "CHYBA: Worker executable nenalezen!" -ForegroundColor Red
    Write-Host "      Spustte 'cargo build' v adresari worker/" -ForegroundColor Gray
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
Write-Host "  Frontend:   http://localhost:5173" -ForegroundColor White
Write-Host "  NATS:       localhost:4222" -ForegroundColor White
Write-Host "  Postgres:   localhost:5432" -ForegroundColor White
Write-Host "  Nominatim:  http://localhost:8080" -ForegroundColor White
Write-Host "  Valhalla:   http://localhost:8002" -ForegroundColor White
Write-Host ""
Write-Host "  Pro zastaveni: .\stop.ps1" -ForegroundColor Gray
Write-Host ""
