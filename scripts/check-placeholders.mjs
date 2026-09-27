#!/usr/bin/env node
/**
 * 接入项目关键占位符检查。
 *
 * 模板源目录中的占位符是有意保留的示例，不参与检查；只检查接入后
 * 团队必须填写的文件，避免项目带着模板默认负责人和空白概览进入评审。
 */

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_FILES = [
  'AGENTS.md',
  'SPEC.md',
  'MEMORY.md',
  'CODEOWNERS',
  '.github/CODEOWNERS'
];
const PLACEHOLDERS = [
  { pattern: /@your-team\//g, label: '@your-team/... 团队负责人占位符' },
  { pattern: /<项目名>/g, label: '<项目名>' },
  { pattern: /<一句话说明这个项目做什么>/g, label: '<一句话说明这个项目做什么>' },
  { pattern: /<谁在用>/g, label: '<谁在用>' },
  { pattern: /<待填写>/g, label: '<待填写>' },
  { pattern: /<YYYY-MM-DD>/g, label: '<YYYY-MM-DD>' }
];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const argIndex = process.argv.indexOf('--path');
  const scanRoot = argIndex === -1
    ? ROOT
    : path.resolve(process.argv[argIndex + 1] ?? '');
  const issues = [];

  for (const relative of TARGET_FILES) {
    const file = path.join(scanRoot, relative);
    if (!(await exists(file))) continue;
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const item of PLACEHOLDERS) {
        item.pattern.lastIndex = 0;
        if (item.pattern.test(line)) {
          issues.push({ file: relative, line: index + 1, label: item.label });
        }
      }
    });
  }

  if (issues.length > 0) {
    console.error(`❌ 接入占位符检查未通过：发现 ${issues.length} 处未替换内容`);
    for (const issue of issues) {
      console.error(`  - ${issue.file}:${issue.line}：${issue.label}`);
    }
    console.error('修复方式：替换模板占位内容后重新运行 node scripts/check-placeholders.mjs。');
    process.exit(1);
  }

  console.log('✅ 接入项目关键占位符检查通过');
}

main().catch((error) => {
  console.error('占位符检查失败：', error.message ?? error);
  process.exit(1);
});
