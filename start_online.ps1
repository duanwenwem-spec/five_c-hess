$ErrorActionPreference = 'Stop'
$projectDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$tunnelExecutable = Join-Path $projectDirectory 'tools\cloudflared.exe'
$serverProcess = $null
$tunnelProcess = $null
$tunnelLog = Join-Path ([IO.Path]::GetTempPath()) ("gomoku-tunnel-{0}.log" -f [Guid]::NewGuid().ToString('N'))
$shareStaging = $null

function Find-PythonExecutable {
    $knownCommand = Get-Command python, py -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($knownCommand) {
        return $knownCommand.Source
    }

    $pythonRoot = Join-Path $env:LOCALAPPDATA 'Programs\Python'
    if (Test-Path -LiteralPath $pythonRoot) {
        $installedPython = Get-ChildItem -LiteralPath $pythonRoot -Filter python.exe -Recurse -File |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($installedPython) {
            return $installedPython.FullName
        }
    }
    throw '没有找到 Python。请先安装 Python 3.10 或更新版本。'
}

try {
    if (-not (Test-Path -LiteralPath $tunnelExecutable)) {
        throw '缺少 tools\cloudflared.exe，请重新下载联机组件。'
    }

    try {
        $existingServer = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/' -TimeoutSec 1
        if ($existingServer.StatusCode -eq 200) {
            throw '8000 端口已有服务运行。请先关闭其他五子棋窗口后再启动联机。'
        }
    } catch {
        if ($_.Exception.Message -like '8000 端口已有服务运行*') { throw }
    }

    $pythonExecutable = Find-PythonExecutable
    Write-Host '正在启动五子棋服务…' -ForegroundColor Cyan
    $serverProcess = Start-Process -FilePath $pythonExecutable -ArgumentList 'app.py' -WorkingDirectory $projectDirectory -WindowStyle Hidden -PassThru

    $serverReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/' -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                $serverReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if (-not $serverReady) {
        throw '本地游戏服务启动失败，请确认 8000 端口没有被其他程序占用。'
    }

    Write-Host '正在建立 Cloudflare 公网通道…' -ForegroundColor Cyan
    $tunnelProcess = Start-Process -FilePath $tunnelExecutable `
        -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:8000', '--no-autoupdate' `
        -WorkingDirectory $projectDirectory `
        -RedirectStandardError $tunnelLog `
        -WindowStyle Hidden `
        -PassThru

    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
        if ($tunnelProcess.HasExited) {
            throw '公网通道启动失败，请检查网络后重试。'
        }
        if (Test-Path -LiteralPath $tunnelLog) {
            $logContent = Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue
            if ($logContent -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
                $publicUrl = $Matches[0]
                break
            }
        }
        Start-Sleep -Milliseconds 350
    }
    if (-not $publicUrl) {
        throw '没有及时获得公网网址，请检查网络后重试。'
    }

    $guestUrl = "{0}/?online=1" -f $publicUrl
    $sharePackage = Join-Path $projectDirectory '发给朋友-加入游戏.zip'
    $shareStaging = Join-Path ([IO.Path]::GetTempPath()) ("gomoku-guest-{0}" -f [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $shareStaging | Out-Null
    $guestPage = @"
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=$guestUrl">
  <title>加入五子棋</title>
  <style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:24px;color:#17231f;background:#f3f0e7}a{color:#a33d2f}</style>
</head>
<body>
  <h1>正在打开五子棋…</h1>
  <p>如果没有自动跳转，请<a href="$guestUrl">点击这里进入游戏</a>。</p>
</body>
</html>
"@
    Set-Content -LiteralPath (Join-Path $shareStaging '双击加入五子棋.html') -Value $guestPage -Encoding UTF8
    $guestInstructions = @"
五子棋联机说明

1. 双击“双击加入五子棋.html”。
2. 浏览器打开后，输入房主提供的六位房间号。
3. 点击“加入”，等待房主执黑先行。

注意：房主必须保持联机启动窗口开启。本文件只对本次联机有效。
"@
    Set-Content -LiteralPath (Join-Path $shareStaging '使用说明.txt') -Value $guestInstructions -Encoding UTF8
    Compress-Archive -Path (Join-Path $shareStaging '*') -DestinationPath $sharePackage -Force

    try { Set-Clipboard -Value $publicUrl } catch { }
    Write-Host ''
    Write-Host '联机服务已经就绪！' -ForegroundColor Green
    Write-Host ('公网入口：{0}' -f $publicUrl) -ForegroundColor Yellow
    Write-Host '网址已经复制到剪贴板。请在网页中创建房间，再把房间号发给朋友。'
    Write-Host ('朋友端压缩包：{0}' -f $sharePackage) -ForegroundColor Yellow
    Write-Host '把这个 ZIP 发给朋友；对方解压并双击其中的 HTML，再输入房间号即可。'
    Write-Host '此窗口关闭后，联机房间会立即停止。' -ForegroundColor DarkYellow
    Write-Host ''

    Start-Process $guestUrl
    Read-Host '按回车键关闭联机服务'
}
catch {
    Write-Host ''
    Write-Host ('启动失败：{0}' -f $_.Exception.Message) -ForegroundColor Red
}
finally {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $tunnelLog) {
        Remove-Item -LiteralPath $tunnelLog -Force -ErrorAction SilentlyContinue
    }
    if ($shareStaging -and (Test-Path -LiteralPath $shareStaging)) {
        Remove-Item -LiteralPath $shareStaging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
