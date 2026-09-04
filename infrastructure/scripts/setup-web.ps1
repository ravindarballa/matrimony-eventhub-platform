<#
.SYNOPSIS
  Scaffolds apps/web as an Angular 22 application and wires it to the API.

.DESCRIPTION
  Run this AFTER switching to Node 24. Angular 22 requires Node
  ^22.22.3 || ^24.15.0 || >=26.0.0, and the CLI refuses to run otherwise.

    # in an Administrator PowerShell (nvm-windows needs elevation):
    nvm use 24.20.0

    # then, in a normal shell, from the repo root:
    ./infrastructure/scripts/setup-web.ps1

  It uses the official Angular CLI rather than hand-written config, so the
  workspace is exactly what `ng new` produces for this version.
#>

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

# --- preflight ------------------------------------------------------------
$nodeVersion = (node --version) -replace '^v', ''
$major = [int]($nodeVersion -split '\.')[0]
$minor = [int]($nodeVersion -split '\.')[1]
$patch = [int]($nodeVersion -split '\.')[2]

$ok = ($major -eq 22 -and ($minor -gt 22 -or ($minor -eq 22 -and $patch -ge 3))) -or
      ($major -eq 24 -and ($minor -gt 15 -or ($minor -eq 15 -and $patch -ge 0))) -or
      ($major -ge 26)

if (-not $ok) {
  Write-Host ""
  Write-Host "  Node $nodeVersion is too old for Angular 22." -ForegroundColor Red
  Write-Host "  Angular 22 requires ^22.22.3 || ^24.15.0 || >=26.0.0"
  Write-Host ""
  Write-Host "  Node 24.20.0 is already downloaded. In an Administrator PowerShell run:"
  Write-Host "      nvm use 24.20.0" -ForegroundColor Yellow
  Write-Host "  then reopen this terminal and run this script again."
  Write-Host ""
  exit 1
}

Write-Host "Node $nodeVersion - OK for Angular 22" -ForegroundColor Green

if (Test-Path "apps/web/angular.json") {
  Write-Host "apps/web already exists. Delete it first to re-scaffold." -ForegroundColor Yellow
  exit 0
}

# --- build the shared contracts package first -----------------------------
Write-Host "`nBuilding @eventhub/contracts..." -ForegroundColor Cyan
Push-Location packages/contracts
npm install --no-audit --no-fund
npm run build
Pop-Location

# --- scaffold the Angular workspace ---------------------------------------
# Standalone components and lazy routes are the Angular 22 default; these flags
# pin the rest to the platform's stated constraints.
Write-Host "`nScaffolding Angular 22 in apps/web..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path apps | Out-Null
Push-Location apps

npx --yes @angular/cli@22 new web `
  --directory=web `
  --style=scss `
  --routing=true `
  --ssr=false `
  --zoneless=true `
  --skip-git=true `
  --skip-tests=false `
  --package-manager=npm

Pop-Location

# --- add the platform dependencies ----------------------------------------
Write-Host "`nAdding Angular Material and the shared contracts..." -ForegroundColor Cyan
Push-Location apps/web

npx --yes ng add @angular/material --skip-confirmation --theme=custom --typography --animations=enabled
npm install "file:../../packages/contracts" --save
npm install @ngrx/signals --save

Pop-Location

# --- feature folder skeleton ----------------------------------------------
Write-Host "`nCreating the feature-based folder structure..." -ForegroundColor Cyan
$dirs = @(
  'core/guards','core/interceptors','core/services','core/models','core/tokens',
  'shared/ui','shared/form-kit','shared/pipes','shared/directives','shared/utils',
  'layout',
  'features/auth/pages','features/auth/components','features/auth/data','features/auth/models',
  'features/matrimony/pages','features/matrimony/components','features/matrimony/data','features/matrimony/models',
  'features/events/pages','features/events/components','features/events/data','features/events/models',
  'features/vendor/pages','features/vendor/components','features/vendor/data','features/vendor/models',
  'features/customer/pages','features/customer/components','features/customer/data',
  'features/admin/pages','features/admin/components','features/admin/data',
  'features/payments/pages','features/payments/components','features/payments/data',
  'features/notifications/pages','features/notifications/components','features/notifications/data',
  'features/reporting/pages','features/reporting/components','features/reporting/data'
)
foreach ($d in $dirs) {
  $full = Join-Path 'apps/web/src/app' $d
  New-Item -ItemType Directory -Force -Path $full | Out-Null
  New-Item -ItemType File -Force -Path (Join-Path $full '.gitkeep') | Out-Null
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host ""
Write-Host "  Next:"
Write-Host "    npm run infra:up     # Mongo replica set + Redis + LocalStack (needs Docker)"
Write-Host "    npm run dev          # API on :3000, web on :4200"
Write-Host ""
Write-Host "  The API is already working - see docs/architecture.html for the module specs."
Write-Host ""
