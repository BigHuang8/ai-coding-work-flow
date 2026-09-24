/**
 * 技术栈探测与分类的公共逻辑
 *
 * 被 scripts/detect-stack.mjs（探测报告与自检）与 scripts/bootstrap.mjs（接入体检）共用，
 * 数据来源是仓库根的 stacks/registry.json。
 *
 * 三类结果的口径：
 *   enabled   项目用到、模板有规范
 *   available 模板有规范、项目没用到（装箱，不注入、不进阅读顺序）
 *   gaps      项目用到、模板没规范（缺口，走补规范流程）
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', 'out', 'coverage',
  '.cache', '.turbo', '.vite', 'unpackage', '.idea', '.vscode'
]);

/** 探测深度：够覆盖常见的多模块仓库（server/、web/、packages/app/） */
const MAX_DEPTH = 3;
/** 单个构建文件最大读取体积，超过则跳过，避免误读大文件 */
const MAX_FILE_BYTES = 512 * 1024;

const BUILD_FILES = new Set(['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts']);

/** SQL 方言特征扫描的总预算，避免大仓库拖慢探测 */
const MAX_SQL_BYTES = 256 * 1024;

export async function loadRegistry(root) {
  const file = path.join(root, 'stacks', 'registry.json');
  return { registry: JSON.parse(await readFile(file, 'utf8')), file };
}

/** 扫描目标项目的文件列表（相对路径，正斜杠分隔） */
export async function scanTarget(target, { depth = MAX_DEPTH } = {}) {
  const files = [];

  async function walk(dir, level) {
    if (level > depth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        await walk(full, level + 1);
      } else if (entry.isFile()) {
        files.push(path.relative(target, full).split(path.sep).join('/'));
      }
    }
  }

  await walk(target, 1);
  return files.sort();
}

async function readText(target, file) {
  try {
    const info = await stat(path.join(target, file));
    if (info.size > MAX_FILE_BYTES) return '';
    return await readFile(path.join(target, file), 'utf8');
  } catch {
    return '';
  }
}

/** 汇总探测上下文：文件清单、npm 依赖集合、构建文件文本、SQL 文本 */
export async function buildContext(target, files) {
  const packageDeps = new Set();
  let buildText = '';
  let sqlText = '';

  for (const file of files) {
    const base = path.posix.basename(file).toLowerCase();

    // SQL 文件用于判定数据库方言：只看关键字特征，不看文件名，避免「有 .sql 就是 MySQL」的误判
    if (base.endsWith('.sql')) {
      if (sqlText.length < MAX_SQL_BYTES) sqlText += (await readText(target, file)).toLowerCase();
      continue;
    }

    if (!BUILD_FILES.has(base)) continue;

    if (base === 'package.json') {
      try {
        const json = JSON.parse(await readText(target, file));
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
          for (const name of Object.keys(json[key] ?? {})) packageDeps.add(name.toLowerCase());
        }
      } catch {
        // 无法解析的 package.json 直接跳过，不影响其他栈的判定
      }
    } else {
      buildText += (await readText(target, file)).toLowerCase();
    }
  }

  return { files, packageDeps, buildText, sqlText };
}

/** 探测规则匹配：返回命中的文件路径，未命中返回空串 */
export function matchPattern(pattern, files) {
  const rule = pattern.toLowerCase();

  for (const file of files) {
    const value = file.toLowerCase();

    if (rule.startsWith('**/*.')) {
      const ext = rule.slice(rule.indexOf('.'));
      if (value.endsWith(ext)) return file;
      continue;
    }

    if (rule.startsWith('**/')) {
      const name = rule.slice(3);
      const segments = value.split('/');
      if (segments.includes(name) || segments[segments.length - 1] === name) return file;
      continue;
    }

    if (value === rule) return file;
  }

  return '';
}

/** 判断某个技术栈是否被项目用到，返回证据列表 */
export function matchStack(stack, context) {
  if (stack.always) return ['registry: always'];

  const evidence = [];

  for (const pattern of stack.detect?.files ?? []) {
    const hit = matchPattern(pattern, context.files);
    if (hit) evidence.push(hit);
  }
  for (const dep of stack.detect?.packageDeps ?? []) {
    if (context.packageDeps.has(dep.toLowerCase())) evidence.push(`package.json 依赖 ${dep}`);
  }
  for (const keyword of stack.detect?.pomKeywords ?? []) {
    if (context.buildText.includes(keyword.toLowerCase())) evidence.push(`构建文件关键字 ${keyword}`);
  }
  for (const keyword of stack.detect?.sqlKeywords ?? []) {
    if ((context.sqlText ?? '').includes(keyword.toLowerCase())) evidence.push(`SQL 方言特征 ${keyword}`);
  }

  return evidence;
}

