# Sync of the shared purchase base (library/purchases.json) on launch, right after the update check:
#  - the GitHub base is merged with the local one (the site writes your purchases locally);
#  - your new purchases go to the shared-base server (a Cloudflare Worker, code in worker/worker.js).
#    It validates them and appends them to the base on GitHub; only it has the GitHub token, nothing secret here.
param([string]$Root = $PSScriptRoot)

$BASE_REMOTE = 'https://raw.githubusercontent.com/neverh8me/abi-merchant-helper/main/library/purchases.json'
$WORKER      = 'https://abi-kaluvan.kaluvan-tools.workers.dev/submit'   # shared-base server (worker/worker.js)
$BATCH       = 25   # purchases per request (the Worker accepts no more)
$UA          = 'abi-merchant-helper-sync'

$baseFile = Join-Path $Root 'library\purchases.json'
$mineFile = Join-Path $Root 'purchases.mine.json'   # own purchases (written by the site, not in git)
$sentFile = Join-Path $Root '.purchases-sent.json'
$isClone = Test-Path (Join-Path $Root '.git')        # a git clone (the author): the base file in git is left alone, the Worker maintains it
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Key($e) { "$($e.t)|$($e.itemId)|$($e.price)" }

# Response text always as UTF-8 (Windows PowerShell otherwise guesses the encoding or returns bytes)
function Fetch([string]$url, [int]$timeout) {
  $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $timeout -UserAgent $UA
  return [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
}

function ReadList([string]$json) {
  try { $d = $json | ConvertFrom-Json } catch { return @() }
  if ($d -and $d.purchases) { return @($d.purchases) }
  if ($d -is [array]) { return @($d) }
  return @()
}

function Merge([object[]]$lists) {
  $map = [ordered]@{}
  foreach ($list in $lists) { foreach ($e in $list) { if ($e -and $e.t) { $map[(Key $e)] = $e } } }
  return @($map.Values | Sort-Object { [double]$_.t })
}

try {
  $local = if (Test-Path $baseFile) { ReadList (Get-Content $baseFile -Raw -Encoding UTF8) } else { @() }
  $mine = if (Test-Path $mineFile) { ReadList (Get-Content $mineFile -Raw -Encoding UTF8) } else { @() }
  $remote = @()
  $online = $true
  try { $remote = ReadList (Fetch $BASE_REMOTE 6) }
  catch {
    # 404: there is no base on GitHub yet (online); anything else: offline
    $resp = $_.Exception.Response
    if (-not ($resp -and [int]$resp.StatusCode -eq 404)) { $online = $false }
  }

  # The Worker is the one check on what enters the shared base; the page writes own purchases without free text
  $merged = @(Merge @($remote, $local, $mine))
  $remoteKeys = @{}; foreach ($e in $remote) { $remoteKeys[(Key $e)] = $true }
  $localKeys = @{}; foreach ($e in $local) { $localKeys[(Key $e)] = $true }
  $added = @($merged | Where-Object { -not $localKeys.ContainsKey((Key $_)) }).Count

  if ($WORKER -and $online) {
    # own new purchases go to the Worker; whatever was already sent or is already on GitHub is not sent again
    $sent = @{}
    if (Test-Path $sentFile) { foreach ($k in (Get-Content $sentFile -Raw | ConvertFrom-Json)) { $sent[$k] = $true } }
    foreach ($k in $remoteKeys.Keys) { $sent[$k] = $true }
    $todo = @($mine | Where-Object { -not $sent.ContainsKey((Key $_)) })
    $done = 0
    for ($i = 0; $i -lt $todo.Count; $i += $BATCH) {
      $chunk = @($todo[$i..([Math]::Min($i + $BATCH, $todo.Count) - 1)])
      $json = ConvertTo-Json -InputObject ([ordered]@{ purchases = $chunk }) -Depth 4 -Compress
      try {
        $body = [Text.Encoding]::UTF8.GetBytes($json)
        $r = Invoke-WebRequest $WORKER -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 15 -UserAgent $UA
        $reply = try { [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json } catch { $null }
        # A current Worker lists what it accepted. An older one only takes purchases with a sound: the ones
        # without stay unsent until the Worker is updated, instead of being lost.
        $ok = if ($reply -and $null -ne $reply.accepted) { $null } else { 'sound-only' }
        foreach ($e in $chunk) {
          if ($ok -eq 'sound-only' -and -not $e.soundId) { continue }
          $sent[(Key $e)] = $true
          $done++
        }
      } catch { break } # rate limit or the server is unavailable: the rest goes next time
    }
    [IO.File]::WriteAllText($sentFile, (ConvertTo-Json -InputObject @($sent.Keys) -Compress), (New-Object Text.UTF8Encoding($false)))
    if ($done) { Write-Host "Sent $done of your purchases to the shared database." -ForegroundColor Green }
  }

  if (-not $isClone -and ($added -gt 0 -or $merged.Count -ne $local.Count)) {
    $out = [ordered]@{ updated = [DateTime]::UtcNow.ToString('o'); purchases = @($merged) }
    [IO.File]::WriteAllText($baseFile, (ConvertTo-Json -InputObject $out -Depth 4), (New-Object Text.UTF8Encoding($false)))
  }
  if ($online) { Write-Host "Purchase database updated to the latest version (purchases: $($merged.Count))." -ForegroundColor Green }
  else { Write-Host "Could not reach the purchase database (offline?), using the local copy (purchases: $($merged.Count))." -ForegroundColor DarkYellow }
} catch {
  Write-Host "Purchase database sync failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
}
