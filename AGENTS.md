# 团队 AI 编码规范总纲

> 本文件是本仓库**唯一的 AI 协作入口**。任何 AI 助手（Codex / Claude Code / Cursor / Copilot）在本仓库工作前，必须先读本文件，再按「阅读顺序」按需加载文档。

## 一、沟通与文档原则

- 默认使用中文沟通；代码、命令、路径、API 名称、错误信息保持原文，不要翻译。
- 所有 Markdown 文档以中文为主语言。英文术语首次出现时给出中文对照，例如 `门禁（Gate）`。
- 本文件只承载「索引 + 硬性规则」。任何可以写进 `docs/` 的细节都不要写在这里，避免同一知识出现两处。
- **文档是交付物的一部分**：代码改完但相关文档没同步，视为任务未完成。
- 不确定的信息标注「待确认」，并写明需要谁来确认；禁止用猜测填空。

## 二、阅读顺序

按任务类型最小化加载，不要一次性读完整仓库。

| 任务类型 | 必读 | 按需读 |
| --- | --- | --- |
| 任意任务 | 本文件、`docs/01-工作流总览.md` | — |
| 收到 PRD / 原型 / 需求文档 | `docs/11-需求接收与拆解.md` | `skills/requirement-intake/SKILL.md`、`spec/` 下同类需求 |
| 只有口头需求，无正式文档 | `skills/spec-writer/SKILL.md` | `templates/project/SPEC.md` |
| 写后端代码 | `docs/13-后端规范-Java-Spring.md` | `docs/04-上下文与记忆治理.md`、`docs/API_CONTRACT.md` |
| 写前端代码 | `docs/14-前端规范-Vue3.md` | `docs/04-上下文与记忆治理.md`、`docs/ADMIN_GUIDELINES.md` |
| 建表 / 改表 / 写 SQL | `docs/15-数据库设计与建表规范.md` | `templates/project/db/建表模板.sql` |
| 改公共代码 / 接口 / 表结构 | `docs/12-影响面与回归防护.md` | `skills/impact-analysis/SKILL.md` |
| 建分支 / 提交 / 解冲突 | `docs/05-分支提交与评审.md` 第三、八节 | `docs/02-团队协作与角色.md` |
| 找技能 / 引入技能 | `docs/03-技能体系.md` 第五、六节 | `skills/README.md`、`skills-lock.json` |
| 多人并行开发 | `docs/02-团队协作与角色.md` 第四节 | `node scripts/tasks.mjs` |
| 修 Bug | `skills/flow-orchestrator/SKILL.md` 的排障路径 | `MEMORY.md` 中同类历史修复 |
| 提交 / 评审 | `docs/05-分支提交与评审.md` | `skills/dual-axis-review/SKILL.md` |
| 交付 / 上线 | `docs/06-验收与证据留档.md`、`docs/07-安全与密钥.md` | 项目部署文档 |
| 技术栈与校验命令 | `docs/10-技术栈适配.md`、`stacks/README.md` | `workflow.config.json`、`docs/TECH_STACK.md` |
| 项目用到的技术栈模板没规范 | `docs/10-技术栈适配.md` 第三节 | `stacks/registry.json`、项目 `docs/<栈>规范.md` |
| 接入一个已有项目 | `docs/08-接入清单.md`、`docs/10-技术栈适配.md` 第二节 | `node scripts/detect-stack.mjs` 的体检输出 |

## 三、文档职责边界（单一事实来源）

| 文件 | 唯一职责 | 禁止写入 |
| --- | --- | --- |
| `AGENTS.md` | 索引与硬性规则 | 业务流程细节、教程 |
| `README.md` | 项目总览与上手步骤 | 详细接口协议 |
| `SPEC.md` | **需求的权威来源**：要求做什么、验收标准是什么 | 实现细节、临时讨论 |
| `MEMORY.md` | 决策索引：为什么这么定、历史结论、当前有效口径 | 完整需求正文 |
| `docs/*` | 规范与操作手册 | 需求正文、决策记录 |
| `spec/<日期>-<主题>/` | 单次需求的输入留档：原件清单、需求条目、技术实现对照（定稿后不回改） | 结论性判断、需求的权威定义 |
| `spec/.../原始需求/`、`spec/.../原型/` | 外部交付的原件（只增不改） | 任何内部结论与技术内容 |
| `docs/verification/<日期>-<主题>/` | 验收证据：截图、命令输出、测试报告 | 需求正文 |
| `docs/plans/`、`docs/designs/` | 实现计划与设计稿留档 | 需求正文 |

口诀：**「要求做什么」写 `SPEC.md`，「为什么这么定」写 `MEMORY.md`，「怎么做」写 `docs/`，「这次改了什么、凭什么说改对了」写 `spec/` 与 `docs/verification/`。**

## 四、硬性规则

### 必须

1. 动手改代码前，先说明「要改哪里、为什么、影响范围」，等待确认或给出明确假设。
2. 声称「完成 / 修好 / 通过」之前，必须实际运行验证命令，并在回复中给出命令与关键输出。禁止只凭阅读代码下结论。
3. 新功能或 Bug 修复，优先先写会失败的测试，再写实现。
4. 接口或数据结构变更时，同步更新契约文档与两端的类型定义，保持单一来源。
5. 完成后同步更新受影响的文档：`SPEC.md`、`MEMORY.md`、`docs/`、`CHANGELOG.md` 中至少一处必须反映变更。
6. 提交前运行对应模块的校验命令（见第六节）。
7. 改公共代码、接口、数据结构或配置前，先记录测试基线并反查调用方；改动后做回归验证并与基线对比。
8. 表结构变更只通过 `db/migration/V<时间戳>__<描述>.sql` 脚本进行，脚本只增不改；已执行的脚本禁止编辑。
9. 提交前先同步主干并按 `docs/05-分支提交与评审.md` 检查分支命名与提交信息；不向主干强推。
10. 只使用仓库内技能：自研在 `skills/`，引入在 `.agents/skills/`；需要新能力时先引入到仓库（登记哈希）再使用。
11. 用到的技术栈若模板没有规范，先登记缺口并认领，再补最小规范；缺口未认领前不得凭个人偏好发明约定。
12. 本项目不用的技术栈规范保持装箱：不写进阅读顺序、不进 CI、不做物理删除。

