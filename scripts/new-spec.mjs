#!/usr/bin/env node
/**
 * 需求建档生成器
 *
 * 生成 spec/<YYYYMMDD>-<主题>/ 目录，承载一次需求的全部输入与拆解：
 *   需求与技术对照.md   来源元信息、原始描述、需求条目、技术实现对照
 *   原始需求/           PRD 原件（docx / pdf / xlsx / md），只增不改
 *   原型/               原型导出或截图，只增不改
 *
 * 用法：
 *   node scripts/new-spec.mjs --title "客户列表团队筛选"
 *   node scripts/new-spec.mjs --title "客户列表团队筛选" --with-artifacts
 *   node scripts/new-spec.mjs --title "登录改造" --with-artifacts --with-verification
 *   node scripts/new-spec.mjs --title "临时需求" --dry-run
 *
 * 流程说明见 docs/11-需求接收与拆解.md
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { title: '', dryRun: false, withArtifacts: false, withVerification: false, date: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--title') options.title = argv[++i] ?? '';
    else if (arg === '--date') options.date = argv[++i] ?? '';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--with-artifacts') options.withArtifacts = true;
    else if (arg === '--with-verification') options.withVerification = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) {
      console.error(`未知参数：${arg}`);
      process.exit(1);
    } else if (!options.title) {
      options.title = arg;
    }
  }
  return options;
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function sanitize(name) {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/, '');
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function readableDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function mainDocTemplate(title, date) {
  const readable = readableDate(date);
  return `# ${title}：需求与技术对照

> 本文件是一次需求的主文档。**外部原件（PRD、原型）不修改**，技术实现统一记录在本文件的对照表里。
> 流程说明见 \`docs/11-需求接收与拆解.md\`。

## 一、来源元信息

| 项 | 内容 |
| --- | --- |
| 提出人 / 来源 | 待填写 |
| 接收日期 | ${readable} |
| 关联需求 | SPEC.md#待补充锚点 |
| 关联设计 | docs/designs/${date}-${title}-设计.md（待生成） |
| 关联验收 | docs/verification/${date}-${title}/（待生成） |
| 状态 | 草稿 |

### 原件清单

| 原件 | 类型 | 版本 / 日期 | 存放位置 | 备注 |
| --- | --- | --- | --- | --- |
| 待填写 | PRD / 原型 |  | 原始需求/ |  |
| 待填写 | 原型 |  | 原型/ |  |

**原件只增不改。** 收到新版本时另存一份并在上表追加一行，注明版本与日期，不要覆盖旧版本。

## 二、原始描述

（保留提出者的原话，不要润色。润色会丢失原始意图。）

## 三、需求条目

按 \`R1\`、\`R2\`…… 编号，便于在设计、提交、验收中反复引用。

| 编号 | 需求（来源出处） | 验收标准 | 范围外 |
| --- | --- | --- | --- |
| R1 | 待填写（PRD 第 X 节） | 待填写（必须可判定） | 待填写 |
| R2 | 待填写 | 待填写 | 待填写 |

## 四、技术实现对照

逐条把需求落到实现上。**这张表是「在需求里加技术实现」的唯一位置**，不要把技术内容写回 PRD 原件。

| 编号 | 技术实现要点 | 影响文件 / 接口 | 已有基础 | 预估工作量 | 风险 |
| --- | --- | --- | --- | --- | --- |
| R1 | 待填写 | 待填写 | 无 | 小 / 中 / 大 | 待填写 |
| R2 | 待填写 | 待填写 | 无 | 小 / 中 / 大 | 待填写 |

填写要求：

- **技术实现要点**：说清「改哪一层、用什么机制」，不写代码。
- **影响文件 / 接口**：到文件或接口级；涉及接口变更必须同步 \`docs/API_CONTRACT.md\`。
- **已有基础**：说明能否复用现有实现，避免重复造轮子。
- **风险**：兼容性、数据迁移、性能、第三方依赖等。

## 五、待确认项

| # | 问题 | 由谁确认 | 状态 |
| --- | --- | --- | --- |
| 1 | 待填写 | 待填写 | 待确认 |

**不确定的不要猜。** 用假设填空会把错误固化进文档，代价远高于多问一句。

## 六、处理记录

| 日期 | 动作 | 说明 |
| --- | --- | --- |
| ${readable} | 建档 | 由 scripts/new-spec.mjs 生成 |
`;
}

function artifactReadme(kind) {
  const isPrd = kind === 'requirement';
  return `# ${isPrd ? '原始需求' : '原型'}

存放本次需求的${isPrd ? '需求原件' : '原型件'}，**只增不改**。

## 放什么

${isPrd ? '- PRD 原件（\`.docx\` / \`.pdf\` / \`.xlsx\` / \`.md\`）\n- 需求变更通知、补充说明\n- 从 IM 收到的需求截图（命名带日期与来源）' : '- 原型导出件（Axure / Figma / 墨刀 的 HTML 或图片）\n- 关键页面截图（命名用页面名，例如 客户列表-默认.png）\n- 交互说明截图'}

## 命名

保留原始文件名，不要重命名。若原名无信息量（如 \`未命名.png\`），改为 \`<日期>-<来源>-<内容>.<后缀>\`。

## 规则

1. **不修改、不覆盖。** 新版原件另存一份，并在主文档的「原件清单」追加一行。
2. **二进制原件旁应有 markdown 转换件**（如 \`.docx\` 对应的 \`.md\`），便于 AI 与检索定位；内容冲突时**以原件为准**。
3. 主体文档是上一级的 \`需求与技术对照.md\`，技术实现写在那里，不写进这些原件。
`;
}

function reportTemplate(title, date) {
  return `# 验收报告：${title}

- 需求来源：SPEC.md#待补充锚点、spec/${date}-${title}/
- 分支 / 提交：
- 环境：
- 数据前提：
- 验证人 / 日期：

## 逐条验收

| 编号 | 需求 | 结果 | 证据 |
| --- | --- | --- | --- |
| R1 | 待补充 | 待验证 |  |

## 与原型对比

（涉及界面时必填。原型件位于 spec/${date}-${title}/原型/，对比图放本目录 assets/）

| 页面 | 原型 | 实际 | 差异说明 |
| --- | --- | --- | --- |
| 待补充 |  |  |  |

## 未通过项与处理

无

## 未覆盖项（明确说明）

- 待补充

## 结论

待填写（通过 / 部分通过 / 未通过）
`;
}

function commandTemplate() {
  return `# 命令记录

> 规则：命令与原始输出成对出现；失败也要记录；敏感信息脱敏为 ***。

## 用例 1：

\`\`\`bash
# 待填写命令
\`\`\`

输出（节选）：

\`\`\`text
# 待填写原始输出
\`\`\`

结论：
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.title) {
    console.log(`用法：node scripts/new-spec.mjs --title "<需求主题>" [--with-artifacts] [--with-verification] [--dry-run] [--date YYYYMMDD]`);
    console.log('');
    console.log('  --with-artifacts     额外创建 原始需求/ 与 原型/ 目录（收到 PRD 或原型时使用）');
    console.log('  --with-verification  额外创建 docs/verification/<日期>-<主题>/ 验收骨架');
    process.exit(options.help ? 0 : 1);
  }

  const date = options.date || today();
  const slug = sanitize(options.title);
  if (!slug) {
    console.error('主题经清洗后为空，请换一个可用的名称。');
    process.exit(1);
  }

  const specDir = path.join(ROOT, 'spec', `${date}-${slug}`);
  const mainDoc = path.join(specDir, '需求与技术对照.md');
  const verificationDir = path.join(ROOT, 'docs', 'verification', `${date}-${slug}`);

  if (await fileExists(specDir)) {
    console.error(`需求目录已存在，未覆盖：${path.relative(ROOT, specDir)}`);
    process.exit(1);
  }

  const rel = (target) => path.relative(ROOT, target).split(path.sep).join('/');
  const actions = [`写入 ${rel(mainDoc)}`];
  if (options.withArtifacts) {
    actions.push(`写入 ${rel(path.join(specDir, '原始需求', 'README.md'))}`);
    actions.push(`写入 ${rel(path.join(specDir, '原型', 'README.md'))}`);
  }
  if (options.withVerification) {
    actions.push(`写入 ${rel(path.join(verificationDir, '验收报告.md'))}`);
    actions.push(`写入 ${rel(path.join(verificationDir, '命令记录.md'))}`);
  }

  if (options.dryRun) {
    console.log('预览模式，未实际写入：');
    for (const action of actions) console.log(`  - ${action}`);
    process.exit(0);
  }

  await mkdir(specDir, { recursive: true });
  await writeFile(mainDoc, mainDocTemplate(options.title, date), 'utf8');

  if (options.withArtifacts) {
    await mkdir(path.join(specDir, '原始需求'), { recursive: true });
    await writeFile(path.join(specDir, '原始需求', 'README.md'), artifactReadme('requirement'), 'utf8');
    await mkdir(path.join(specDir, '原型'), { recursive: true });
    await writeFile(path.join(specDir, '原型', 'README.md'), artifactReadme('prototype'), 'utf8');
  }

  if (options.withVerification) {
    await mkdir(path.join(verificationDir, 'assets'), { recursive: true });
    await writeFile(path.join(verificationDir, '验收报告.md'), reportTemplate(options.title, date), 'utf8');
    await writeFile(path.join(verificationDir, '命令记录.md'), commandTemplate(), 'utf8');
  }

  console.log('已创建需求目录：');
  for (const action of actions) console.log(`  ✅ ${action}`);
  console.log('');
  console.log('下一步（详见 docs/11-需求接收与拆解.md）：');
  console.log('  1. 把 PRD / 原型原件放进 原始需求/ 与 原型/，并在「原件清单」登记');
  console.log('  2. 给需求编号 R1、R2……，逐条写可判定的验收标准');
  console.log('  3. 在「技术实现对照」中逐条填写实现要点与影响文件');
  console.log('  4. 列出待确认项并指定确认人，与产品对齐');
  console.log('  5. 把稳定的需求与验收标准提炼进 SPEC.md，并在其中反向链接到本目录');
}

main().catch((error) => {
  console.error('需求建档失败：', error);
  process.exit(1);
});
