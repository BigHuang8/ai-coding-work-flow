# 变更记录

本文件记录模板自身的演进。业务项目接入后，建议保留本文件并追加项目侧变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.0.0] - 2026-09-24

### 新增

- 三层治理模型（制度层 / 能力层 / 执行层）与文档职责边界表。
- 六阶段流水线（需求澄清 → 方案设计 → 实现 → 验证 → 评审 → 交付）及阶段门禁。
- 自研技能：`flow-orchestrator`、`spec-writer`、`dual-axis-review`、`evidence-driven-verification`。
- 执行层工具：`install-hooks`、`bootstrap`、`check-docs`、`new-spec`、`sync-agent-config`。
- Git 钩子：提交信息校验、分模块提交前校验、推送前校验。
- CI 工作流：规范检查与文档守卫。
- 业务项目模板：`templates/project/`（`AGENTS.md`、`SPEC.md`、`MEMORY.md`、`API_CONTRACT.md`、`spec/`）。
- 设计稿与计划留档目录 `docs/designs/`、`docs/plans/`，含可直接套用的模板。
- `.gitattributes` 统一换行符，避免 Windows 与 macOS/Linux 混合协作时产生整文件差异。
- 多 AI 工具兼容：以 `AGENTS.md` 为单一来源，生成 Claude Code 与 Cursor 的入口配置。
- 密钥零入库规则与提交前敏感信息扫描。

### 说明

- 首版面向「多人 + 多 AI 助手」的中小型研发团队，技术栈以 Java/Spring Boot 与 Vue 3 为默认适配，其余栈通过 `docs/10-技术栈适配.md` 扩展。
