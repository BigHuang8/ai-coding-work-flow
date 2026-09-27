# 变更记录

本文件记录模板自身的演进。业务项目接入后，建议保留本文件并追加项目侧变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.11.4] - 2026-09-27

### 修复

- 统一 `package.json`、README 与 CHANGELOG 的模板版本，并新增版本一致性门禁。
- 为 `bootstrap`、版本检查和接入占位符检查增加 Node 内置回归测试。
- 修复无 `bash` 环境下 Git hooks 漏跑 AI 入口同步检查的问题。
- 接入项目残留默认 `CODEOWNERS` 负责人或基础文档占位符时，统一校验会阻断提交。

## [1.11.3] - 2026-09-24

### 文档

- 说明 GitLab 合并请求模板为何叫 `Default.md`：GitLab 用**文件名当模板名**（显示在新建合并请求的「Choose a template」
  下拉框里），命名为 `Default`（大小写不敏感）的那份才会自动套用；要加模板另建 `<名字>.md` 放进
  `.gitlab/merge_request_templates/` 即可。说明同时写进 `docs/05-分支提交与评审.md` 与该模板文件顶部注释。

## [1.11.2] - 2026-09-24

### 变更

- **模板仓库根目录不再保留平台配置与多余的 AI 入口**：删除 `.gitee/`、`.github/`、`.cursor/`，
  根目录新增 `workflow.config.json`（`"aiEntries": ["claude"]`，只生成 `CLAUDE.md`）。
  GitHub / GitLab / Gitee 三套平台产物仍旧只在 `templates/platform/` 维护，按业务项目的托管平台注入，
  本仓库自己不再留一份副本；`sync-platform.mjs` 只在根副本已存在时才比对，删了不会自己长回来。

### 文档

- `README.md` 目录树与生成物说明、`docs/08-接入清单.md` 常见坑、`docs/09-常见问题.md` 第十八、十九节、
  `templates/platform/README.md` 同步改写：把「本仓库自己也要留一份根副本」的说法换成「按需恢复」。

## [1.11.1] - 2026-09-24

### 修复

- **`assets/secrets.png` 与其 HTML 源从未入库**：`.gitignore` 的 `secrets.*` 规则把这两个文件一并忽略了，
  本地一直存在所以校验全绿，但全新克隆既看不到配图、`npm run validate` 还会报 E201 断链
  （`README.md`、`docs/07-安全与密钥.md`、`assets/README.md` 都引用了该图）。已补
  `!assets/secrets.png`、`!assets/src/secrets.html` 例外并入库。
- 新增 **E308 门禁**：文档引用的文件被 `.gitignore` 忽略时报错，专治这类「本地有、克隆没有」的引用；
  判定用一次 `git check-ignore --stdin` 批量完成（逐条起 git 进程在 Windows 上要 0.5 秒，链接多了会拖垮 pre-commit）。
- E704 声明比对收窄到 bootstrap 生成的配置（带 `template` 标记）：手写的极简 `workflow.config.json`
  （例如模板仓库自身只写 `aiEntries`）不再被误报「未声明技术栈」；业务项目的比对行为不变。

### 文档

- `docs/09-常见问题.md` 新增第十九节：模板仓库根目录 `.gitee/` 与 `.github/` 各是什么、要不要保留、怎么删。

## [1.11.0] - 2026-09-24

### 新增

- **AI 工具入口可开关**：`workflow.config.json` 新增 `aiEntries` 字段（默认 `["claude", "cursor", "copilot"]`），
  决定 `sync-agent-config.mjs` 生成哪些入口。团队不用的工具去掉即可，项目里不再留下用不到的目录——
  典型场景是 Gitee / GitLab 项目不用 Copilot，却因为固定路径 `.github/copilot-instructions.md` 平白多出一个 `.github/`。
  停用后文件仍在时会提示删除；清单常量集中在 `scripts/lib/ai-entries.mjs`，两个脚本共用一份。

### 变更

- `bootstrap` 不再直接注入 `.github/copilot-instructions.md`：AI 入口统一由 `sync-agent-config.mjs` 生成，
  同一份产物不再有「静态复制 + 生成」两个来源；`--update` 与重跑都会保留目标项目 `aiEntries` 的设置。
  预览模式会明确说明将生成哪些入口（dry-run 不再谎报会创建一个实际由生成器产出的文件）。

## [1.10.0] - 2026-09-24

### 变更

- **平台产物统一收进 `templates/platform/`**：GitHub 那套（`.github/workflows/`、`.github/CODEOWNERS`、
  `.github/PULL_REQUEST_TEMPLATE.md`）从仓库根移入 `templates/platform/github/`，Gitee 新增 `templates/platform/gitee/`，
  与既有的 `templates/platform/gitlab/` 三平台对称。**目录内的相对路径就是注入到项目里的位置**，约定见 `templates/platform/README.md`。
  原先根目录 `.github/` 里放着 CI、CODEOWNERS 与 PR 模板，但本仓库只有 Gitee 远程——那是永不执行的死配置，
  现在根目录只保留生成的 `copilot-instructions.md`（Copilot 插件的固定路径，与托管平台无关）。
