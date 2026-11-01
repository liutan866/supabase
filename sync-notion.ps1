$ErrorActionPreference = 'Stop'
$syncToken = Read-Host '輸入 Cloudflare 的 NOTION_SYNC_SECRET（輸入不會顯示）' -AsSecureString
$syncCredential = [System.Net.NetworkCredential]::new('', $syncToken)
$syncHeaders = @{ Authorization = 'Bearer ' + $syncCredential.Password }
$syncCursor = $null
$syncTotal = 0
try {
  do {
    $syncBody = @{}
    if ($syncCursor) { $syncBody.after = $syncCursor }
    $syncResult = $null
    for ($syncAttempt = 1; $syncAttempt -le 3; $syncAttempt++) {
      try {
        $syncResult = Invoke-RestMethod -Method Post -Uri 'https://restless-cherry-3164.dennis866.workers.dev/api/notion/backfill' -Headers $syncHeaders -ContentType 'application/json' -Body ($syncBody | ConvertTo-Json) -TimeoutSec 300
        break
      } catch {
        if ($syncAttempt -eq 3) { throw }
        Write-Host '此批次失敗，5 秒後重試。請勿同時執行其他補同步。'
        Start-Sleep -Seconds 5
      }
    }
    $syncTotal += $syncResult.synced
    Write-Host "已處理 $syncTotal 筆行程"
    $syncCursor = $syncResult.next
  } while ($syncCursor)
  Write-Host '補同步完成。'
} finally {
  $syncHeaders.Clear()
  $syncCredential = $null
  $syncToken.Dispose()
}
