# Sazinka - Stop Full Stack
# Zastavi vsechny sluzby aplikace

param(
    [switch]$KeepDocker
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sazinka - Zastavuji aplikaci" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop Worker
Write-Host "[1/3] Zastavuji Worker..." -ForegroundColor Yellow
$workerProcesses = Get-Process -Name "sazinka-worker" -ErrorAction SilentlyContinue
if ($workerProcesses) {
    $workerProcesses | Stop-Process -Force
    Write-Host "      Worker zastaven [OK]" -ForegroundColor Green
} else {
    Write-Host "      Worker nebyl spusten" -ForegroundColor Gray
}

# 2. Stop Frontend (node processes running vite)
Write-Host "[2/3] Zastavuji Frontend..." -ForegroundColor Yellow
$frontendPort = 5173
$connections = Get-NetTCPConnection -LocalPort $frontendPort -ErrorAction SilentlyContinue
if ($connections) {
    foreach ($conn in $connections) {
        $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq "node") {
            Stop-Process -Id $process.Id -Force
        }
    }
    Write-Host "      Frontend zastaven [OK]" -ForegroundColor Green
} else {
    Write-Host "      Frontend nebyl spusten" -ForegroundColor Gray
}

# 3. Stop Docker services
if (-not $KeepDocker) {
    Write-Host "[3/3] Zastavuji Docker services..." -ForegroundColor Yellow
    
    Push-Location "$scriptDir\infra"
    try {
        docker-compose down 2>$null
        Write-Host "      Docker services zastaveny [OK]" -ForegroundColor Green
    } catch {
        Write-Host "      Docker compose neni dostupny" -ForegroundColor Gray
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[3/3] Ponechavam Docker (pouzit -KeepDocker)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aplikace zastavena" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
