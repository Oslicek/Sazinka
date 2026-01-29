# =============================================================================
# Sazinka Infrastructure Management Script
# =============================================================================
#
# Safe commands that preserve data:
#   .\manage.ps1 start       - Start all services
#   .\manage.ps1 stop        - Stop all services (data preserved)
#   .\manage.ps1 restart     - Restart all services
#   .\manage.ps1 status      - Show service status
#   .\manage.ps1 logs        - Show logs (follow mode)
#
# DANGEROUS commands (require confirmation):
#   .\manage.ps1 reset-db    - Reset PostgreSQL database (NOT Nominatim)
#   .\manage.ps1 reset-all   - Reset ALL data including Nominatim (2+ hours to rebuild!)
#
# =============================================================================

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "reset-db", "reset-all")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"

function Write-SafeWarning {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Yellow
    Write-Host "  NOMINATIM DATA IS PROTECTED" -ForegroundColor Yellow
    Write-Host "=============================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Nominatim contains Czech Republic OSM data" -ForegroundColor White
    Write-Host "  that took ~2 HOURS to import." -ForegroundColor White
    Write-Host ""
    Write-Host "  This operation is SAFE - data will persist." -ForegroundColor Green
    Write-Host ""
}

function Write-DangerWarning {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host "  !!! DANGER - DATA DESTRUCTION !!!" -ForegroundColor Red
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host ""
}

switch ($Command) {
    "start" {
        Write-SafeWarning
        Write-Host "Starting all services..." -ForegroundColor Cyan
        docker-compose up -d
        Write-Host "Done. Use '.\manage.ps1 status' to check." -ForegroundColor Green
    }
    
    "stop" {
        Write-SafeWarning
        Write-Host "Stopping all services (data preserved)..." -ForegroundColor Cyan
        docker-compose stop
        Write-Host "Done. Data is safely preserved in Docker volumes." -ForegroundColor Green
    }
    
    "restart" {
        Write-SafeWarning
        Write-Host "Restarting all services..." -ForegroundColor Cyan
        docker-compose restart
        Write-Host "Done." -ForegroundColor Green
    }
    
    "status" {
        Write-Host ""
        Write-Host "Service Status:" -ForegroundColor Cyan
        Write-Host ""
        docker-compose ps
        Write-Host ""
        Write-Host "Volume Status:" -ForegroundColor Cyan
        docker volume ls --filter "name=sazinka"
    }
    
    "logs" {
        Write-Host "Following logs (Ctrl+C to stop)..." -ForegroundColor Cyan
        docker-compose logs -f
    }
    
    "reset-db" {
        Write-DangerWarning
        Write-Host "  This will DELETE the PostgreSQL database." -ForegroundColor Yellow
        Write-Host "  All customers, routes, and settings will be LOST." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Nominatim data will be PRESERVED." -ForegroundColor Green
        Write-Host ""
        
        $confirm = Read-Host "Type 'DELETE DATABASE' to confirm"
        if ($confirm -eq "DELETE DATABASE") {
            Write-Host "Resetting PostgreSQL..." -ForegroundColor Yellow
            docker-compose stop postgres
            docker volume rm sazinka_postgres_data
            docker-compose up -d postgres
            Write-Host "PostgreSQL reset complete." -ForegroundColor Green
        } else {
            Write-Host "Cancelled." -ForegroundColor Green
        }
    }
    
    "reset-all" {
        Write-DangerWarning
        Write-Host "  THIS WILL DELETE ALL DATA INCLUDING NOMINATIM!" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Nominatim import takes ~2 HOURS!" -ForegroundColor Red
        Write-Host "  Are you absolutely sure?" -ForegroundColor Red
        Write-Host ""
        Write-Host "  This action was explicitly requested by user: NO" -ForegroundColor Yellow
        Write-Host ""
        
        $confirm1 = Read-Host "Type 'I WANT TO DELETE NOMINATIM DATA' to continue"
        if ($confirm1 -ne "I WANT TO DELETE NOMINATIM DATA") {
            Write-Host "Cancelled." -ForegroundColor Green
            exit
        }
        
        $confirm2 = Read-Host "Type 'YES I AM SURE' to confirm final deletion"
        if ($confirm2 -ne "YES I AM SURE") {
            Write-Host "Cancelled." -ForegroundColor Green
            exit
        }
        
        Write-Host ""
        Write-Host "Deleting all data..." -ForegroundColor Red
        docker-compose down -v
        Write-Host ""
        Write-Host "All data deleted. Run '.\manage.ps1 start' to rebuild." -ForegroundColor Yellow
        Write-Host "WARNING: Nominatim will need ~2 hours to re-import!" -ForegroundColor Red
    }
}
