<#
.SYNOPSIS
  TShockPanel 后端冒烟测试：启动面板 → 探测接口 → 记录响应“形状” → 关闭并还原现场。

.DESCRIPTION
  本项目没有 C# 源码，也没有 .NET SDK，`dotnet build` 不适用。重构的等价验收是：
    1) 所有 JS 通过 node --check；
    2) 面板能启动，HTTP 接口的状态码与 JSON 形状（字段名/类型/数组长度标记）不变；
    3) 启动/关闭这一趟不留下对 tshock/*.json、panel.json 的意外修改。

  形状比较刻意不看具体值（在线人数、时间戳、文件大小本来就会变），只看
  “字段有没有少/多/改名/改类型”，正好对应重构“对外行为不变”的要求。

  兼容 Windows PowerShell 5.1（本机没有 pwsh 7）。

.EXAMPLE
  # 改动前录基线
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\smoke.ps1 -Record before

.EXAMPLE
  # 改动后对比
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\smoke.ps1 -CompareTo before
#>
param(
  [int]$Port = 13087,
  [string]$Record,
  [string]$CompareTo,
  [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$smokeRoot = Join-Path $PSScriptRoot 'smoke'
$recordName = if ($Record) { $Record } else { 'last' }
$runDir = Join-Path $smokeRoot $recordName
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('tshockpanel-smoke-' + [guid]::NewGuid().ToString('N'))

# 会被运行期改写、但必须证明“没被意外改写”的文件
$watched = @(
  'tshock\config.json',
  'tshock\sscconfig.json',
  'TShockPanel\panel.json'
)

$probes = @(
  @{ path = '/'; expect = 200 },
  @{ path = '/js/00-core.js'; expect = 200 },
  @{ path = '/api/state'; expect = 200 },
  @{ path = '/api/logs'; expect = 200 },
  @{ path = '/api/config'; expect = 200 },
  @{ path = '/api/sscconfig'; expect = 200 },
  @{ path = '/api/text?name=motd'; expect = 200 },
  @{ path = '/api/text?name=bogus'; expect = 400 },
  @{ path = '/api/items?q=Zenith'; expect = 200 },
  @{ path = '/api/worlds'; expect = 200 },
  @{ path = '/api/backups'; expect = 200 },
  @{ path = '/api/ui'; expect = 200 },
  @{ path = '/api/plugins'; expect = 200 },
  @{ path = '/api/warps'; expect = 200 },
  @{ path = '/api/players'; expect = 400 },
  @{ path = '/api/bans'; expect = 400 },
  @{ path = '/api/groups'; expect = 400 },
  @{ path = '/api/users'; expect = 400 },
  @{ path = '/api/ssc/inventory'; expect = 200 },
  @{ path = '/api/group-names'; expect = 400 },
  @{ path = '/api/world-events'; expect = 400 },
  @{ path = '/nope.html'; expect = 404 },
  @{ path = '/api/not-exist'; expect = 404 }
)

function Write-Step([string]$text) { Write-Host "  $text" -ForegroundColor DarkGray }
function Write-Ok([string]$text) { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Bad([string]$text) { Write-Host "  [FAIL] $text" -ForegroundColor Red }

function Get-TextShape {
  param($Value, [string]$Path)
  $out = @()
  if ($null -eq $Value) { return @("${Path}:null") }
  if ($Value -is [System.Array]) {
    # 只断言“是数组 + 元素结构”，不记录长度：备份条数、在线人数本来就会变
    $out += "${Path}:array"
    if ($Value.Count -gt 0) { $out += Get-TextShape -Value $Value[0] -Path "$Path[0]" }
    return $out
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    foreach ($prop in ($Value.PSObject.Properties | Sort-Object Name)) {
      $out += Get-TextShape -Value $prop.Value -Path "$Path.$($prop.Name)"
    }
    return $out
  }
  if ($Value -is [bool]) { return @("${Path}:bool") }
  if ($Value -is [string]) { return @("${Path}:string") }
  if ($Value -is [ValueType]) { return @("${Path}:number") }
  return @("${Path}:$($Value.GetType().Name)")
}

function Wait-Port {
  param([int]$p, [int]$timeoutSec = 25)
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $async = $client.BeginConnect('127.0.0.1', $p, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(300) -and $client.Connected) { return $true }
    } catch {
    } finally {
      $client.Close()
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

# Invoke-WebRequest 在 4xx/5xx 上会抛异常；统一取回状态码与响应体
function Invoke-Probe {
  param([string]$Url)
  try {
    $resp = Invoke-WebRequest -Uri $Url -TimeoutSec 20 -UseBasicParsing
    return @{ Status = [int]$resp.StatusCode; Body = [string]$resp.Content }
  } catch {
    $response = $_.Exception.Response
    if ($null -eq $response) { return @{ Status = 0; Body = "REQUEST_ERROR: $($_.Exception.Message)" } }
    $status = [int]$response.StatusCode
    $body = ''
    try {
      $stream = $response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()
    } catch {
    }
    return @{ Status = $status; Body = $body }
  }
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'TShockPanel 冒烟测试' -ForegroundColor Cyan
Write-Host "  项目根目录：$root"
Write-Host "  端口：$Port"
Write-Host ''

# 0. 前置检查
$busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($busy) {
  Write-Bad "端口 $Port 已被占用（可能是你正开着面板）。请先关掉，或用 -Port 换一个空闲端口。"
  exit 2
}

# 1. 语法检查
Write-Host '1) 语法检查' -ForegroundColor Yellow
$jsFiles = @(Get-ChildItem -Path $root -Recurse -Filter *.js -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\tools\\smoke\\' })
$syntaxBad = 0
foreach ($f in $jsFiles) {
  $null = & node --check $f.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Bad "$($f.Name) 语法错误"; $syntaxBad++ }
}
if ($syntaxBad -eq 0) { Write-Ok "$($jsFiles.Count) 个 JS 文件全部通过 node --check" }

# 2. 现场快照
Write-Host '2) 现场快照' -ForegroundColor Yellow
$before = @{}
foreach ($rel in $watched) {
  $full = Join-Path $root $rel
  if (Test-Path $full) {
    $before[$rel] = (Get-FileHash $full -Algorithm SHA256).Hash
    Write-Step "$rel 已记录"
  } else {
    $before[$rel] = 'MISSING'
    Write-Step "$rel 不存在（跳过）"
  }
}

# 3. 启动面板
Write-Host '3) 启动面板' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$stdout = Join-Path $tempDir 'stdout.log'
$stderr = Join-Path $tempDir 'stderr.log'
$nodeExe = (Get-Command node).Source
$serverJs = Join-Path $root 'TShockPanel\server.js'
$proc = Start-Process -FilePath $nodeExe `
  -ArgumentList "`"$serverJs`" --no-open" `
  -WorkingDirectory $root -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

if (-not (Wait-Port -p $Port)) {
  Write-Bad '面板在 25 秒内没有监听端口'
  if (Test-Path $stderr) { Get-Content $stderr -Tail 20 | ForEach-Object { Write-Host "    $_" } }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Ok "面板已启动（PID $($proc.Id)）"

# 4. 探测接口
Write-Host '4) 探测接口' -ForegroundColor Yellow
if (Test-Path $runDir) { Remove-Item $runDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$failures = @()
$results = @()

foreach ($probe in $probes) {
  $url = "http://127.0.0.1:$Port$($probe.path)"
  $res = Invoke-Probe -Url $url
  $status = $res.Status
  $body = $res.Body

  if ($status -eq 0) {
    $failures += "$($probe.path) 请求失败：$body"
    continue
  }
  if ($status -ne $probe.expect) {
    $failures += "$($probe.path) 期望 $($probe.expect)，实际 $status"
  }

  $name = ($probe.path -replace '^/api/', '' -replace '[^A-Za-z0-9]+', '_').Trim('_')
  if ([string]::IsNullOrWhiteSpace($name)) { $name = 'index' }
  $shapeFile = Join-Path $runDir "$name.shape"
  $lines = @("HTTP $status")

  $parsed = $null
  $trimmed = $body.TrimStart()
  if ($trimmed.StartsWith('{') -or $trimmed.StartsWith('[')) {
    try { $parsed = $body | ConvertFrom-Json } catch { $parsed = $null }
  }
  if ($null -ne $parsed) {
    $lines += Get-TextShape -Value $parsed -Path '$'
  } elseif ($status -ne 200 -and $body.Length -lt 400) {
    # 错误文案本身是对外契约，逐字记录
    $lines += "body:$($body.Trim())"
  } else {
    # 静态资源只断言“能取到”，不比字节数（HTML/CSS 每次改都可能变长度；
    # 前端脚本是否完整由 tools/frontend-check.js 与 frontend-boot.js 负责）
    $lines += 'body:static'
  }
  Set-Content -Path $shapeFile -Value $lines -Encoding Ascii
  $results += New-Object PSObject -Property @{ Path = $probe.path; Status = $status; Expect = $probe.expect; Lines = $lines.Count }
}

Write-Host ($results | Select-Object Path, Status, Expect, Lines | Format-Table -AutoSize | Out-String -Width 120)

# 5. 关闭并校验现场
Write-Host '5) 关闭并校验现场' -ForegroundColor Yellow
if (-not $KeepRunning) {
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Milliseconds 500
  }
}

$drift = 0
foreach ($rel in $watched) {
  $full = Join-Path $root $rel
  $now = if (Test-Path $full) { (Get-FileHash $full -Algorithm SHA256).Hash } else { 'MISSING' }
  if ($now -ne $before[$rel]) {
    Write-Bad "$rel 在启动/关闭过程中被改写"
    $drift++
  }
}
if ($drift -eq 0) { Write-Ok 'tshock/*.json 与 panel.json 没有被意外改写' }
if ($drift -gt 0) { $failures += "$drift 个配置文件在冒烟过程中被意外改写" }

if (Test-Path $stderr) {
  $errText = Get-Content $stderr -Raw
  if ($errText -and $errText -match '未捕获异常|面板启动失败') {
    Write-Bad '面板 stderr 出现异常：'
    Write-Host $errText
    $failures += '面板运行时抛出了未捕获异常'
  }
}

# 6. 与基线对比
if ($CompareTo) {
  Write-Host "6) 与基线对比（$CompareTo）" -ForegroundColor Yellow
  $baseDir = Join-Path $smokeRoot $CompareTo
  if (-not (Test-Path $baseDir)) {
    Write-Bad "基线目录不存在：$baseDir"
    exit 2
  }
  $baseFiles = @(Get-ChildItem $baseDir -Filter *.shape | Sort-Object Name)
  $shapeDiff = 0
  foreach ($bf in $baseFiles) {
    $cf = Join-Path $runDir $bf.Name
    if (-not (Test-Path $cf)) { Write-Bad "本次缺少 $($bf.Name)"; $shapeDiff++; continue }
    $a = @(Get-Content $bf.FullName)
    $b = @(Get-Content $cf)
    $d = @(Compare-Object -ReferenceObject $a -DifferenceObject $b)
    if ($d.Count -gt 0) {
      Write-Bad "$($bf.BaseName) 接口形状发生变化："
      foreach ($item in $d) { Write-Host ("        {0} {1}" -f $item.SideIndicator, $item.InputObject) }
      $shapeDiff++
    }
  }
  if ($shapeDiff -eq 0) { Write-Ok "全部 $($baseFiles.Count) 个接口形状与基线一致" }
  if ($shapeDiff -gt 0) { $failures += "$shapeDiff 个接口形状与基线不一致" }
}

Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($failures.Count -gt 0 -or $syntaxBad -gt 0) {
  Write-Host '结果：不通过' -ForegroundColor Red
  foreach ($f in $failures) { Write-Host "  - $f" -ForegroundColor Red }
  exit 1
}
Write-Host '结果：通过' -ForegroundColor Green
Write-Host "  形状记录：$runDir"
exit 0
