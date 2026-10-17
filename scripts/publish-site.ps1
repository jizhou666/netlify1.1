<#
  一键发布「独立站（company-site）」到服务器
  用法：双击仓库根目录的「发布独立站.bat」

  它做的事：打包站点代码 → 上传 → 解压覆盖 /opt/company-site → 重启服务
  注意：
    · 只覆盖「代码」（html/js/css/server.js 等）
    · **不会**覆盖服务器上的 data/ 和 uploads/（后台改的内容、上传的图片都在那边）
    · 独立站没有构建步骤，重启几秒就生效
#>
[CmdletBinding()]
param(
  [string]$Server = 'root@8.163.86.170',
  [string]$SiteDir = 'E:\HRBZ\company-site',
  [string]$RemoteDir = '/opt/company-site'
)

$ErrorActionPreference = 'Stop'
$sshOpts = @('-n', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')
$scpOpts = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')
function Step([string]$n, [string]$t) { Write-Host ''; Write-Host "== $n $t" -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host ''; Write-Host "[失败] $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $SiteDir 'server.js'))) { Fail "找不到站点目录：$SiteDir" }

$name = Split-Path $SiteDir -Leaf          # company-site
$parent = Split-Path $SiteDir -Parent      # E:\HRBZ
$archive = Join-Path $env:TEMP "$name.tgz"

Step '1/3' '打包站点代码（不含 data / uploads / logs）'
if (Test-Path $archive) { Remove-Item $archive -Force }
& tar -czf $archive -C $parent --exclude "$name/data" --exclude "$name/uploads" --exclude "$name/logs" $name
if ($LASTEXITCODE -ne 0) { Fail '打包失败' }
Write-Host ("包大小：{0:N0} KB" -f ((Get-Item $archive).Length / 1KB))

Step '2/3' "上传并部署（$Server）"
& scp @scpOpts $archive "${Server}:/tmp/$name.tgz"
if ($LASTEXITCODE -ne 0) { Fail '上传失败：检查 SSH 免密是否配好（见 deploy/README.md）' }

$remote = @"
set -e
sudo tar -xzf /tmp/$name.tgz -C /opt
sudo chown -R root:root $RemoteDir
sudo chown -R huiran:huiran $RemoteDir/uploads $RemoteDir/data $RemoteDir/logs 2>/dev/null || true
sudo systemctl restart company-site
sleep 3
curl -fsS http://127.0.0.1:8081/ -o /dev/null && echo '服务器自检：独立站 200 OK'
"@
& ssh @sshOpts $Server $remote
if ($LASTEXITCODE -ne 0) { Fail '服务器部署失败（看上面的输出，或 journalctl -u company-site -n 50）' }

Step '3/3' '完成'
Write-Host '独立站已更新。刷新页面即可看到（Ctrl+F5）。' -ForegroundColor Green