- `bootstrap` 支持三平台：新增 `gitee`；探测改为「文件标记 + `origin` 地址交叉判断」，冲突时以 origin 为准并在输出里点名；
  只有文件标记时按 GitLab → Gitee → GitHub 取第一个，都没有时默认 GitLab；`--platform` 传未知值改为回退自动探测。
  接入提示第 4 条按平台给出代码所有者配置方式（Gitee 不支持 CODEOWNERS）。

### 新增

- **`scripts/sync-platform.mjs`**：平台产物一致性门禁。仓库根的平台副本（本仓库是 `.gitee/PULL_REQUEST_TEMPLATE.md`）
  由它从 `templates/platform/` 生成，`--check`（E801）已接进 `npm run validate`、`validate:platform`
  与两个 Git 钩子的降级分支；规则是**只刷新根目录已存在的同名文件**，不主动新建。
  业务项目里没有模板源，比对自动跳过（退出码 0）；但模板仓库缺 `templates/platform/` 会报 E802 拦下。
- 融合清单新增 `.gitee`（合并请求模板）与 `.workflow`（Gitee Go 流水线）两类已有约定的合并方式。
- **新增 E307 门禁**：会注入业务项目的共享文档（`docs/`、`skills/`、`stacks/`、`spec/`、`db/`、根级 `AGENTS.md` 等）
  不得链接到 `templates/`、根 `README.md`、`CHANGELOG.md` 或仓库外路径——这些路径在业务项目里不存在，
  而在模板仓库里能通过校验，属于「接入后才炸」的隐形断链（`stacks/README.md`、`docs/08-接入清单.md` 都踩过）。

### 文档

- `README.md` 目录树与平台段落、`docs/08-接入清单.md`（三平台表、五步探测规则、步骤 4 校验命令、步骤 7 CI 配置）、
  `docs/09-常见问题.md` 第十八节、`docs/02`、`docs/05`、`docs/10` 同步改为三平台表述。

## [1.9.0] - 2026-09-24

### 新增

- **GitLab 平台产物**：新增 `templates/platform/gitlab/`，提供 `.gitlab-ci.yml`（`standards` / `commit-message` / `docs-guard` 三个 job，
  job 名保持英文以规避 GitLab 对非 ASCII 名称的兼容问题）、仓库根 `CODEOWNERS`、`.gitlab/merge_request_templates/Default.md`，
  与 `.github/` 那套等价，按平台二选一注入。
- **`bootstrap` 新增 `--platform github|gitlab|auto`**：自动探测顺序为「命令行指定 → 已有 `.gitlab-ci.yml` / `.gitlab/` →
  已有 `.github/workflows/` / `.github/CODEOWNERS` → 远程地址含 gitlab / github」，都识别不出时默认 GitLab（企业内网最常见），
  结果写入 `workflow.config.json` 的 `platform` 字段并在输出中打印判定依据。

### 变更

- `--update` 不再覆盖平台产物（CI 配置、`CODEOWNERS`、合并请求模板）：这些文件团队必然会改，覆盖会丢内容。
- `.github/copilot-instructions.md` 脱离平台条目单独托管：它是 Copilot 插件的固定路径，与代码托管平台无关。
- 去 GitHub 耦合：`README.md`、`docs/02-团队协作与角色.md`、`docs/05-分支提交与评审.md`、`docs/08-接入清单.md`、`docs/09-常见问题.md`
  统一表述为「合并请求（GitHub 叫 PR，GitLab 叫 MR）」，`CODEOWNERS` 路径区分为两平台，并新增 GitLab 专项 FAQ（第九篇第十八节）。
- `stacks/README.md` 的「README 文档地图」改为纯文本：项目未必有根 `README.md`，保留链接会让接入后首次校验报断链。

## [1.8.0] - 2026-09-24

### 新增

- **三张质量闸门配图**，与前七张风格一致：
  `dual-axis-review.png`（评审看什么：规范轴、需求轴、结论格式、反模式）、
  `evidence.png`（怎么证明真的做完了：三条标准、留档位置、证据类型、基线对比、未覆盖项）、
  `secrets.png`（哪些东西永远别提交：零入库清单、配置放哪、提交前三问、泄漏应急、AI 边界）。

### 变更

- `README.md` 新增「六、三道质量闸门」一节并接入三张配图，原六至十一节顺延为七至十二节；版本号 1.8.0。
- `assets/README.md` 清单补三行并同步修正章节号，共十张图、约 2.1 MB。
- `docs/05-分支提交与评审.md`、`docs/06-验收与证据留档.md`、`docs/07-安全与密钥.md` 各加一行配图索引。

## [1.7.0] - 2026-09-24

### 新增

