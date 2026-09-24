<!-- 本文件由 node scripts/sync-agent-config.mjs 生成，规范内容以 AGENTS.md 为准，请勿手工编辑 -->

# Claude Code 入口

本项目的开发规范以 `AGENTS.md` 为**唯一事实来源**，本文件只做转发，不要在此处编写规范内容。

请先阅读并遵守：

@AGENTS.md

补充说明：

- 工作流文档位于 `docs/`，按编号顺序阅读。
- 自研技能位于 `skills/`，外部引入技能位于 `.agents/skills/`（来源与哈希见 `skills-lock.json`）。
- **只使用仓库内技能**：禁止调用个人目录下的技能（`~/.codex/skills`、`~/.claude/skills` 等），需要新能力先引入到仓库。
- 声称任务完成前，必须实际运行验证命令并给出命令与原始输出。
- 禁止把密钥、口令、真实用户数据写入任何被提交的文件。
