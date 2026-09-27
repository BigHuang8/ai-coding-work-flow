# 工作流门禁强化 实施计划

- 关联设计：`docs/designs/20260927-workflow-gates-设计.md`
- 执行人 / 日期：Codex / 2026-09-27
- 预计工作量：半天

## 任务拆分

| # | 任务 | 产出文件 | 完成判据 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 统一版本并新增版本检查 | `package.json`、`README.md`、`scripts/check-version.mjs` | 三处版本一致，错误版本能返回非零 | 已完成 |
| 2 | 增加核心脚本冒烟测试 | `scripts/tests/workflow-gates.test.mjs`、`package.json` | `npm test` 通过，覆盖正常与失败路径 | 已完成 |
| 3 | 修复 hook 降级路径 | `.githooks/pre-commit`、`.githooks/pre-push` | 无 `bash` 分支也执行 AI 入口检查 | 已完成 |
| 4 | 增加接入占位符检查 | `scripts/check-placeholders.mjs`、`package.json` | 模板仓库通过，目标项目残留占位符时失败 | 已完成 |
| 5 | 同步文档与 CI 说明 | `CHANGELOG.md`、平台 CI 模板、设计与计划、`docs/verification/20260927-workflow-gates/` | 文档自检和平台一致性检查通过 | 已完成 |

## 执行顺序与依赖

先完成 1，再完成 2；3、4 可在 1 后并行实现；5 在所有代码改动完成后统一更新。所有任务共享 `npm run validate` 作为最终门禁。

## 验证计划

| 验收标准 | 验证方式 | 证据形式 |
| --- | --- | --- |
| 版本不再漂移 | `npm run validate:version`、测试中的失败样例 | 命令输出 |
| 核心脚本有回归保护 | `npm test` | Node test 原始输出 |
| hook 降级路径完整 | 静态检查两个 hook，并运行脚本测试 | 命令输出 |
| 接入项目占位符可拦截 | 测试临时目标项目 | Node test 原始输出 |
| 仓库整体门禁通过 | `npm run validate` | 完整命令输出 |

## 检查点

- 版本检查和测试加入 `package.json` 后先运行 `npm test`。
- 占位符检查加入统一校验前，确认模板源目录不会被扫描。
- 最终按规范轴检查改动文件，确认没有修改业务无关文件。

## 收尾事项

- [x] 更新 `CHANGELOG.md`
- [x] 更新设计与计划状态
- [x] 运行 `npm test`、`npm run validate`
- [x] 记录验证命令与关键输出
- [ ] 保留分支供评审，合并后按仓库规则删除
