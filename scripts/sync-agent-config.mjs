#!/usr/bin/env node
/**
 * 多 AI 工具配置同步
 *
 * AGENTS.md 是唯一事实来源；本脚本为其他 AI 工具生成指向它的入口文件，
 * 避免在多个工具配置文件里重复维护同一套规范。
 *
 * 用法：
 *   node scripts/sync-agent-config.mjs           # 生成 / 更新入口文件
 *   node scripts/sync-agent-config.mjs --check   # 只校验是否已同步（CI 使用）
 *   node scripts/sync-agent-config.mjs --lock    # 更新 skills-lock.json 中的哈希
 */

import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_FILE = path.join(ROOT, 'skills-lock.json');
const SKILLS_DIR = path.join(ROOT, '.agents', 'skills');

const CLAUDE_ENTRY = `# Claude Code 入口

本项目的开发规范以 \`AGENTS.md\` 为**唯一事实来源**，本文件只做转发，不要在此处编写规范内容。

请先阅读并遵守：

@AGENTS.md

补充说明：

- 工作流文档位于 \`docs/\`，按编号顺序阅读。
- 自研技能位于 \`skills/\`，外部引入技能位于 \`.agents/skills/\`（来源与哈希见 \`skills-lock.json\`）。
- **只使用仓库内技能**：禁止调用个人目录下的技能（\`~/.codex/skills\`、\`~/.claude/skills\` 等），需要新能力先引入到仓库。
- 声称任务完成前，必须实际运行验证命令并给出命令与原始输出。
- 禁止把密钥、口令、真实用户数据写入任何被提交的文件。
`;

const CURSOR_RULE = `---
description: 团队 AI 工作流规范入口
alwaysApply: true
---

# 工作流规范入口

本项目的开发规范以仓库根目录的 \`AGENTS.md\` 为**唯一事实来源**。

开始任何任务前，先读取 \`AGENTS.md\`，再按其中「阅读顺序」按需加载文档。

硬性底线（详见 \`docs/\`）：

1. 声称「完成 / 修好 / 通过」之前，必须运行验证命令并给出命令与原始输出。
2. 禁止把密钥、口令、Token、真实用户数据写入任何被提交的文件。
3. 禁止用 \`--no-verify\` 绕过 Git 钩子，禁止用放宽规则或注释测试的方式让检查通过。
4. 同一事实只写一处：需求写 \`SPEC.md\`，决策写 \`MEMORY.md\`，规范写 \`docs/\`。
5. 只使用仓库内技能：自研在 \`skills/\`，引入在 \`.agents/skills/\`；禁止调用个人目录下的技能。
`;

const COPILOT_ENTRY = `# Copilot 说明

本项目的开发规范以仓库根目录的 \`AGENTS.md\` 为**唯一事实来源**。本文件只做转发。

要点：

- 遵循 \`docs/05-分支提交与评审.md\` 的提交信息格式：\`type(scope): subject\`。
- 提交前运行模块校验命令，见 \`AGENTS.md\` 的命令索引。
- 不生成包含真实密钥、口令或用户数据的示例代码。
- 只使用仓库内技能（\`skills/\` 与 \`.agents/skills/\`），不要调用个人目录下的技能。
- 更完整的规则见 \`AGENTS.md\` 与 \`docs/\`。
`;

const GENERATED = [
  { file: 'CLAUDE.md', content: CLAUDE_ENTRY },
  { file: path.join('.cursor', 'rules', '00-workflow.mdc'), content: CURSOR_RULE },
  { file: path.join('.github', 'copilot-instructions.md'), content: COPILOT_ENTRY }
];

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectSkills(dir) {
  if (!(await exists(dir))) return [];
  const result = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await collectSkills(full)));
    else if (entry.name === 'SKILL.md') result.push(full);
  }
  return result;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function syncGenerated(checkOnly) {
  const outOfSync = [];
  const updated = [];

  for (const item of GENERATED) {
    const target = path.join(ROOT, item.file);
    const display = item.file.split(path.sep).join('/');
    const current = (await exists(target)) ? await readFile(target, 'utf8') : null;

    if (current === item.content) continue;

    if (checkOnly) {
      outOfSync.push(display);
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, item.content, 'utf8');
    updated.push(display);
  }

  return { outOfSync, updated };
}

async function verifyLock() {
  if (!(await exists(LOCK_FILE))) {
    return { problems: ['skills-lock.json 不存在'], skills: {} };
  }

  const lock = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
  const problems = [];
  const files = await collectSkills(SKILLS_DIR);

  for (const file of files) {
    const display = path.relative(ROOT, file).split(path.sep).join('/');
    const content = await readFile(file, 'utf8');
    const hash = sha256(content);
    const recorded = lock.skills?.[path.basename(path.dirname(file))]?.computedHash;
    if (!recorded) problems.push(`未登记：${display}`);
    else if (recorded !== hash) problems.push(`哈希不一致（内容已变更）：${display}`);
  }

  return { problems, skills: lock.skills ?? {} };
}

async function updateLock() {
  const lock = (await exists(LOCK_FILE)) ? JSON.parse(await readFile(LOCK_FILE, 'utf8')) : { version: 1, skills: {} };
  const files = await collectSkills(SKILLS_DIR);
  const skills = { ...(lock.skills ?? {}) };

  for (const file of files) {
    const name = path.basename(path.dirname(file));
    const content = await readFile(file, 'utf8');
    const previous = skills[name] ?? {};
    skills[name] = {
      source: previous.source ?? '待填写（例如 owner/repo）',
      sourceType: previous.sourceType ?? 'github',
      skillPath: path.relative(ROOT, file).split(path.sep).join('/'),
      computedHash: sha256(content)
    };
  }

  const next = {
    version: lock.version ?? 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '外部引入技能的来源与内容哈希。升级技能后必须重新执行 node scripts/sync-agent-config.mjs --lock',
    skills
  };

  await writeFile(LOCK_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return Object.keys(skills).length;
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const lockOnly = argv.includes('--lock');

  if (lockOnly) {
    const count = await updateLock();
    console.log(`✅ 已更新 skills-lock.json，共登记 ${count} 个外部技能。`);
    return;
  }

  const { outOfSync, updated } = await syncGenerated(checkOnly);

  if (checkOnly) {
    const { problems } = await verifyLock();
    const all = [...outOfSync.map((f) => `入口文件未同步：${f}`), ...problems];

    if (all.length > 0) {
      console.error('❌ 多 AI 工具配置检查未通过：');
      for (const item of all) console.error(`  - ${item}`);
      console.error('');
      console.error('修复方式：node scripts/sync-agent-config.mjs');
      process.exit(1);
    }

    console.log('✅ 多 AI 工具配置已同步，技能哈希校验通过。');
    return;
  }

  if (updated.length === 0) {
    console.log('✅ 入口文件已是最新，无需更新。');
  } else {
    console.log(`✅ 已更新 ${updated.length} 个入口文件：`);
    for (const item of updated) console.log(`  - ${item}`);
  }
}

main().catch((error) => {
  console.error('同步失败：', error);
  process.exit(1);
});
