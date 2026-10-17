<#
  一键发布「库存台账」到服务器
  用法：双击仓库根目录的「发布到服务器.bat」，或手动：
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish.ps1

  它做的事：类型检查 → 提交并推送 GitHub → 让服务器拉取并重建 → 自检
  前提：本机能免密 SSH 登录服务器（首次配置见 deploy/README.md「一键发布」一节）
#>
[CmdletBinding()]
param(
  [string]$Server = 'root@8.163.86.170',
  [string]$RemoteDir = '/opt/inventory/app',
  [switch]$SkipCheck
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$sshOpts = @('-n', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')
function Step([string]$n, [string]$t) { Write-Host ''; Write-Host "== $n $t" -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host ''; Write-Host "[失败] $msg" -ForegroundColor Red; exit 1 }

Step '1/4' '检查代码（类型检查，约 20 秒）'
if (-not $SkipCheck) {
  & npm run typecheck
  if ($LASTEXITCODE -ne 0) { Fail '类型检查没通过，已停止发布（先修好再发布）' }
}

Step '2/4' '提交并推送到 GitHub'
& git add -A
$changed = & git status --porcelain
if ($changed) {
  $msg = '发布 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Write-Host "提交说明：$msg"
  & git commit -m $msg | Out-Host
} else {
  Write-Host '没有文件改动，跳过提交'
}
& git push
if ($LASTEXITCODE -ne 0) { Fail 'git push 失败：检查网络或 Git 凭据' }

Step '3/4' "让服务器拉取并重建（$Server，约 3~8 分钟）"
& ssh @sshOpts $Server "cd $RemoteDir && git fetch -q origin && git reset --hard origin/main && bash deploy/update.sh"
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '服务器更新失败。两种常见原因：' -ForegroundColor Yellow
  Write-Host '  1) 还没配 SSH 免密登录（提示 permission denied / BatchMode）' -ForegroundColor Yellow
  Write-Host '     一次性配置：ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519"' -ForegroundColor Yellow
  Write-Host '     再把 ~\.ssh\id_ed25519.pub 的内容加到服务器 ~/.ssh/authorized_keys' -ForegroundColor Yellow
  Write-Host '  2) 服务器上 git pull 拉不动 GitHub：改成打包上传，见 deploy/README.md' -ForegroundColor Yellow
  exit 1
}

Step '4/4' '完成'
Write-Host '已发布到服务器。浏览器里按 Ctrl+F5 强制刷新即可看到新版本。' -ForegroundColor Green
