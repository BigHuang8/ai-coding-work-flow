# 平台产物

业务项目的 CI、代码所有者、合并请求模板，各平台的路径与语法都不同。这里按平台分目录存放，
`scripts/bootstrap.mjs` 探测出项目托管在哪个平台后，**只注入对应目录里的那一套**，不会让两种平台的配置同时躺在项目里。

## 一、目录约定

**目录内的相对路径 = 注入到项目里的相对路径**，不做额外映射，看路径就知道文件会落在哪：

| 模板里的路径 | 注入到业务项目后 |
| --- | --- |
| `github/.github/workflows/standards.yml` | `.github/workflows/standards.yml` |
| `github/.github/CODEOWNERS` | `.github/CODEOWNERS` |
| `gitlab/.gitlab-ci.yml` | `.gitlab-ci.yml` |
| `gitlab/CODEOWNERS` | `CODEOWNERS` |
| `gitlab/.gitlab/merge_request_templates/Default.md` | `.gitlab/merge_request_templates/Default.md` |
| `gitee/.gitee/PULL_REQUEST_TEMPLATE.md` | `.gitee/PULL_REQUEST_TEMPLATE.md` |

本目录下的 `README.md` 是说明文件，不参与注入，也不参与根副本比对。

## 二、三个平台各给什么

| 平台 | CI | 代码所有者 | 合并请求模板 |
| --- | --- | --- | --- |
| GitHub | `.github/workflows/` | `.github/CODEOWNERS` | `.github/PULL_REQUEST_TEMPLATE.md` |
| GitLab | `.gitlab-ci.yml` | 仓库根 `CODEOWNERS` | `.gitlab/merge_request_templates/Default.md` |
| Gitee | 不提供文件：Gitee Go 的流水线定义随产品版本变化，写在网页端更可靠，接入时按 [接入清单](../../docs/08-接入清单.md) 步骤 7 配置 | Gitee 不支持 CODEOWNERS，用仓库设置的评审人 | `.gitee/PULL_REQUEST_TEMPLATE.md` |

三个平台的合并请求模板内容一致，只是落地路径不同；改了其中一个，另外两个要一起改。

## 三、本仓库自己的根副本

本仓库托管在 Gitee，根目录的 `.gitee/` 既是本仓库自己的合并请求模板，也是 Gitee 平台的注入源。
这类「根副本」由 `node scripts/sync-platform.mjs` 从本目录生成并校验，`--check` 已接进门禁，两处不会各自漂移。

规则是**只刷新根目录已存在的同名文件**，不主动新建：本仓库没有 GitHub 远程，根目录就不该出现 `.github/workflows/`。
`.github/copilot-instructions.md` 是 AI 工具入口（由 `AGENTS.md` 生成），不属于平台产物，不受这套规则影响；
不用 Copilot 的项目可以在 `workflow.config.json` 的 `aiEntries` 里去掉它，`templates/` 这边无需改动。
