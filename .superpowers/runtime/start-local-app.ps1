$ErrorActionPreference = 'Stop'
$taskRepo = 'C:\Users\gaura\OneDrive\Desktop\Cine-Hook'
$taskRuntime = Join-Path $taskRepo '.superpowers\runtime'
$taskNode = 'C:\Program Files\nodejs\node.exe'
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null

if (-not (Get-NetTCPConnection -State Listen -LocalPort 4000 -ErrorAction SilentlyContinue)) {
  $taskBackend = Join-Path $taskRepo 'backend'
  $taskBackendArgs = '"' + (Join-Path $taskBackend 'node_modules\tsx\dist\cli.mjs') + '" "' + (Join-Path $taskBackend 'scripts\dev-launch.ts') + '" start'
  Start-Process -FilePath $taskNode -ArgumentList $taskBackendArgs -WorkingDirectory $taskBackend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime "backend-$taskStamp.out.log") -RedirectStandardError (Join-Path $taskRuntime "backend-$taskStamp.err.log")
}
if (-not (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue)) {
  $taskFrontend = Join-Path $taskRepo 'frontend'
  $taskFrontendArgs = '"' + (Join-Path $taskFrontend 'node_modules\vite\bin\vite.js') + '" --host 127.0.0.1 --port 5173 --strictPort'
  Start-Process -FilePath $taskNode -ArgumentList $taskFrontendArgs -WorkingDirectory $taskFrontend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime "frontend-$taskStamp.out.log") -RedirectStandardError (Join-Path $taskRuntime "frontend-$taskStamp.err.log")
}
