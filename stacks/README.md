# 技术栈登记表

`registry.json` 是本模板的**技术栈清单**：模板已经写过规范的栈、以及已知但还没写规范的栈，都登记在这里。

它是脚本与人共用的单一事实来源：`scripts/detect-stack.mjs` 用它判断「项目用了哪些栈、哪些有规范、哪些缺规范」，
`scripts/bootstrap.mjs` 用它生成项目侧的 `docs/TECH_STACK.md`，并决定注入哪些规范文档。

流程规范（`docs/00` 到 `docs/12`）与技术栈无关，永远适用；技术栈规范（`docs/13` 起）按栈装配，不做全量启用。

## 一、两个清单与三种状态

| 清单 | 含义 | 对应状态 |
| --- | --- | --- |
| `stacks[]` | 模板已覆盖的栈，有规范文档与校验命令 | `built-in`：可直接使用；`provisional`：规范待补，先临时用 |
| `catalog[]` | 已知但**没有**规范的栈（React、Go、.NET、PostgreSQL 等） | `not-covered`：项目一旦用上就是缺口，要走补规范流程 |

探测结果分三类，脚本输出与 `docs/TECH_STACK.md` 都用这套口径：

| 分类 | 含义 | 处理方式 |
| --- | --- | --- |
| 已启用 | 项目用到，模板有规范 | 规范进阅读顺序，校验命令进 `npm run validate` |
| 装箱未启用 | 模板有规范，项目没用到 | 不注入、不写进阅读顺序、不进 CI；规范留在仓库里备用 |
| 缺口 | 项目用到，模板没规范 | 走 [技术栈适配](../docs/10-技术栈适配.md) 第三节的补规范流程 |

## 二、字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 小写短横线标识，命令行 `--stack` 用它，例如 `java-springboot` |
| `name` | 是 | 人读名称，出现在报告与项目侧登记表里 |
| `slot` | 是 | 能力位，取值见 `slots`：一个项目里同一能力位可以有多个实现 |
| `status` | `stacks` 必填 | `built-in` 或 `provisional` |
| `always` | 否 | 为 `true` 时无条件启用（`node-tooling` 用它，因为所有项目都要跑 Node 脚本） |
| `guidelines` | `stacks` 必填 | 规范文档的相对路径，可多个 |
| `validate` | `stacks` 必填 | 该栈的校验命令，供 `npm run validate` 聚合 |
| `detect.files` | 否 | 探测规则：`**/文件名` 按任意层级匹配；`**/*.后缀` 按后缀匹配；其他按精确相对路径匹配 |
| `detect.packageDeps` | 否 | 命中 `package.json` 的依赖名即算使用该栈 |
| `detect.pomKeywords` | 否 | 在 `pom.xml` / `build.gradle` 文本中出现的关键字 |
| `manifests` | — | 兜底表：出现这些构建文件但不在任何栈里，报告为「未登记」，提示补登记 |

## 三、怎么新增一个栈

模板侧（维护者）：

1. 在 `docs/` 下写规范文档，编号顺延，例如 `docs/16-后端规范-Go.md`；四要素见
   [技术栈适配](../docs/10-技术栈适配.md) 第三节。
2. 在 `stacks/registry.json` 的 `stacks[]` 追加一条，填好 `guidelines` 与 `validate`。
3. 跑 `node scripts/detect-stack.mjs --check` 确认登记表结构与规范路径都有效。
4. 在根 `README.md`（文档地图）补一行，并更新 `CHANGELOG.md`。
   注：这里不写成相对链接——项目侧可能还没有 `README.md`，链接会变成断链被门禁拦下。

项目侧（临时缺口，`provisional`）：

1. 复制 [技术栈适配](../docs/10-技术栈适配.md) 第三节的最小规范四要素，写进项目自己的 `docs/`。
2. 在项目 `stacks/registry.json` 追加一条 `status: "provisional"` 的条目，或先在 `workflow.config.json` 的
   `stackGaps` 里登记。
3. 补齐后按上面的模板侧流程转正，避免长期停留在临时状态。

## 四、相关命令

```bash
node scripts/detect-stack.mjs             # 探测当前项目，输出三类清单
node scripts/detect-stack.mjs --check     # 接入或流水线用：结构校验 + 缺口检查
node scripts/detect-stack.mjs --strict    # 缺口也算失败，接入稳定后建议打开
node scripts/detect-stack.mjs --json      # 机器可读，供其他脚本消费
```
