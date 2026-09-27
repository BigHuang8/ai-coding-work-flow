# 工作流门禁强化 设计

- 关联需求：本次维护任务（用户要求优化工作流项目）
- 作者 / 日期：Codex / 2026-09-27

## 现状

仓库已有文档、技能、技术栈、AI 入口和平台产物自检，但仍有几处可执行性缺口：

- `package.json`、README 与 CHANGELOG 的模板版本不一致；
- 核心脚本没有独立回归测试，`npm run validate` 只能证明当前仓库静态状态正确；
- Git hooks 在没有 `bash` 的降级分支遗漏 AI 入口同步检查；
- 注入到业务项目的 `CODEOWNERS` 和基础文档占位内容没有自动拦截。

## 目标与约束

- 目标：让版本事实只有一个有效口径；为核心脚本增加无需外部依赖的可重复测试；补齐降级路径的门禁；在业务项目接入后拦截未替换的关键占位符。
- 约束：不改变六阶段流程、需求目录结构、平台注入策略和已有项目的非覆盖原则；不引入新的运行时依赖；不把业务项目测试命令硬编码进模板仓库。

## 方案

1. 新增 `scripts/check-version.mjs`，在模板仓库中读取 `package.json`、README 的模板版本和 CHANGELOG 最新版本，三者不一致即失败；脚本被复制到业务项目后明确跳过模板专属校验，并接入 `npm run validate`。
2. 新增 Node 内置 `node:test` 测试，覆盖版本检查、业务项目跳过模板专属版本检查和 bootstrap 的平台选择；测试不依赖 npm 包安装。
3. 把 `sync-agent-config.mjs --check` 补入两个 hook 的无 `bash` 降级路径。
4. 新增 `scripts/check-placeholders.mjs`，只扫描接入项目中的可定制文件；模板源目录不参与扫描，避免误报示例占位符。
5. 把版本与门禁变更记录到 CHANGELOG，并保持 CI 继续调用统一的 `npm run validate`。

## 改动清单

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `scripts/check-version.mjs` | 模板版本一致性检查 |
| 新增 | `scripts/check-placeholders.mjs` | 接入项目关键占位符检查 |
| 新增 | `scripts/tests/workflow-gates.test.mjs` | 核心门禁与 bootstrap 冒烟测试 |
| 新增 | `docs/designs/20260927-workflow-gates-设计.md` | 本设计稿 |
| 新增 | `docs/plans/20260927-workflow-gates-计划.md` | 实施计划 |
| 修改 | `package.json` | 版本统一、增加测试与门禁命令 |
| 修改 | `README.md` | 模板版本更新 |
| 修改 | `CHANGELOG.md` | 记录本次门禁强化 |
| 修改 | `scripts/bootstrap.mjs` | 业务项目不继承模板仓库专属测试命令 |
| 修改 | `.githooks/pre-commit` | 无 `bash` 路径补齐 AI 入口检查 |
| 修改 | `.githooks/pre-push` | 无 `bash` 路径补齐 AI 入口检查 |
| 修改 | `docs/08-接入清单.md`、`docs/09-常见问题.md` | 同步新命令、占位符检查和 hook 行为 |
| 新增 | `docs/verification/20260927-workflow-gates/` | 验收报告与命令证据 |
| 修改 | `templates/platform/github/.github/workflows/standards.yml` | 明确新增门禁由统一校验执行 |
| 修改 | `templates/platform/gitlab/.gitlab-ci.yml` | 同步统一校验说明 |

## 接口与数据结构变化

无业务接口、数据库结构或外部 API 变化。新增命令：

- `npm test`
- `npm run validate:version`
- `npm run validate:placeholders`

## 数据迁移

无。

## 风险评估

| 风险 | 概率 | 影响 | 应对 |
| --- | --- | --- | --- |
| 版本格式在未来再次漂移 | 中 | 发布信息不可信 | 将一致性检查纳入 `npm run validate` |
| 占位符检查误报文档示例 | 低 | 接入项目无法通过门禁 | 只扫描 `AGENTS.md`、`SPEC.md`、`MEMORY.md`、`CODEOWNERS` 等可定制文件 |
| 冒烟测试在 Windows / Linux 行为不一致 | 低 | CI 与本地结果不同 | 使用 Node 内置 API、路径解析和当前 Node 20 CI |

## 回滚方式

在该分支执行 `git revert <本次提交>`，或恢复以下文件后重新运行 `npm run validate`：新增的两个检查脚本、测试文件、package.json、README.md、CHANGELOG.md、两个 hook 和两套平台 CI 模板。无数据迁移，无运行时回滚步骤。
