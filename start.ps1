# Sazinka - Start Full Stack
# Spusti cely stack aplikace: Docker services + Worker + Frontend

param(
    [switch]$NoBuild,
    [switch]$NoDocker,
    [switch]$NoFrontend
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Setup Visual Studio environment - FORCE Community over Insiders
$vsCommunity = "C:\Program Files\Microsoft Visual Studio\18\Community"
$vsInsiders = "C:\Program Files\Microsoft Visual Studio\18\Insiders"

if (Test-Path "$vsCommunity\VC\Auxiliary\Build\vcvars64.bat") {
    $vsPath = $vsCommunity
} elseif (Test-Path "$vsInsiders\VC\Auxiliary\Build\vcvars64.bat") {
    $vsPath = $vsInsiders
} else {
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

        cmd /c "`"$vcvars`" > nul 2>&1 && set" | ForEach-Object {
            if ($_ -match "^([^=]+)=(.*)$") {
                [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
            }
        }

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

# ---------------------------------------------------------------------------
# 1. Start Docker services
# ---------------------------------------------------------------------------
if (-not $NoDocker) {
    Write-Host "[1/4] Spoustim Docker services..." -ForegroundColor Yellow

    Push-Location "$scriptDir\infra"
    try {
        # 2>&1 merges stderr into stdout so Docker Compose warnings
        # (which go to stderr) don't get swallowed or cause issues.
        docker-compose up -d nats postgres nominatim valhalla 2>&1 | Write-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host "CHYBA: Docker compose selhal!" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "CHYBA: Docker compose selhal: $_" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }

    # Wait for PostgreSQL
    Write-Host "      Cekam na PostgreSQL..." -ForegroundColor Gray -NoNewline
    $maxRetries = 30
    $retries = 0
    do {
        Start-Sleep -Seconds 1
        $retries++
        Write-Host "." -ForegroundColor Gray -NoNewline
        docker exec sazinka-postgres pg_isready -U sazinka >$null 2>&1
    } while ($LASTEXITCODE -ne 0 -and $retries -lt $maxRetries)
    Write-Host ""

    if ($retries -ge $maxRetries) {
        Write-Host "CHYBA: PostgreSQL neni pripraven!" -ForegroundColor Red
        exit 1
    }
    Write-Host "      PostgreSQL pripraven [OK]" -ForegroundColor Green

    # Wait for NATS
    Write-Host "      Cekam na NATS..." -ForegroundColor Gray -NoNewline
    $maxRetries = 30
    $retries = 0
    do {
        Start-Sleep -Seconds 1
        $retries++
        Write-Host "." -ForegroundColor Gray -NoNewline
        docker exec sazinka-nats wget -q --spider http://localhost:8223/healthz >$null 2>&1
    } while ($LASTEXITCODE -ne 0 -and $retries -lt $maxRetries)
    Write-Host ""

    if ($retries -ge $maxRetries) {
        Write-Host "CHYBA: NATS neni pripraven!" -ForegroundColor Red
        exit 1
    }
    Write-Host "      NATS pripraven [OK]" -ForegroundColor Green

    Write-Host "      Docker services bezi [OK]" -ForegroundColor Green
    Write-Host "      (Nominatim a Valhalla mohou potrebovat chvili na zahrati)" -ForegroundColor Gray
} else {
    Write-Host "[1/4] Preskakuji Docker (pouzit -NoDocker)" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# 2. Build Worker (if needed)
# ---------------------------------------------------------------------------
if (-not $NoBuild) {
    Write-Host "[2/4] Kompiluji Worker..." -ForegroundColor Yellow

    $vcvars = "$vsPath\VC\Auxiliary\Build\vcvars64.bat"
    if (-not (Test-Path $vcvars)) {
        Write-Host "CHYBA: vcvars64.bat nenalezen!" -ForegroundColor Red
        Write-Host "      Nainstalujte 'Desktop development with C++' ve VS Installer" -ForegroundColor Gray
        exit 1
    }

    Write-Host "      Pouzivam: $vcvars" -ForegroundColor Gray

    $cargoCmd = @"
@echo off
call "$vcvars" > nul 2>&1
cd /d "$scriptDir\worker"
cargo build
"@

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

# ---------------------------------------------------------------------------
# 3. Start Worker in new terminal
# ---------------------------------------------------------------------------
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

# Load worker/.env and build environment string for the new terminal
$envFile = "$scriptDir\worker\.env"
$envSetup = ""
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Count -eq 2) {
                $envSetup += "`$env:$($parts[0].Trim()) = '$($parts[1].Trim())'; "
            }
        }
    }
}

$workerCmd = "$envSetup Set-Location '$scriptDir\worker'; & '$workerPath'"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $workerCmd -WindowStyle Normal

Write-Host "      Worker spusten v novem okne [OK]" -ForegroundColor Green

Start-Sleep -Seconds 2

# ---------------------------------------------------------------------------
# 4. Start Frontend
# ---------------------------------------------------------------------------
if (-not $NoFrontend) {
    Write-Host "[4/4] Spoustim Frontend..." -ForegroundColor Yellow

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
