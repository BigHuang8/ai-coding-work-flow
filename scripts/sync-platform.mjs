#!/usr/bin/env node
/**
 * 平台产物一致性：templates/platform/<平台>/ 是唯一事实来源
 *
 * 约定：templates/platform/<平台>/ 里的文件按**目标项目中的相对路径**存放。
 *   templates/platform/github/.github/workflows/standards.yml  →  <项目>/.github/workflows/standards.yml
 *   templates/platform/gitlab/.gitlab-ci.yml                   →  <项目>/.gitlab-ci.yml
 *   templates/platform/gitee/.gitee/PULL_REQUEST_TEMPLATE.md   →  <项目>/.gitee/PULL_REQUEST_TEMPLATE.md
 * bootstrap.mjs 按探测到的平台把对应目录里的产物注入业务项目。
 *
 * 本仓库自身托管在 Gitee，所以根目录也有 .gitee/。这类「根副本」由本脚本从模板生成并校验，
 * 保证同一份产物不会维护两遍。只刷新根目录**已存在**的同名文件，不会主动新建：
 * 本仓库没有 GitHub 远程，就不该在根目录出现 .github/workflows。
 *
 * 用法：
 *   node scripts/sync-platform.mjs           # 用模板刷新仓库根的同名副本
 *   node scripts/sync-platform.mjs --check   # 只校验一致性（门禁使用）
 *   node scripts/sync-platform.mjs --list    # 打印各平台产物清单
 */

import { readdir, readFile, copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, formatStatistics, formatSummary } from './lib/reporter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM_DIR = path.join(ROOT, 'templates', 'platform');

/** 说明文件描述约定本身，不注入业务项目，因此不参与根副本比对 */
const NOT_ARTIFACT = new Set(['README.md']);

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, base)));
    } else {
      files.push({ full, relative: path.relative(base, full).split(path.sep).join('/') });
    }
  }
  return files;
}

/** 列出各平台目录及其产物（相对路径即目标项目里的位置） */
async function platformArtifacts() {
  if (!(await exists(PLATFORM_DIR))) return [];
  const platforms = [];
  for (const entry of await readdir(PLATFORM_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PLATFORM_DIR, entry.name);
    const files = (await collectFiles(dir)).filter((file) => !NOT_ARTIFACT.has(file.relative));
    platforms.push({ id: entry.name, files });
  }
  return platforms.sort((a, b) => a.id.localeCompare(b.id));
}

/** 换行符不参与比对：Windows 检出与 LF 提交内容视为一致 */
function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const list = args.includes('--list');
  const started = Date.now();
  const issues = [];
  const platforms = await platformArtifacts();

  // 业务项目里只有注入后的平台产物，没有模板源，跳过比对属正常；
  // 但模板仓库自己缺了 templates/platform/ 就是真问题（例如误删、误移动）。
  if (platforms.length === 0) {
    if (await exists(path.join(ROOT, 'templates', 'project'))) {
      const message = '模板仓库缺少 templates/platform/ 目录：平台产物没有来源，无法比对根副本';
      if (check) {
        console.log(
          formatReport(
            [{ ruleId: 'E802', file: 'templates/platform/', message, suggestion: '从模板仓库恢复该目录，或确认平台产物是否已迁移到别处' }],
            '平台产物一致性自检'
          )
        );
        console.log(formatSummary(1));
        process.exit(1);
      }
      console.error(`同步失败：${message}`);
      process.exit(1);
    }
    console.log('未找到 templates/platform/：当前仓库没有平台产物模板源（业务项目属正常），已跳过比对。');
    return;
  }

  if (list) {
    for (const platform of platforms) {
      console.log(`${platform.id}（${platform.files.length} 个产物）`);
      for (const file of platform.files) console.log(`  ${file.relative}`);
    }
    return;
  }

  let inspected = 0;
  let refreshed = 0;

  for (const platform of platforms) {
    for (const file of platform.files) {
      const rootCopy = path.join(ROOT, file.relative);
      // 只处理仓库根已有同名文件的产物：根目录代表本仓库自身托管平台的运行配置
      if (!(await exists(rootCopy))) continue;
      inspected += 1;

      const [templateText, rootText] = await Promise.all([
        readFile(file.full, 'utf8'),
        readFile(rootCopy, 'utf8')
      ]);
      if (normalize(templateText) === normalize(rootText)) continue;

      if (check) {
        issues.push({
          ruleId: 'E801',
          file: file.relative,
          message: '仓库根副本与 templates/platform 下的模板不一致',
          detail: `模板：templates/platform/${platform.id}/${file.relative}`,
          suggestion: '跑 node scripts/sync-platform.mjs 用模板刷新根副本；若根副本才是最新，请改模板目录'
        });
        continue;
      }

      await mkdir(path.dirname(rootCopy), { recursive: true });
      await copyFile(file.full, rootCopy);
      refreshed += 1;
      console.log(`已刷新：${file.relative}`);
    }
  }

  if (check) {
    console.log(formatReport(issues, '平台产物一致性自检'));
    console.log(
      formatStatistics({ totalFiles: inspected, duration: Date.now() - started, issues: issues.length, warnings: 0 })
    );
    console.log(formatSummary(issues.length));
    process.exit(issues.length > 0 ? 1 : 0);
  }

  console.log(
    `平台产物同步完成：比对仓库根副本 ${inspected} 个，刷新 ${refreshed} 个；模板来源 templates/platform/。`
  );
}

main().catch((error) => {
  console.error('平台产物同步失败：', error);
  process.exit(1);
});
