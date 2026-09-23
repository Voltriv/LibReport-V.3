param(
  [int]$Port = 3000
)

try {
  $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
    }
    Write-Output "Freed port $Port (terminated PIDs: $($pids -join ', '))."
    exit 0
  }
} catch {}

try {
  $lines = netstat -ano | Select-String ":[${Port}]" | Select-Object -First 1
  if ($lines) {
    $parts = ($lines -split "\s+") | Where-Object { $_ -ne '' }
    $pid = $parts[-1]
    if ($pid -match '^\d+$') {
      try { Stop-Process -Id [int]$pid -Force -ErrorAction SilentlyContinue } catch {}
      Write-Output "Freed port $Port (terminated PID: $pid)."
      exit 0
    }
  }
} catch {}

Write-Output "No process found on port $Port."
exit 0

