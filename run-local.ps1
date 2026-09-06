$ErrorActionPreference = "Stop"

$taskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskServerPath = Join-Path $taskRoot "server.mjs"
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskNodePath = if ($taskNodeCommand) {
  $taskNodeCommand.Source
} else {
  Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}

if (-not (Test-Path -LiteralPath $taskNodePath)) {
  throw "Node.js 22 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요."
}

$taskPort = 4173
$taskUrl = "http://127.0.0.1:$taskPort"
$taskPreviousPort = $env:PORT
$taskProcess = $null

try {
  $env:PORT = [string]$taskPort
  $taskProcess = Start-Process `
    -FilePath $taskNodePath `
    -ArgumentList ('"' + $taskServerPath + '"') `
    -WorkingDirectory $taskRoot `
    -WindowStyle Hidden `
    -PassThru

  $taskReady = $false
  foreach ($taskAttempt in 1..25) {
    if ($taskProcess.HasExited) {
      throw "로컬 서버를 시작하지 못했습니다. 포트 $taskPort 사용 여부를 확인해 주세요."
    }
    try {
      $taskResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $taskUrl
      if ($taskResponse.StatusCode -eq 200) {
        $taskReady = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }

  if (-not $taskReady) {
    throw "로컬 서버가 제한 시간 안에 준비되지 않았습니다."
  }

  Start-Process $taskUrl
  Write-Host "상환ON MVP를 열었습니다: $taskUrl" -ForegroundColor Green
  [void](Read-Host "서버를 종료하려면 Enter 키를 누르세요")
} finally {
  $env:PORT = $taskPreviousPort
  if ($taskProcess -and -not $taskProcess.HasExited) {
    Stop-Process -Id $taskProcess.Id
  }
}
