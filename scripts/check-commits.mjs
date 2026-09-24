#!/usr/bin/env node
/**
 * 批量校验提交信息（用于 CI，本地由 .githooks/commit-msg 拦截）
 *
 * 用法：
 *   node scripts/check-commits.mjs "origin/main..HEAD"
 *   node scripts/check-commits.mjs            # 默认校验最近一次提交
 */

import { execFileSync } from 'node:child_process';

const PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+/;
const SKIP_PATTERN = /^(Merge |Revert |fixup! |squash! )/;

const range = process.argv[2] ?? 'HEAD~1..HEAD';

function gitLog() {
  try {
    return execFileSync('git', ['log', '--format=%H%x09%s', range], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    console.error(`无法读取提交范围：${range}`);
    console.error('若为首次推送或深克隆受限，请先执行 git fetch 再重试。');
    process.exit(1);
  }
}

const commits = gitLog();
const invalid = [];

for (const line of commits) {
  const [hash, subject = ''] = line.split('\t');
  if (SKIP_PATTERN.test(subject)) continue;
  if (!PATTERN.test(subject)) invalid.push({ hash: hash.slice(0, 8), subject });
}

if (invalid.length > 0) {
  console.error(`❌ 提交信息校验未通过，共 ${invalid.length} 条不符合 type(scope): subject：`);
  for (const item of invalid) {
    console.error(`  - ${item.hash}  ${item.subject}`);
  }
  console.error('');
  console.error('说明见 docs/05-分支提交与评审.md');
  process.exit(1);
}

console.log(`✅ 提交信息校验通过（共检查 ${commits.length} 条提交）。`);
