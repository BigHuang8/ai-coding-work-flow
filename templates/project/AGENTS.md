# <项目名> AI 协作总纲

> 本文件是本仓库唯一的 AI 协作入口。AI 助手开始工作前必须先读本文件。
> 本文件由 hqc-ai-coding-work-flow 模板生成，接入时请完成所有 `<>` 占位内容的替换。

## 一、沟通与文档原则

- 默认中文沟通；代码、命令、路径、API 名称保持原文。
- Markdown 文档以中文为主语言，英文术语首次出现时给中文对照。
- 本文件只放「索引 + 硬性规则」，细节写在 `docs/` 与 `SPEC.md` 中。
- 文档是交付物的一部分：代码改完但文档没同步，视为未完成。

## 二、项目概览

- 项目定位：<一句话说明这个项目做什么>
- 主要用户：<谁在用>
- 技术栈：
  - 前端：<例如 Vue 3 + Vite / uni-app>
  - 后端：<例如 Spring Boot 3 + MyBatis Plus>
  - 数据库：<例如 MySQL 8.0>
- 技术栈登记：见 `docs/TECH_STACK.md`（已启用 / 装箱未启用 / 缺口三类，由 `node scripts/detect-stack.mjs` 探测）
- 模块划分（用于 `scope` 取值）：

| scope | 目录 | 说明 |
| --- | --- | --- |
| `<module>` | `<path>` | <说明> |

## 三、阅读顺序

| 任务类型 | 必读 | 按需读 |
| --- | --- | --- |
| 任意任务 | 本文件、`docs/01-工作流总览.md` | — |
| 收到 PRD / 原型 | `docs/11-需求接收与拆解.md` | `skills/requirement-intake/SKILL.md`、`spec/` 下同类需求 |
| 只有口头需求 | `skills/spec-writer/SKILL.md` | `SPEC.md` |
| 写前端代码 | `docs/14-前端规范-Vue3.md` | `docs/API_CONTRACT.md`、`docs/ADMIN_GUIDELINES.md` |
| 写后端代码 | `docs/13-后端规范-Java-Spring.md` | `docs/API_CONTRACT.md`、`SPRING_GUIDELINES.md` |
| 建表 / 改表 / 写 SQL | `docs/15-数据库设计与建表规范.md` | `db/建表模板.sql`、`db/README.md` |
| 建分支 / 提交 / 解冲突 | `docs/05-分支提交与评审.md` 第三、八节 | `skills/dual-axis-review/SKILL.md` |
| 找技能 / 引入技能 | `docs/03-技能体系.md` 第五、六节 | `skills/README.md`、`skills-lock.json` |
| 多人并行开发 | `docs/02-团队协作与角色.md` 第四节 | `node scripts/tasks.mjs` |
| 改公共代码 / 接口 / 表结构 | `docs/12-影响面与回归防护.md` | `skills/impact-analysis/SKILL.md` |
| 交付 / 上线 | `docs/06-验收与证据留档.md`、`docs/07-安全与密钥.md` | `DEPLOYMENT_GUIDE.md` |
| 技术栈与校验命令 | `docs/TECH_STACK.md`、`docs/10-技术栈适配.md` | `workflow.config.json`、`stacks/registry.json` |
| 用到的技术栈模板没规范 | `docs/10-技术栈适配.md` 第三节 | 项目 `docs/<栈>规范.md` |

## 四、文档职责边界（单一事实来源）

| 文件 | 唯一职责 |
| --- | --- |
| `AGENTS.md` | 索引与硬性规则 |
| `SPEC.md` | 需求的权威来源：要求做什么、怎么算做完 |
| `MEMORY.md` | 决策索引：为什么这么定、当前有效口径 |
| `docs/API_CONTRACT.md` | 接口契约：响应外壳、错误码、分页结构 |
| `docs/*` | 规范与操作手册 |
| `spec/<日期>-<主题>/` | 一次需求的输入留档：原件、需求条目、技术实现对照（`原始需求/`、`原型/` 只增不改） |
| `docs/verification/<日期>-<主题>/` | 验收证据 |

