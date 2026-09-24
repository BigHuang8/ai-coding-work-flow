<!-- 本文件由 node scripts/sync-agent-config.mjs 生成，规范内容以 AGENTS.md 为准，请勿手工编辑 -->

# Copilot 说明

本项目的开发规范以仓库根目录的 `AGENTS.md` 为**唯一事实来源**。本文件只做转发。

要点：

- 遵循 `docs/05-分支提交与评审.md` 的提交信息格式：`type(scope): subject`。
- 提交前运行模块校验命令，见 `AGENTS.md` 的命令索引。
- 不生成包含真实密钥、口令或用户数据的示例代码。
- 只使用仓库内技能（`skills/` 与 `.agents/skills/`），不要调用个人目录下的技能。
- 更完整的规则见 `AGENTS.md` 与 `docs/`。
