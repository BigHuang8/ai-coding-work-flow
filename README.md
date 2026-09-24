# hqc-ai-coding-work-flow

面向团队协作的 AI 编码工作流模板：把「需求 → 设计 → 实现 → 验证 → 评审 → 交付」固化成可执行的规范、技能和脚本。

本仓库同时扮演两个角色：

- **方法论**：`docs/` 说明为什么这么约定，以及团队怎么落地。
- **工程骨架**：`skills/`、`scripts/`、`.githooks/`、`.github/`、`templates/` 可以直接复制或一键注入到任意业务项目。

---

## 一、它解决什么问题

| 典型问题 | 本模板的应对 |
| --- | --- |
| 每个人用 AI 的方式不同，产出质量方差大 | 六阶段流水线 + 阶段门禁，见 [工作流总览](docs/01-工作流总览.md) |
| 需求与决策散落在聊天记录里，事后无法追溯 | `spec/` 按日期留档需求、`MEMORY.md` 记录决策、`docs/verification/` 留存验收证据 |
| AI 说「改好了」，但没人真正验证过 | 强制「先跑命令、贴原始输出，再下结论」，见 [验收与证据留档](docs/06-验收与证据留档.md) |
| 外部技能版本漂移，昨天能跑今天不能跑 | `skills-lock.json` 锁定来源与哈希，见 [技能体系](docs/03-技能体系.md) |
| 数据库口令、API Key 被写进文档并提交 | 密钥零入库 + 提交前扫描，见 [安全与密钥](docs/07-安全与密钥.md) |
| 规范只写在文档里，没人执行 | `.githooks/` 与 `.github/workflows/` 把规范变成「失败即阻断」的检查 |
| 新人不知道从哪读起 | [快速开始](docs/00-快速开始.md) + [接入清单](docs/08-接入清单.md) |

## 二、三层治理模型

| 层 | 回答的问题 | 载体 | 变更方式 |
| --- | --- | --- | --- |
| 制度层 | 团队约定是什么 | `AGENTS.md`、`docs/`、`templates/` | 低频，走 RFC 讨论 |
| 能力层 | AI 用什么把事情做成 | `skills/`（自研）、`.agents/skills/`（引入） | 中频，走技能共建流程 |
| 执行层 | 约定怎么被强制执行 | `.githooks/`、`scripts/`、`.github/workflows/` | 中频，走 PR 评审 |

核心原则：**同一事实只写一处**。制度层负责定义，能力层负责消费，执行层负责校验，三者不得互相复制正文内容，只能引用。

## 三、六阶段流水线

```text
① 需求澄清  →  ② 方案设计  →  ③ 实现    →  ④ 验证    →  ⑤ 评审    →  ⑥ 交付
   产物 spec     产物 计划       产物 代码    产物 证据    产物 结论    产物 记录
   门禁 复述     门禁 评审       门禁 测试    门禁 复现    门禁 整改    门禁 回滚
```

每阶段的输入、输出、门禁，以及「什么情况下才算完成」，见 [工作流总览](docs/01-工作流总览.md)。

## 四、目录结构

```text
.
├── AGENTS.md                  AI 协作总纲：唯一入口，只放索引与硬性规则
├── README.md                  本文件：总览与上手
├── CHANGELOG.md               模板自身的版本变更
├── .gitignore / .gitattributes 忽略规则与换行符统一
├── .editorconfig              跨编辑器的基础格式约定
├── .githooks/                 本地提交门禁（commit-msg / pre-commit / pre-push）
├── .github/                   PR 模板、CODEOWNERS、CI 工作流
├── .gitee/                    Gitee 平台 PR 模板（与 .github 内容保持一致）
├── docs/                      工作流文档（中文，按编号排序阅读）
│   └── verification/          验收证据留档（按需求建子目录）
├── skills/                    自研技能：团队自己的流程能力
├── scripts/                   可执行工具：安装钩子、注入模板、文档校验、需求建档
├── templates/project/         注入到业务项目的文件模板
├── skills-lock.json           外部引入技能的来源与哈希锁定
└── （生成文件）                CLAUDE.md、.cursor/rules/、.github/copilot-instructions.md
```

最后一行是自动生成的：`AGENTS.md` 是唯一事实来源，`node scripts/sync-agent-config.mjs` 负责为 Claude Code、Cursor、Copilot 生成指向它的入口，避免多套规范各自漂移。

## 五、五分钟上手

```bash
# 1. 获取模板
git clone https://gitee.com/hqc__com/hqc-ai-coding-work-flow.git
cd hqc-ai-coding-work-flow

# 2. 安装 Git 钩子（Windows 用 PowerShell 版本）
bash scripts/install-hooks.sh
# pwsh scripts/install-hooks.ps1

# 3. 自检：检查文档语言、链接与命名是否合规
node scripts/check-docs.mjs

# 4. 看看工作流怎么用
cat docs/00-快速开始.md
```

## 六、接入业务项目

```bash
# 预览将要写入的文件，不实际改动
node scripts/bootstrap.mjs --target ../your-project --dry-run

# 实际注入（已存在的文件默认跳过，不会覆盖）
node scripts/bootstrap.mjs --target ../your-project

# 指定技术栈，跳过不相关的配置
node scripts/bootstrap.mjs --target ../your-project --stack java-springboot,vue3
```

接入后请按 [接入清单](docs/08-接入清单.md) 逐项完成定制，尤其是 `AGENTS.md` 的技术栈章节和 `CODEOWNERS` 的负责人。

## 七、文档地图

| 文档 | 什么时候读 |
| --- | --- |
| [00-快速开始](docs/00-快速开始.md) | 第一次接触本模板 |
| [01-工作流总览](docs/01-工作流总览.md) | 想知道一次任务该怎么走 |
| [02-团队协作与角色](docs/02-团队协作与角色.md) | 想知道自己该做什么、谁该评审 |
| [03-技能体系](docs/03-技能体系.md) | 想新增、引入或改造技能 |
| [04-上下文与记忆治理](docs/04-上下文与记忆治理.md) | 想知道信息该写进哪个文件 |
| [05-分支提交与评审](docs/05-分支提交与评审.md) | 准备提交代码或发起 PR |
| [06-验收与证据留档](docs/06-验收与证据留档.md) | 准备说「做完了」 |
| [07-安全与密钥](docs/07-安全与密钥.md) | 涉及配置、密钥、生产环境 |
| [08-接入清单](docs/08-接入清单.md) | 要把模板落到一个真实项目 |
| [09-常见问题](docs/09-常见问题.md) | 流程卡住了 |
| [10-技术栈适配](docs/10-技术栈适配.md) | 项目不是 Vue / Java，需要换适配 |
| [11-需求接收与拆解](docs/11-需求接收与拆解.md) | 收到 PRD 和原型图，不知道原件放哪、技术实现写哪 |

## 八、维护与版本

- 模板遵循语义化版本，变更记录见 `CHANGELOG.md`。
- 制度层变更需要至少一名维护者复核；能力层与执行层变更需要一名使用方代表复核。
- 建议每季度回顾一次：哪些门禁从未拦下过问题（可删）、哪些问题反复绕过流程（要补门禁）。

---

**模板版本**：1.0.0
**维护者**：hqc 团队
**最后更新**：2026-09-24
