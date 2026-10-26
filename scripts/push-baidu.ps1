# 百度主动推送：官网更新后告诉百度来抓，比等爬虫快得多（通常几小时~2 天）
# token 存在仓库根目录的 .baidu-token（已被 .gitignore 忽略，不会进 git）
# 每天配额有限（新站约 10 条），所以只在「官网有更新」时推一次，别反复推同一个页面。

param(
  [string]$Site = 'https://www.huiranpk.com',
  [string[]]$Urls = @('https://www.huiranpk.com/')
)

$ErrorActionPreference = 'Stop'

$tokenFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.baidu-token'
if (-not (Test-Path $tokenFile)) {
  Write-Host '没找到 .baidu-token（跳过百度推送）' -ForegroundColor Yellow
  exit 0
}
$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) {
  Write-Host '.baidu-token 是空的（跳过百度推送）' -ForegroundColor Yellow
  exit 0
}

# 注意：site 参数不能 URL 编码，否则百度返回 {"error":400,"message":"site init fail"}
$bodyText = ($Urls -join "`n")
$body = [Text.Encoding]::UTF8.GetBytes($bodyText)
$path = "/urls?site=$Site&token=$token"
$head = "POST $path HTTP/1.1`r`nHost: data.zz.baidu.com`r`nUser-Agent: huiran-publish`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
$headBytes = [Text.Encoding]::ASCII.GetBytes($head)

$tcp = New-Object System.Net.Sockets.TcpClient
try {
  $tcp.Connect('data.zz.baidu.com', 80)
  $stream = $tcp.GetStream()
  $stream.Write($headBytes, 0, $headBytes.Length)
  $stream.Write($body, 0, $body.Length)
  $stream.Flush()
  $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
  $all = $reader.ReadToEnd()
} catch {
  Write-Host ("百度推送失败（不影响发布）：" + $_.Exception.Message) -ForegroundColor Yellow
  exit 0
} finally {
  $tcp.Close()
}

$idx = $all.IndexOf("`r`n`r`n")
$json = if ($idx -ge 0) { $all.Substring($idx + 4) } else { $all }
Write-Host ("百度主动推送 → " + $json.Trim()) -ForegroundColor Cyan
