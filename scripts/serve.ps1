# AndRawApp 本地 HTTP 服务脚本
# 用法：在项目根目录执行 .\scripts\serve.ps1
# 默认端口 8000，浏览器访问 http://localhost:8000

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

# 切到项目根目录（脚本在 scripts/ 下，向上回溯一级）
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " AndRawApp 本地服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "项目目录: $projectRoot" -ForegroundColor Gray
Write-Host "访问地址: http://localhost:$Port" -ForegroundColor Green
Write-Host ""
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Yellow
Write-Host ""

# 优先用 Python（Windows 自带或已装）
$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    Write-Host "[使用 Python] 启动 HTTP 服务..." -ForegroundColor Gray
    python -m http.server $Port
    return
}

# 退而求其次用 Node http-server
$node = Get-Command npx -ErrorAction SilentlyContinue
if ($node) {
    Write-Host "[使用 Node http-server] 启动 HTTP 服务..." -ForegroundColor Gray
    npx http-server -p $Port -c-1
    return
}

Write-Host "[错误] 未找到 Python 或 Node.js，请先安装其中之一。" -ForegroundColor Red
Write-Host "  Python: https://www.python.org/downloads/" -ForegroundColor Gray
Write-Host "  Node.js: https://nodejs.org/" -ForegroundColor Gray
exit 1
