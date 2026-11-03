param(
  [ValidateSet("start", "stop", "status", "test", "live-test", "bridge-start", "bridge-stop")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$port = 3102
$dataDir = Join-Path $env:LOCALAPPDATA "Paperclip\noverhead-node-dev"
$bridgeName = "paperclip261-node-bridge"
$bridgeLabel = "com.noverhead.paperclip-dev=261"

function Get-DevHealth {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
  } catch {
    return $null
  }
}

Push-Location $repoRoot
try {
  switch ($Action) {
    "stop" {
      $listener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
      if ($listener.Count -eq 0) {
        Write-Output "No Paperclip source dev server is listening on port $port."
        exit 0
      }
      if ($listener.Count -ne 1) { throw "Unexpected listener count on port $port; refusing to stop processes." }
      $server = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener[0].OwningProcess)"
      if (-not $server -or $server.CommandLine -notmatch 'tsx.*src/index\.ts' -or $server.CommandLine -notmatch [regex]::Escape($repoRoot)) {
        throw "Port $port is not owned by this repository's Paperclip source server; refusing to stop it."
      }
      $watcher = Get-CimInstance Win32_Process -Filter "ProcessId = $($server.ParentProcessId)"
      if (-not $watcher -or $watcher.CommandLine -notmatch 'tsx.*watch' -or $watcher.CommandLine -notmatch 'src/index\.ts') {
        throw "Could not verify the Paperclip dev watcher for the server on port $port; refusing to stop it."
      }

      $pgCtl = Get-ChildItem -Path (Join-Path $repoRoot "node_modules\.pnpm\@embedded-postgres+windows-x64@*\node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe") -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
      $dataPath = Join-Path $dataDir "instances\default\db"
      $postgres = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "postgres.exe" -and $_.CommandLine -like "*${dataPath}*" } | Select-Object -First 1
      if ($postgres) {
        if (-not (Test-Path -LiteralPath $pgCtl)) { throw "Embedded PostgreSQL is running but its matching pg_ctl is unavailable; leaving the server untouched." }
        & $pgCtl -D $dataPath -m fast -w -t 15 stop
        if ($LASTEXITCODE -ne 0) { throw "Embedded PostgreSQL did not stop cleanly; leaving the Paperclip process tree untouched." }
      }
      & taskkill /PID $watcher.ProcessId /T /F | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Could not stop the verified Paperclip dev process tree ($($watcher.ProcessId))." }
      Start-Sleep -Seconds 2
      if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Paperclip still owns port $port after the controlled stop."
      }
      Write-Output "Stopped the verified Paperclip source server and its isolated database on port $port."
      exit 0
    }
    "bridge-start" {
      $existing = docker container inspect $bridgeName 2>$null
      if ($LASTEXITCODE -eq 0) {
        throw "Container '$bridgeName' already exists; refusing to modify it. Inspect it before continuing."
      }
      $network = docker network inspect noverhead 2>$null
      if ($LASTEXITCODE -ne 0) { throw "Docker network 'noverhead' is unavailable." }
      $image = docker image inspect alpine:3.22 2>$null
      if ($LASTEXITCODE -ne 0) { throw "Required local image alpine:3.22 is unavailable; refusing to pull/build an image." }
      & docker run --detach --name $bridgeName --label $bridgeLabel --network noverhead `
        --publish 127.0.0.1:18767:18767 alpine:3.22 sh -c `
        "apk add --no-cache socat >/dev/null && exec socat TCP-LISTEN:18767,fork,reuseaddr TCP:node:18766"
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      Write-Output "Started loopback-only bridge 127.0.0.1:18767 -> Node on network noverhead. No volumes are mounted."
      Write-Output "Set the dev agent endpoint to http://127.0.0.1:18767/v1; keep its credential in Paperclip's Secret Provider."
      exit 0
    }
    "bridge-stop" {
      $labels = docker container inspect --format '{{ index .Config.Labels "com.noverhead.paperclip-dev" }}' $bridgeName 2>$null
      if ($LASTEXITCODE -ne 0) {
        Write-Output "No local Node bridge named '$bridgeName' exists."
        exit 0
      }
      if ($labels -ne "261") { throw "Container '$bridgeName' does not carry the expected ownership label; refusing to stop it." }
      $mounts = docker container inspect --format '{{ json .Mounts }}' $bridgeName
      if ($LASTEXITCODE -ne 0 -or $mounts -ne "[]") { throw "Bridge container mount state is unexpected; refusing to remove it." }
      & docker rm --force $bridgeName
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      Write-Output "Stopped and removed the volume-free development bridge."
      exit 0
    }
    "status" {
      $health = Get-DevHealth
      if ($null -eq $health) {
        Write-Output "Paperclip source dev server is not healthy on port $port."
        exit 1
      }
      Write-Output "Paperclip source dev server is healthy at http://127.0.0.1:$port"
      exit 0
    }
    "test" {
      & corepack pnpm exec vitest run server/src/adapters/noverhead-node.test.ts
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      $health = Get-DevHealth
      if ($null -ne $health) {
        Write-Output "Live dev-server health check passed at http://127.0.0.1:$port"
      } else {
        Write-Output "Adapter tests passed. Start the dev server with '.\scripts\dev-noverhead.ps1 start' for live UI verification."
      }
      exit 0
    }
    "live-test" {
      if (-not (docker container inspect $bridgeName 2>$null)) {
        throw "Start the loopback-only Node bridge first: .\scripts\dev-noverhead.ps1 bridge-start"
      }
      $secureToken = Read-Host "Paste the short-lived Node credential (stdin only; it will not be saved)" -AsSecureString
      $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
      try {
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
        $payload = @{ token = $token; prompt = "Reply only with paperclip-e2e-ok" } | ConvertTo-Json -Compress
        $payload | & corepack pnpm --filter @paperclipai/server exec tsx ../scripts/dev-noverhead-live.ts
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        $token = $null
        $payload = $null
        $secureToken.Dispose()
      }
      exit 0
    }
    "start" {
      if (Get-DevHealth) {
        throw "Port $port already serves a healthy Paperclip instance; refusing to replace it."
      }
      $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
      if ($listener) {
        throw "Port $port is already in use; refusing to stop or replace that process."
      }

      New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
      $lockPath = Join-Path $dataDir "paperclip-dev-watch.lock"
      try {
        $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      } catch {
        throw "A Paperclip dev start already holds the isolated data-directory lock at $lockPath."
      }

      $saved = @{}
      foreach ($name in @("PORT", "PATH", "DATABASE_URL", "DATABASE_MIGRATION_URL", "PAPERCLIP_HOME", "PAPERCLIP_CONFIG", "PAPERCLIP_CONTEXT", "PAPERCLIP_DISABLE_CWD_ENV_FILE", "PAPERCLIP_BIND", "PAPERCLIP_UI_DEV_MIDDLEWARE", "PAPERCLIP_MIGRATION_PROMPT", "PAPERCLIP_MIGRATION_AUTO_APPLY")) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
      }
      $shimDir = Join-Path $env:TEMP ("paperclip261-pnpm-shim-" + [guid]::NewGuid().ToString("N"))
      try {
        New-Item -ItemType Directory -Path $shimDir | Out-Null
        $corepack = (Get-Command corepack.cmd -ErrorAction Stop).Source
        Set-Content -LiteralPath (Join-Path $shimDir "pnpm.cmd") -Encoding ascii -Value "@echo off`r`ncall `"$corepack`" pnpm %*`r`n"
        $cargoBin = Join-Path $HOME ".cargo\bin"
        $env:PATH = if (Test-Path -LiteralPath (Join-Path $cargoBin "cargo.exe")) { "$shimDir;$cargoBin;$($saved['PATH'])" } else { "$shimDir;$($saved['PATH'])" }
        $env:PORT = "$port"
        $env:PAPERCLIP_HOME = $dataDir
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:DATABASE_MIGRATION_URL -ErrorAction SilentlyContinue
        Remove-Item Env:PAPERCLIP_CONFIG -ErrorAction SilentlyContinue
        Remove-Item Env:PAPERCLIP_CONTEXT -ErrorAction SilentlyContinue
        $env:PAPERCLIP_DISABLE_CWD_ENV_FILE = "true"
        $env:PAPERCLIP_BIND = "loopback"
        $env:PAPERCLIP_UI_DEV_MIDDLEWARE = "true"
        $env:PAPERCLIP_MIGRATION_PROMPT = "never"
        $env:PAPERCLIP_MIGRATION_AUTO_APPLY = "true"

        Write-Output "Starting Paperclip server dev:watch at http://127.0.0.1:$port"
        Write-Output "Isolated Paperclip data: $dataDir (embedded PostgreSQL; no production database or volume)"
        Write-Output "Press Ctrl+C to stop this dev server."
        & corepack pnpm --filter @paperclipai/server dev:watch
        exit $LASTEXITCODE
      } finally {
        foreach ($name in $saved.Keys) {
          [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process")
        }
        if (Test-Path -LiteralPath $shimDir) { Remove-Item -LiteralPath $shimDir -Recurse -Force }
        $lockStream.Dispose()
        if (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force }
      }
    }
  }
} finally {
  Pop-Location
}
