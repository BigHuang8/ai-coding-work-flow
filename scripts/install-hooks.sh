#!/usr/bin/env bash
# 安装 Git 钩子：把 core.hooksPath 指向仓库内的 .githooks
# 用法：bash scripts/install-hooks.sh

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if [ ! -d .githooks ]; then
  echo "错误：当前仓库没有 .githooks 目录，请确认已注入工作流模板。" >&2
  exit 1
fi

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "✅ Git 钩子已安装。"
echo ""
echo "当前配置：core.hooksPath = $(git config core.hooksPath)"
echo ""
echo "钩子说明："
echo "  commit-msg  校验提交信息格式 type(scope): subject"
echo "  pre-commit  文档规范自检 + 项目校验命令"
echo "  pre-push    多 AI 工具配置同步检查 + 项目校验命令"
echo ""
echo "验证方式："
echo "  git commit --allow-empty -m \"随便写\"          # 应被拒绝"
echo "  git commit --allow-empty -m \"chore(workflow): 验证钩子\"   # 应通过"
