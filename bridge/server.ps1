# ASCII only: Windows PowerShell reads a script without a BOM in the system code page.
# The move from the PowerShell version (2.x) to the app (3.0). The old updater unpacks this file over the old
# server.ps1 and runs it, once. It:
#   1. saves what the page kept in the browser (own sounds, profiles, purchases, settings) to userdata.json;
#   2. installs the app (no admin rights) from the same GitHub release;
#   3. starts the app, which takes over userdata.json and the purchase files from this folder;
#   4. points start.bat at the app, so old shortcuts keep working. This folder is left as it is.
# -Installer, -AppArgs, -NoBrowser: for tests.
param([string]$Exe = 'UAGame', [int]$Port = 8777, [switch]$NoUpdate, [string]$Installer, [string]$AppArgs, [switch]$NoBrowser)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = $PSScriptRoot
$repo = 'neverh8me/abi-merchant-helper'
$app  = Join-Path $env:LOCALAPPDATA 'ABI Merchant Helper\abi-merchant-helper.exe'
$data = Join-Path $root 'userdata.json'

Write-Host 'ABI: Merchant Helper is moving to its own app (no browser, no PowerShell).' -ForegroundColor Cyan

# 1. The browser keeps the page's data under http://localhost:PORT, so a page at that address has to hand it over.
if (-not (Test-Path $data)) {
  $page = @'
<!doctype html><meta charset="utf-8"><title>ABI: Merchant Helper</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#050507;color:#f5f5f7;font:16px 'Segoe UI',sans-serif">
<div style="max-width:520px;text-align:center"><h1>ABI: Merchant Helper</h1><p id="m">Moving your sounds, profiles and purchases to the new app...</p></div>
<script>
fetch('/save', { method: 'POST', body: JSON.stringify({ localStorage: Object.fromEntries(Object.entries(localStorage)) }) })
  .then(r => { document.getElementById('m').textContent = r.ok ? 'Done. The new app is opening, you can close this tab.' : 'Could not save the data.'; })
  .catch(() => { document.getElementById('m').textContent = 'Could not save the data.'; });
</script>
'@
  $listener = New-Object Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$Port/")
  try {
    $listener.Start()
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
    Write-Host 'Saving your data from the browser (a tab opens for a moment)...'
    $deadline = (Get-Date).AddSeconds(120)
    while (-not (Test-Path $data) -and (Get-Date) -lt $deadline) {
      $pending = $listener.GetContextAsync()
      if (-not $pending.Wait(($deadline - (Get-Date)))) { break }
      $ctx = $pending.Result
      $req = $ctx.Request; $res = $ctx.Response
      $origin = $req.Headers['Origin']
      if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/save' -and $origin -eq "http://localhost:$Port") {
        $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
        if ($body.StartsWith('{"localStorage"')) { [IO.File]::WriteAllText($data, $body, (New-Object Text.UTF8Encoding($false))); $res.StatusCode = 204 }
        else { $res.StatusCode = 400 }
      } elseif ($req.HttpMethod -eq 'GET') {
        $bytes = [Text.Encoding]::UTF8.GetBytes($page)
        $res.ContentType = 'text/html; charset=utf-8'
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $res.StatusCode = 403 }
      $res.Close()
    }
  } catch { Write-Host "Could not read the browser data: $($_.Exception.Message)" -ForegroundColor DarkYellow }
  finally { try { $listener.Stop(); $listener.Close() } catch { } }
  if (Test-Path $data) { Write-Host 'Your data is saved.' -ForegroundColor Green }
  else { Write-Host 'The browser did not answer: the app starts without your own sounds and profiles. Run start.bat from the old version again to retry.' -ForegroundColor DarkYellow }
}

# 2. The app
if (-not (Test-Path $app)) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('abi-merchant-helper-setup-' + [guid]::NewGuid().ToString('N') + '.exe')
  try {
    if ($Installer) { Copy-Item $Installer $tmp }
    else {
      $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -TimeoutSec 15 -UserAgent 'abi-merchant-helper-updater'
      $asset = $rel.assets | Where-Object { $_.name -like '*-setup.exe' } | Select-Object -First 1
      if (-not $asset) { throw 'the release has no installer' }
      Write-Host "Downloading the app ($([Math]::Round($asset.size / 1MB)) MB)..."
      $ProgressPreference = 'SilentlyContinue'   # the progress bar makes the download many times slower
      Invoke-WebRequest $asset.browser_download_url -OutFile $tmp -UseBasicParsing -UserAgent 'abi-merchant-helper-updater'
    }
    Write-Host 'Installing...'
    Start-Process $tmp -ArgumentList '/S' -Wait
  } catch { Write-Host "Could not install the app: $($_.Exception.Message)" -ForegroundColor Red }
  finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
if (-not (Test-Path $app)) {
  Write-Host "The app is not installed. Download it from https://github.com/$repo/releases/latest and run it." -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

# 3-4. Old shortcuts start the app from now on; it imports this folder's files once (it never overwrites its own)
# %LOCALAPPDATA% stays a variable: a user name with non-Latin letters would not survive a .bat file
[IO.File]::WriteAllText((Join-Path $root 'start.bat'), "@echo off`r`nstart `"`" `"%LOCALAPPDATA%\ABI Merchant Helper\abi-merchant-helper.exe`"`r`n", [Text.Encoding]::ASCII)
$arguments = "--import `"$root`""
if ($AppArgs) { $arguments += " $AppArgs" }
Start-Process $app -ArgumentList $arguments
Write-Host 'Done. ABI: Merchant Helper now runs as its own app; this window can be closed.' -ForegroundColor Green
