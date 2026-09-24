# 变更记录

本文件记录模板自身的演进。业务项目接入后，建议保留本文件并追加项目侧变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.2.0] - 2026-09-24

### 新增

- **任务归属与并行协调**（`docs/02-团队协作与角色.md` 第四节）：归属从 Git 事实派生，不维护手工台账；
  新增 `scripts/tasks.mjs` 任务占用看板，自动检测多分支改动同一批文件。
- **影响面与回归防护**（`docs/12-影响面与回归防护.md`）与自研技能 `skills/impact-analysis/`：
  改动前记录测试基线、反查调用方、按改动级别决定验证强度，回归结果与基线对比。
- `.tasksignore`：排除长命共享分支，避免看板被噪声淹没。
- **主干分支可配置**：`scripts/bootstrap.mjs` 自动识别主干并写入 `workflow.config.json` 的 `trunkBranch`，
  也可用 `--trunk <分支>` 指定；看板优先读取该配置，不再默认假设主干是 `main` / `master`。
- **长命 / 分叉分支识别**：单个分支「自身改动」超过 200 个文件时，看板将其排除在重叠分析之外并提示检查基线。

### 说明

- 看板统计口径为「最近 N 天内该分支自身提交所触及的文件」，同时用 `--since` 限定时间、用 `--not <主干>` 排除共享历史；
  只取全量差异会产生数百处误报（实测某仓库 1035 处），只按时间取会把共享基线算成重叠（新仓库里尤甚）。
- 长命共享分支（`int` / `develop` / `release/*`）需要排除，这本身也是分支模型该收敛的信号。

## [1.1.0] - 2026-09-24

### 新增

- 需求接收与拆解流程：`docs/11-需求接收与拆解.md` + 自研技能 `skills/requirement-intake/`。
  解决「产品给了 PRD 和原型图，原件放哪、技术实现写哪」的问题。
- `spec/` 由单文件升级为目录形态：`spec/<日期>-<主题>/` 下含 `需求与技术对照.md`、`原始需求/`、`原型/`，
  原件只增不改，技术实现统一写在对照表中，不污染 PRD 原件。
- `new-spec.mjs` 支持 `--with-artifacts`，一次生成需求目录、原件目录与验收骨架。
- `check-docs.mjs` 新增 `spec/` 目录结构与主文档检查（E402 / E403）。

### 说明

- 兼容旧的单文件形态 `spec/<日期>-<主题>.md`，轻量需求仍可使用。
- 二进制原件（`.docx` / `.pdf`）要求同目录留一份 markdown 转换件，便于 AI 与检索定位；冲突时以原件为准。

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
