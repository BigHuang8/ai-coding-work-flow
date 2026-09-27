#!/usr/bin/env node
/**
 * 模板版本一致性检查。
 *
 * 版本事实同时展示在 package.json、README.md 和 CHANGELOG.md；这三个位置
 * 必须保持一致，否则发布说明与实际工具版本会产生漂移。
 */

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = '(\\d+\\.\\d+\\.\\d+)';

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

  // bootstrap 会把 scripts/ 复制到业务项目；业务项目没有模板仓库的 templates/
  // 目录和三处版本事实，不能把模板仓库专属检查误当成业务项目门禁。
  if (!(await exists(path.join(scanRoot, 'templates')))) {
    console.log('ℹ️ 当前为业务项目，跳过模板仓库版本一致性检查');
    return;
  }

  const packageJson = JSON.parse(await readFile(path.join(scanRoot, 'package.json'), 'utf8'));
  const readme = await readFile(path.join(scanRoot, 'README.md'), 'utf8');
  const changelog = await readFile(path.join(scanRoot, 'CHANGELOG.md'), 'utf8');

  const packageVersion = String(packageJson.version ?? '');
  const readmeVersion = readme.match(new RegExp(`\\*\\*模板版本\\*\\*：${SEMVER}`))?.[1] ?? '';
  const changelogVersion = changelog.match(new RegExp(`^## \\[${SEMVER}\\]`, 'm'))?.[1] ?? '';
  const entries = [
    ['package.json', packageVersion],
    ['README.md', readmeVersion],
    ['CHANGELOG.md 最新条目', changelogVersion]
  ];
  const missing = entries.filter(([, version]) => !version);
  const versions = [...new Set(entries.map(([, version]) => version).filter(Boolean))];

  if (missing.length > 0 || versions.length !== 1) {
    console.error('❌ 模板版本一致性检查未通过：');
    for (const [file, version] of entries) {
      console.error(`  - ${file}：${version || '未找到有效版本号'}`);
    }
    console.error('修复方式：同步 package.json、README.md 与 CHANGELOG.md 最新条目的版本号。');
    process.exit(1);
  }

  console.log(`✅ 模板版本一致：${versions[0]}`);
}

main().catch((error) => {
  console.error('模板版本检查失败：', error.message ?? error);
  process.exit(1);
});
