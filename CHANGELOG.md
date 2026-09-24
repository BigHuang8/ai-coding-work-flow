# 变更记录

本文件记录模板自身的演进。业务项目接入后，建议保留本文件并追加项目侧变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.4.0] - 2026-09-24

### 新增

- **技能来源准入（硬规则）**：开发本项目**只允许使用仓库内技能**——自研在 `skills/`，引入在 `.agents/skills/` 并登记 `skills-lock.json`；
  个人目录下的技能（`~/.codex/skills`、`~/.claude/skills` 等）可以用于探索，但不得作为交付依据。
- **`scripts/check-skills.mjs`**：技能来源与结构自检，规则 E601~E606——目录名、缺 `SKILL.md`、
  front-matter（`name` / `description` / 与目录名一致）、白名单之外的 `SKILL.md`、
  引用仓库外个人目录或绝对路径、`skills/README.md` 清单与目录不一致。
- 门禁接入：`npm run validate`（新增 `validate:skills`）、`.githooks/pre-commit`、`.github/workflows/standards.yml`。
- 制度层同步：`AGENTS.md` 与 `templates/project/AGENTS.md` 的硬性规则与阅读顺序、`docs/03-技能体系.md` 第五节
  （准入白名单、禁止来源、四条理由、例外与检查项）、`skills/README.md`、`docs/00-快速开始.md`（底线增至四条）、
  `docs/08-接入清单.md`（校验命令含技能检查）、`.github` 与 `.gitee` 的 PR 自查清单。
- 生成的三个 AI 工具入口（`CLAUDE.md`、`.cursor/rules/00-workflow.mdc`、`.github/copilot-instructions.md`）
  均已加入「只使用仓库内技能」这一条。

### 说明

- 引入技能的来源与哈希仍由 `node scripts/sync-agent-config.mjs --check` 校验；`check-skills.mjs` 只管「来源白名单 + 结构规范」，
  两者职责不重叠。
- 白名单之外的技能目录（例如个人工具专属的 `.claude/skills/`）会直接报错，不做静默豁免；确需例外时改脚本并走评审。

## [1.3.0] - 2026-09-24

### 新增

- **技术规范三件套**：
  `docs/13-后端规范-Java-Spring.md`（分层与依赖方向、接口契约、参数校验、异常、事务、日志、MyBatis-Plus、
  Spring Cloud 协作、缓存、并发与幂等、测试、反模式）；
  `docs/14-前端规范-Vue3.md`（目录职责、组件与 composable、Pinia、接口层、路由权限、样式、
  列表页统一模式、性能、反模式）；
  `docs/15-数据库设计与建表规范.md`（命名、必备字段、主键与类型精度、索引、DDL 变更流程、SQL 规范、
  数据安全、评审清单）。
- **建表模板与迁移目录**：`templates/project/db/建表模板.sql` 与 `db/README.md`，注入后为业务项目的 `db/`，
  规定 `V<YYYYMMDDHHmm>__<描述>.sql` 命名、脚本头部必填注释与「脚本只增不改」。
- **分支创建与 Git 实操**：`docs/05-分支提交与评审.md` 新增第三节（切分支、日常同步、rebase 与 merge 的取舍）
  与第八节（常见 Git 操作、危险操作替代方案、冲突处理原则）。
- `AGENTS.md` 与 `templates/project/AGENTS.md` 阅读顺序新增「写后端代码 / 写前端代码 / 建表改表 / 建分支提交」四行，
  硬性规则补充「表结构变更只走迁移脚本」「禁止在主干直接提交业务改动」。

### 说明

- 技术规范只写模板级共识；项目内的 `SPRING_GUIDELINES.md`、`ADMIN_GUIDELINES.md` 只补差异，不复制模板内容，避免同一事实两处维护。
- `docs/10-技术栈适配.md` 的适配表已指向新规范，并明确「模板兜底、项目细化」的顺序。

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