/** 把探测结果分成三类 */
export function classify(registry, context) {
  const enabled = [];
  const available = [];

  for (const stack of registry.stacks ?? []) {
    const evidence = matchStack(stack, context);
    if (evidence.length > 0) enabled.push({ ...stack, evidence });
    else available.push(stack);
  }

  const gaps = [];
  for (const stack of registry.catalog ?? []) {
    const evidence = matchStack(stack, context);
    if (evidence.length > 0) gaps.push({ ...stack, evidence });
  }

  // 兜底：出现登记表之外的构建文件时，点名提示补登记
  const manifests = registry.manifests ?? {};
  const cited = new Set([...enabled, ...gaps].flatMap((stack) => stack.evidence));
  for (const file of context.files) {
    const base = path.posix.basename(file);
    const name = manifests[base] ?? manifests[base.toLowerCase()];
    if (!name || cited.has(file)) continue;
    gaps.push({
      id: `unregistered-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      slot: 'other',
      evidence: [file]
    });
  }

  return { enabled, available, gaps };
}

/** 登记表结构自检 */
export function validateRegistry(registry) {
  const issues = [];
  const ids = new Set();
  const slots = Object.keys(registry.slots ?? {});

  const inspect = (stack, kind) => {
    const label = stack.id ?? `（第 ${ids.size + 1} 条 ${kind}）`;
    if (!stack.id) issues.push({ level: 'error', message: `${kind} 条目缺少 id` });
    else if (ids.has(stack.id)) issues.push({ level: 'error', message: `技术栈 id 重复：${stack.id}` });
    else ids.add(stack.id);

    if (!stack.name) issues.push({ level: 'error', message: `${label} 缺少 name` });
    if (!slots.includes(stack.slot)) {
      issues.push({ level: 'error', message: `${label} 的 slot 非法：${stack.slot ?? '未填'}` });
    }

    if (kind === 'stacks') {
      if (!(stack.guidelines ?? []).length) issues.push({ level: 'error', message: `${label} 缺少 guidelines` });
      if (!stack.validate) issues.push({ level: 'error', message: `${label} 缺少 validate` });
      if (!['built-in', 'provisional'].includes(stack.status)) {
        issues.push({ level: 'error', message: `${label} 的 status 非法：${stack.status ?? '未填'}` });
      }
    } else if (stack.guidelines) {
      issues.push({ level: 'error', message: `${label} 属于 catalog，不应声明 guidelines` });
    }
  };

  (registry.stacks ?? []).forEach((stack) => inspect(stack, 'stacks'));
  (registry.catalog ?? []).forEach((stack) => inspect(stack, 'catalog'));

  return issues;
}

/** 生成项目侧的 docs/TECH_STACK.md */
export function renderTechStackDoc({ generatedAt, trunkBranch, enabled, available, gaps, fusion = [] }) {
  const lines = [];

  lines.push('# 技术栈登记与接入记录');
  lines.push('');
  lines.push('> 本文件由 `node scripts/bootstrap.mjs` 生成，是**记录**不是规范：规范正文在 `docs/` 中。');
  lines.push('> 技术栈变动（新增、替换、停用）时重跑 `node scripts/bootstrap.mjs --target <项目> --force`，或手动改本文件。');
  lines.push('');
  lines.push(`- 生成日期：${generatedAt}`);
  lines.push(`- 主干分支：${trunkBranch || '未识别，请确认 workflow.config.json 的 trunkBranch'}`);
  lines.push(`- 探测命令：\`node scripts/detect-stack.mjs\``);
  lines.push('');
  lines.push('## 一、启用的技术栈');
  lines.push('');
  lines.push('| 能力位 | 技术栈 | 规范文档 | 校验命令 |');
  lines.push('| --- | --- | --- | --- |');

  if (enabled.length === 0) {
    lines.push('| — | 未探测到技术栈，请手动确认 | — | — |');
  } else {
    for (const stack of enabled) {
      const guidelines = (stack.guidelines ?? []).map((item) => '`' + item + '`').join('、');
      lines.push(`| ${stack.slot} | ${stack.name} | ${guidelines} | \`${stack.validate}\` |`);
    }
  }

  lines.push('');
  lines.push('## 二、模板有规范、本项目未启用');
  lines.push('');
  lines.push('这些栈的规范留在仓库里备用：**不写进 AGENTS.md 阅读顺序、不进 CI**，用到时再启用。');
  lines.push('');

  if (available.length === 0) {
    lines.push('无。');
  } else {
    lines.push('| 能力位 | 技术栈 | 规范文档 | 说明 |');
    lines.push('| --- | --- | --- | --- |');
    for (const stack of available) {
      const guidelines = (stack.guidelines ?? []).map((item) => '`' + item + '`').join('、');
      lines.push(`| ${stack.slot} | ${stack.name} | ${guidelines} | 本项目未使用 |`);
    }
  }

  lines.push('');
  lines.push('## 三、本项目用到、模板暂无规范（缺口）');
  lines.push('');
  lines.push('缺口必须有人认领：按 `docs/10-技术栈适配.md` 第三节补一份最小规范，先登记为 `provisional`，转正后回填本表。');
  lines.push('');

  if (gaps.length === 0) {
    lines.push('无。');
  } else {
    lines.push('| 能力位 | 技术栈 | 证据 | 处理 | 负责人 | 期限 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const stack of gaps) {
      const evidence = stack.evidence.map((item) => '`' + item + '`').join('、');
      lines.push(`| ${stack.slot} | ${stack.name} | ${evidence} | 补最小规范 + 登记 | 待指派 | 待定 |`);
    }
  }

  lines.push('');
  lines.push('## 四、校验入口');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run validate                 # 文档 + 技能 + 技术栈 + AI 入口，统一入口');
  lines.push('node scripts/detect-stack.mjs    # 重新探测，确认三类清单没有漂移');
  lines.push('node scripts/detect-stack.mjs --check --strict   # 接入稳定后在 CI 中打开');
  lines.push('```');
  lines.push('');
  lines.push('## 五、接入融合清单');
  lines.push('');
  lines.push('项目里已有的约定一律不覆盖，按下面的方式合并；清单为空表示全新接入，没有历史包袱。');
  lines.push('');

  if (fusion.length === 0) {
    lines.push('无。');
  } else {
    lines.push('| 类别 | 已有的约定 | 合并方式 |');
    lines.push('| --- | --- | --- |');
    for (const item of fusion) {
      lines.push(`| ${item.kind} | \`${item.path}\` | ${item.advice} |`);
    }
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}