### 禁止

1. 禁止把数据库口令、API Key、Token、真实用户数据写入任何被提交的文件（含文档、示例、注释、技能说明）。
2. 禁止提交 `.env`、`*.log`、`node_modules/`、`dist/`、`target/`、IDE 本地配置等产物。
3. 禁止在未理解根因时先改代码「试试看」；先定位，再修复。
4. 禁止用 `--no-verify` 绕过 Git 钩子。钩子失败就是失败，要么修代码，要么走 RFC 改规则。
5. 禁止为了让检查通过而放宽规则、注释掉测试、加 `@ts-ignore`、`# noqa` 之类的静默抑制。
6. 禁止修改与当前任务无关的文件（顺手重构、顺手格式化）。无关问题写进回复即可。
7. 禁止编造未经验证的 API、命令、配置项和库行为；不确定就查证或标注待确认。
8. 禁止直连生产库改表、禁止在业务代码里执行 DDL、禁止修改已执行过的迁移脚本。
9. 禁止在主干分支上直接提交业务改动；哪怕是 5 分钟的小改动也要切分支（见 `docs/05-分支提交与评审.md` 第八节）。
10. 禁止调用个人目录下的技能（`~/.codex/skills`、`~/.claude/skills`、个人 Cursor 规则等）或临时安装来源不明的技能包；禁止把外部技能正文拷进 `skills/`。

## 五、六阶段流水线与门禁

| 阶段 | 产物 | 门禁（未通过不得进入下一阶段） |
| --- | --- | --- |
| ① 需求澄清 | `spec/<日期>-<主题>/` 需求目录 + `SPEC.md` 条目 | 第三方能用自己的话复述一遍且无歧义 |
| ② 方案设计 | `docs/designs/` 设计稿 + `docs/plans/` 计划 | 明确列出改动文件、接口变化、失败回滚方式 |
| ③ 实现 | 代码 + 测试 | 新增或修改的逻辑有对应测试，且校验命令通过 |
| ④ 验证 | `docs/verification/` 证据 | 证据可被他人按文档复现 |
| ⑤ 评审 | 评审结论（通过 / 需整改） | 所有阻断项已整改并复核 |
| ⑥ 交付 | PR 说明 + 发布记录 | 回滚方案已写明 |

细节与裁剪规则见 `docs/01-工作流总览.md`。**允许裁剪**（例如一行文案修改可跳过 ②），但裁剪必须在回复中显式说明理由。

## 六、命令索引

| 目的 | 命令 |
| --- | --- |
| 安装 Git 钩子 | `bash scripts/install-hooks.sh`（Windows：`pwsh scripts/install-hooks.ps1`） |
| 文档自检 | `node scripts/check-docs.mjs` |
| 新建需求目录 | `node scripts/new-spec.mjs --title "客户列表导出" --with-artifacts --with-verification` |
| 注入到业务项目 | `node scripts/bootstrap.mjs --target ../your-project` |
| 同步多 AI 工具配置 | `node scripts/sync-agent-config.mjs` |
| 查看任务占用与冲突 | `node scripts/tasks.mjs`（`--check` 只看当前分支） |
| 模板自身校验 | `npm run validate` |

## 七、技能索引

自研技能位于 `skills/`，每个技能一个目录，入口为 `SKILL.md`：

| 技能 | 用途 |
| --- | --- |
| `flow-orchestrator` | 编排六阶段流程，判断当前处于哪一步、下一步做什么 |
| `impact-analysis` | 反查调用方、评定改动级别、记录基线与回归验证 |
| `requirement-intake` | 接收 PRD / 原型，归档原件并逐条标注技术实现 |
| `spec-writer` | 把口头需求变成可验收的 `SPEC.md` 条目与 `spec/` 留档 |
| `dual-axis-review` | 双轴评审：规范轴（是否合规）与需求轴（是否做对） |
| `evidence-driven-verification` | 用可复现的证据代替「我觉得没问题」 |

外部引入技能位于 `.agents/skills/`，来源与哈希锁定在 `skills-lock.json`。引入、升级、退役流程见 `docs/03-技能体系.md`。

## 八、提交规范

提交信息格式：`type(scope): subject`

- 允许的 `type`：`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- `scope` 使用模块名小写，例如 `customer`、`auth`、`admin`、`workflow`
- `subject` 用中文描述做了什么，不加句号，不超过 50 字

示例：

```text
feat(customer): 客户列表支持按团队筛选
fix(auth): 令牌过期后未跳转登录页
docs(workflow): 补充证据留档的目录规范
```

分支命名：`<type>/<short-desc>`，例如 `feat/customer-export`、`fix/token-refresh`。完整规则见 `docs/05-分支提交与评审.md`。

## 九、冲突处理

优先级从高到低：**用户当面指令 > 本文件 > `docs/` 规范 > `skills/` 技能说明 > 仓库既有代码习惯**。

当低优先级内容与高优先级内容冲突时，按高优先级执行，并在回复中说明冲突点，建议同步修订低优先级文件，不要静默忽略。
