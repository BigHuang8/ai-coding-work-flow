# 安装 Git 钩子：把 core.hooksPath 指向仓库内的 .githooks
# 用法：pwsh scripts/install-hooks.ps1

$ErrorActionPreference = 'Stop'

$root = git rev-parse --show-toplevel
if (-not $root) {
    Write-Error '当前目录不是 Git 仓库。'
    exit 1
}

Set-Location $root

if (-not (Test-Path '.githooks')) {
    Write-Error '当前仓库没有 .githooks 目录，请确认已注入工作流模板。'
    exit 1
}

git config core.hooksPath .githooks

Write-Host '✅ Git 钩子已安装。'
Write-Host ''
Write-Host "当前配置：core.hooksPath = $(git config core.hooksPath)"
Write-Host ''
Write-Host '钩子说明：'
Write-Host '  commit-msg  校验提交信息格式 type(scope): subject'
Write-Host '  pre-commit  文档规范自检 + 项目校验命令'
Write-Host '  pre-push    多 AI 工具配置同步检查 + 项目校验命令'
Write-Host ''
Write-Host '注意：Windows 下 Git 使用自带的 sh 执行钩子脚本，请确认已安装 Git for Windows。'
Write-Host ''
Write-Host '验证方式：'
Write-Host '  git commit --allow-empty -m "随便写"                        # 应被拒绝'
Write-Host '  git commit --allow-empty -m "chore(workflow): 验证钩子"     # 应通过'
