#!/usr/bin/env node
/**
 * 需求留档生成器
 *
 * 用法：
 *   node scripts/new-spec.mjs --title "客户列表团队筛选"
 *   node scripts/new-spec.mjs --title "登录改造" --with-verification
 *   node scripts/new-spec.mjs --title "临时需求" --dry-run
 *
 * 生成：
 *   spec/<YYYYMMDD>-<主题>.md
 *   （可选）docs/verification/<YYYYMMDD>-<主题>/ 验收报告与命令记录骨架
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { title: '', dryRun: false, withVerification: false, date: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--title') options.title = argv[++i] ?? '';
    else if (arg === '--date') options.date = argv[++i] ?? '';
    else if (arg === '--dry-run') options.dryRun = true;
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
    .replace(/^[-.]+|[-.]+$/g, '');
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function specTemplate(title, date) {
  const readable = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  return `# ${title}

- 提出人 / 日期：／${readable}
- 关联需求：SPEC.md#待补充锚点
- 状态：草稿

## 原始描述

（保留提出者的原话，不要润色。润色会丢失原始意图。）

## 要什么

1. 待补充

## 不要什么（范围外）

1. 待补充

## 待确认项

| 问题 | 由谁确认 | 状态 |
| --- | --- | --- |
| 待补充 | 待补充 | 待确认 |

## 验收标准（提炼后写入 SPEC.md）

1. 待补充（必须可判定，禁止出现「友好」「流畅」「合理」这类无法判定的词）

---

## 处理记录

| 日期 | 动作 | 说明 |
| --- | --- | --- |
| ${readable} | 建档 | 由 scripts/new-spec.mjs 生成 |
`;
}

function reportTemplate(title) {
  return `# 验收报告：${title}

- 需求来源：SPEC.md#待补充锚点
- 分支 / 提交：
- 环境：
- 数据前提：
- 验证人 / 日期：

## 逐条验收

| # | 验收标准 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 待补充 | 待验证 |  |

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
    console.log(`用法：node scripts/new-spec.mjs --title "<需求主题>" [--with-verification] [--dry-run] [--date YYYYMMDD]`);
    process.exit(options.help ? 0 : 1);
  }

  const date = options.date || today();
  const slug = sanitize(options.title);
  if (!slug) {
    console.error('主题经清洗后为空，请换一个可用的名称。');
    process.exit(1);
  }

  const specDir = path.join(ROOT, 'spec');
  const specFile = path.join(specDir, `${date}-${slug}.md`);
  const verificationDir = path.join(ROOT, 'docs', 'verification', `${date}-${slug}`);

  if (await fileExists(specFile)) {
    console.error(`需求留档已存在，未覆盖：${path.relative(ROOT, specFile)}`);
    process.exit(1);
  }

  const actions = [
    `写入 ${path.relative(ROOT, specFile).split(path.sep).join('/')}`
  ];
  if (options.withVerification) {
    actions.push(`写入 ${path.relative(ROOT, path.join(verificationDir, '验收报告.md')).split(path.sep).join('/')}`);
    actions.push(`写入 ${path.relative(ROOT, path.join(verificationDir, '命令记录.md')).split(path.sep).join('/')}`);
  }

  if (options.dryRun) {
    console.log('预览模式，未实际写入：');
    for (const action of actions) console.log(`  - ${action}`);
    process.exit(0);
  }

  await mkdir(specDir, { recursive: true });
  await writeFile(specFile, specTemplate(options.title, date), 'utf8');

  if (options.withVerification) {
    await mkdir(path.join(verificationDir, 'assets'), { recursive: true });
    await writeFile(path.join(verificationDir, '验收报告.md'), reportTemplate(options.title), 'utf8');
    await writeFile(path.join(verificationDir, '命令记录.md'), commandTemplate(), 'utf8');
  }

  console.log('已创建需求留档：');
  for (const action of actions) console.log(`  ✅ ${action}`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 补齐「原始描述」「要什么」「不要什么（范围外）」');
  console.log('  2. 把验收标准写进 SPEC.md 并建立双向关联');
  console.log('  3. 找一个人复述需求，确认无歧义');
}

main().catch((error) => {
  console.error('生成需求留档失败：', error);
  process.exit(1);
});