- **三张新配图**，风格与此前四张一致：
  `onboarding.png`（接入一个已有项目的六步：体检、预览、注入、融合清单、认领缺口、验收）、
  `stack-fit.png`（技术栈三类清单：已启用 / 装箱未启用 / 缺口）、
  `gap-process.png`（缺口补规范五步：认领、写最小规范、登记临时、接门禁、转正）。

### 变更

- `README.md` 新增「九、技术栈对不上怎么办」一节并接入两张配图，第八节接入配图；
  原九、十节顺延为十、十一节。
- `assets/README.md` 清单补充三张新图，并说明配图同时充当验收入口的可视化。

## [1.6.0] - 2026-09-24

### 新增

- **技术栈登记表 `stacks/registry.json`**：把「模板已覆盖的栈」与「已知但未覆盖的栈」分开登记，
  每个栈带能力位（`slot`）、规范文档、校验命令与探测规则；字段说明见 `stacks/README.md`。
- **`scripts/detect-stack.mjs`**：技术栈探测与自检。把项目用到的栈分成三类——已启用、装箱未启用、缺口；
  支持 `--check`（登记表结构 + 规范到位 + 缺口认领 + 配置一致性）、`--strict`（缺口判失败）、`--json`。
- **`scripts/lib/stacks.mjs`**：探测引擎与项目侧 `docs/TECH_STACK.md` 的生成逻辑，供探测与接入脚本共用。
- **接入体检与融合清单**：`bootstrap.mjs` 默认自动探测技术栈（`--stack auto`），生成 `docs/TECH_STACK.md`
  与更完整的 `workflow.config.json`（含 `availableStacks`、`stackGaps`），并把项目已有的 AI 入口、CI、
  钩子框架、`validate` 命令列成融合清单，逐项给出合并方式。

### 变更

- **`docs/10-技术栈适配.md` 重写**：补齐两个方向的出口——项目有、模板没有时走「补规范」五步
  （含最小规范四要素、骨架示例、`provisional` 登记与转正标准）；模板有、项目没有时「装箱不启用」
  （不注入、不进阅读顺序、不进 CI、不物理删除）。新增能力位模型、无缝接入规则与严格模式切换时机。
- **`docs/08-接入清单.md`**：新增「步骤 0：接入体检」，步骤 1 补充融合清单处理，完成标志与常见坑同步扩充。
- **`scripts/sync-agent-config.mjs`**：生成的 AI 入口文件加入生成标记；遇到没有标记的同名文件
  （项目自有的 `CLAUDE.md` 等）默认**跳过并提示**，不再静默覆盖，只有 `--force` 才会覆盖。
  v1.6 之前生成的文件按首行特征识别，老项目升级不会被误判成自有文件。
- **`scripts/bootstrap.mjs`**：`--stack` 默认改为 `auto`（自动探测），支持 `none` 与显式指定；注入清单新增 `stacks/`。
- `npm run validate` 增加技术栈自检，`.github/workflows/standards.yml` 同步增加对应步骤。
- 制度层同步：`AGENTS.md` 与 `templates/project/AGENTS.md` 的阅读顺序与硬性规则增加「缺口先认领」「装箱不启用」两条。

### 说明

- 缺口在接入期按警告处理，稳定后切 `--strict` 写进流水线；建议接入满一个月后切换。
- 技术栈规范的单一事实来源仍是 `docs/`；`stacks/` 只回答「有哪些栈、规范在哪、命令是什么」。

## [1.5.0] - 2026-09-24

### 新增

- **流程信息图**：`assets/` 新增四张白板手绘风格配图，并在 README 对应章节展示——
  `workflow-overview.png`（六阶段流水线）、`governance-layers.png`（三层治理模型）、
  `parallel-dev.png`（多人并行：谁在开发、是否撞车、撞了怎么办、会不会弄坏老功能）、
  `tech-standards.png`（写代码的规矩：后端、前端、数据库、提交）。
- **`scripts/build-posters.mjs`**：把 `assets/src/*.html` 渲染为 PNG 的导出脚本。支持 `--check-only`
  排版自检（正文溢出条带或压到右侧标签框即失败并返回非 0）、`--width`、`--scale`、`--no-compress`；
  `playwright` 为必需依赖、`sharp` 为可选压缩依赖，缺失时给出安装提示，不影响 `npm run validate` 的其余门禁。
- **`assets/README.md`**：图片清单、风格约定、再生成步骤与维护约定。

### 变更

- `README.md`：新增「四、多人并行怎么不打架」与「五、写代码的规矩」两节并接入四张配图，
  原四至八节顺延为六至十节；目录结构补充 `assets/`。
- `.gitattributes`：`assets/**` 标记为 `linguist-documentation`，不计入仓库语言统计。

### 说明

- 图片只是文档的可视化摘要，不是事实来源；两者冲突时以 `docs/` 正文为准。
- PNG 采用 128 色调色板压缩，四张合计约 820 KB。

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