**同一事实只写一处。** 判断口诀：「要求做什么」写 `SPEC.md`，「为什么这么定」写 `MEMORY.md`，「怎么做」写 `docs/`，「这次改了什么、凭什么说改对了」写 `spec/` 与 `docs/verification/`。

## 五、硬性规则

### 必须

1. 动手改代码前，先说明「要改哪里、为什么、影响范围」。
2. 声称「完成 / 修好 / 通过」前，必须实际运行验证命令并给出命令与关键输出。
3. 新功能或 Bug 修复优先先写会失败的测试。
4. 接口或数据结构变更时，同步更新 `docs/API_CONTRACT.md` 与两端的类型定义。
5. 提交前运行对应模块的校验命令（见第七节）。
6. 改公共代码、接口、数据结构或配置前，先记录测试基线并反查调用方；改动后做回归验证并与基线对比。
7. 表结构变更只通过 `db/migration/V<YYYYMMDDHHmm>__<描述>.sql` 脚本进行，脚本只增不改。
8. 提交前先同步主干，按第八节检查提交信息与分支命名；不向主干强推。
9. 只使用仓库内技能：自研在 `skills/`，引入在 `.agents/skills/`；需要新能力时先引入到仓库再使用。
10. 用到的技术栈若模板没有规范，先在 `docs/TECH_STACK.md` 登记缺口并认领，再补最小规范。
11. 本项目不用的技术栈规范保持装箱：不写进阅读顺序、不进 CI、不做物理删除。

### 禁止

1. 禁止把数据库口令、API Key、Token、真实用户数据写入任何被提交的文件。
2. 禁止提交 `.env`、`*.log`、`node_modules/`、`dist/`、`target/`、IDE 本地配置。
3. 禁止未理解根因就先改代码「试试看」。
4. 禁止用 `--no-verify` 绕过 Git 钩子。
5. 禁止用放宽规则、注释测试、`@ts-ignore`、`# noqa` 之类的方式让检查通过。
6. 禁止修改与当前任务无关的文件。
7. 禁止编造未经验证的 API、命令与配置项。
8. 禁止直连生产库改表、禁止在业务代码里执行 DDL、禁止修改已执行过的迁移脚本。
9. 禁止在主干分支上直接提交业务改动。
10. 禁止调用个人目录下的技能（如 `~/.codex/skills`、`~/.claude/skills`）或临时安装来源不明的技能包。

## 六、接口契约要点

<按 docs/API_CONTRACT.md 填写，例如：>

- 统一响应外壳：`{ code, message, data, traceId }`
- 错误码：6 位数字，唯一事实来源 `<ErrorCode 文件路径>`
- 列表入参：`page` / `pageSize`；出参：`list` / `total` / `page` / `pageSize` / `pages`
- 列表页前端统一使用 `<TablePage 组件路径>` + `<useTableQuery 路径>`

## 七、命令索引

| 目的 | 命令 |
| --- | --- |
| 启动前端 | `<命令>` |
| 启动后端 | `<命令>` |
| 前端校验 | `<命令>`（应包含 lint、类型检查、规范检查） |
| 后端测试 | `<命令>` |
| 全部校验（文档 + 技能 + 技术栈） | `npm run validate` |
| 完整校验 | `npm run validate` |
| 文档自检 | `node scripts/check-docs.mjs` |
| 查看任务占用与冲突 | `node scripts/tasks.mjs`（`--check` 只看当前分支） |
| 新建需求目录 | `node scripts/new-spec.mjs --title "<主题>" --with-artifacts --with-verification` |
| 建表 / 改表脚本目录 | `db/migration/`，命名与流程见 `docs/15-数据库设计与建表规范.md` |

## 八、提交规范

格式：`type(scope): subject`

- `type`：`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- `scope`：见第二节模块划分表
- `subject`：中文，动词开头，不加句号，不超过 50 字

分支命名：`<type>/<short-desc>`，例如 `feat/<模块>-<动作>`。

## 九、冲突处理

优先级：**用户当面指令 > 本文件 > `docs/` 规范 > `skills/` 说明 > 既有代码习惯**。冲突时按高优先级执行并在回复中说明。
