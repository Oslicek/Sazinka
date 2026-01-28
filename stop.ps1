# Sazinka - Stop Full Stack
# Zastaví všechny služby aplikace

param(
    [switch]$KeepDocker    # Ponechat Docker services běžící
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
    Write-Host "      Worker zastaven ✓" -ForegroundColor Green
} else {
    Write-Host "      Worker nebyl spuštěn" -ForegroundColor Gray
}

# 2. Stop Frontend (node processes running vite)
Write-Host "[2/3] Zastavuji Frontend..." -ForegroundColor Yellow
# Find vite dev server by port
$frontendPort = 5173
$connections = Get-NetTCPConnection -LocalPort $frontendPort -ErrorAction SilentlyContinue
if ($connections) {
    foreach ($conn in $connections) {
        $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq "node") {
            Stop-Process -Id $process.Id -Force
        }
    }
    Write-Host "      Frontend zastaven ✓" -ForegroundColor Green
} else {
    Write-Host "      Frontend nebyl spuštěn" -ForegroundColor Gray
}

# 3. Stop Docker services
if (-not $KeepDocker) {
    Write-Host "[3/3] Zastavuji Docker services..." -ForegroundColor Yellow
    
    Push-Location "$scriptDir\infra"
    try {
        docker-compose down 2>$null
        Write-Host "      Docker services zastaveny ✓" -ForegroundColor Green
    } catch {
        Write-Host "      Docker compose není dostupný" -ForegroundColor Gray
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[3/3] Ponechávám Docker (--KeepDocker)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aplikace zastavena" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
