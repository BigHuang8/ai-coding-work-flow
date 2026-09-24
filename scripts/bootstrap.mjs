#!/usr/bin/env node
/**
 * 把工作流模板注入到业务项目
 *
 * 用法：
 *   node scripts/bootstrap.mjs --target ../your-project --dry-run
 *   node scripts/bootstrap.mjs --target ../your-project
 *   node scripts/bootstrap.mjs --target ../your-project --stack auto
 *   node scripts/bootstrap.mjs --target ../your-project --stack java-springboot,vue3
 *   node scripts/bootstrap.mjs --target ../your-project --stack none
 *   node scripts/bootstrap.mjs --target ../your-project --force
 *   node scripts/bootstrap.mjs --target ../your-project --trunk int
 *
 * 默认行为：目标已存在的文件一律跳过，不覆盖。
 * 技术栈默认自动探测（--stack auto），探测结果写入 workflow.config.json 与 docs/TECH_STACK.md。
 */

import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, cp, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContext,
  classify,
  loadRegistry,
  renderTechStackDoc,
  scanTarget,
  validateRegistry
} from './lib/stacks.mjs';
import { AI_ENTRY_KEYS } from './lib/ai-entries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'build', 'coverage', '.cache']);

/**
 * 融合类文件：项目往往会自己维护，即使 --update 也不覆盖，只提示合并。
 * 其余托管文件（docs、skills、scripts、.githooks、assets 等）在 --update 时按模板最新版刷新。
 */
const FUSION_KEEP = new Set(['.env.example']);

/**
 * 项目必然要改的文件：--update 时若已把占位内容替换掉，就判定为「已定制」并保留，
 * 避免刷新模板时冲掉项目概览、需求与决策记录。
 */
const CUSTOMIZABLE = new Set(['AGENTS.md', 'SPEC.md', 'MEMORY.md']);

/** 模板占位符形如 <项目名>、<一句话说明这个项目做什么>；替换干净了就说明项目已经改过 */
async function looksCustomized(target, relative) {
  try {
    const content = await readFile(path.join(target, relative), 'utf8');
    return !/<[\u4e00-\u9fff][^>\n]{0,40}>/.test(content);
  } catch {
    return false;
  }
}

/** 注入清单：from 相对模板仓库，to 相对目标项目 */
const ENTRY_LIST = [
  { from: 'templates/project/AGENTS.md', to: 'AGENTS.md' },
  { from: 'templates/project/SPEC.md', to: 'SPEC.md' },
  { from: 'templates/project/MEMORY.md', to: 'MEMORY.md' },
  { from: 'templates/project/.env.example', to: '.env.example' },
  { from: 'templates/project/docs/API_CONTRACT.md', to: 'docs/API_CONTRACT.md' },
  { from: 'templates/project/spec/README.md', to: 'spec/README.md' },
  { from: 'templates/project/db', to: 'db' },
  { from: 'docs', to: 'docs' },
  { from: 'skills', to: 'skills' },
  { from: 'stacks', to: 'stacks' },
  { from: 'scripts', to: 'scripts' },
  { from: '.githooks', to: '.githooks' },
  { from: '.editorconfig', to: '.editorconfig' },
  { from: '.tasksignore', to: '.tasksignore' },
  { from: 'skills-lock.json', to: 'skills-lock.json' },
  { from: 'assets', to: 'assets' }
];

/**
 * 接入融合清单：这些约定若项目里已经有了，一律不覆盖，而是给出合并方式。
 * 无缝接入的前提是「只补不改」——冲掉项目既有约定比不接入更糟。
 */
const FUSION_TARGETS = [
  {
    path: 'CLAUDE.md',
    kind: 'AI 入口',
    advice: '该文件由 AGENTS.md 生成；项目自有规则先并入 AGENTS.md，再跑 node scripts/sync-agent-config.mjs'
  },
  {
    path: '.cursorrules',
    kind: 'AI 入口',
    advice: '自有规则并入 AGENTS.md，由 sync-agent-config.mjs 生成 .cursor/rules/'
  },
  {
    path: '.windsurfrules',
    kind: 'AI 入口',
    advice: '自有规则并入 AGENTS.md；本模板不生成该文件，保留原文件即可'
  },
  {
    path: '.github/copilot-instructions.md',
    kind: 'AI 入口',
    advice: '该文件由 AGENTS.md 生成，不要手工维护两份'
  },
  {
    path: '.claude',
    kind: 'AI 入口',
    advice: '项目已有 Claude Code 配置目录；本模板只生成 CLAUDE.md，两处规则不要互相矛盾，冲突时以 AGENTS.md 为准'
  },
  {
    path: '.gitlab-ci.yml',
    kind: '流水线',
    advice: '在现有流水线里追加：node scripts/check-docs.mjs、node scripts/check-skills.mjs、node scripts/detect-stack.mjs --check --strict'
  },
  {
    path: 'CODEOWNERS',
    kind: '代码所有者',
    advice: '项目已有 GitLab 代码所有者文件：把模板规则并入现有文件，不要整份替换'
  },
  {
    path: '.gitlab',
    kind: '合并请求模板',
    advice: '项目已有 .gitlab/ 配置：模板内容并入 .gitlab/merge_request_templates/，不要覆盖现有模板'
  },
  {
    path: '.gitee',
    kind: '合并请求模板',
    advice: '项目已有 .gitee/ 目录：模板内容并入现有文件，保持与仓库现有模板一致，不要整份替换'
  },
  {
    path: '.workflow',
    kind: '流水线',
    advice: '项目已有 Gitee Go 流水线：在现有流水线里追加校验步骤，不要另建第二套'
  },
  {
    path: 'Jenkinsfile',
    kind: '流水线',
    advice: '在现有流水线里追加同样的校验步骤，不要另建第二套'
  },
  {
    path: '.circleci/config.yml',
    kind: '流水线',
    advice: '同上，追加校验步骤即可'
  },
  {
    path: '.husky',
    kind: '钩子',
    advice: '二选一：用本模板的 .githooks，或在 husky 里调用同样命令；两套并存会互相绕过'
  },
  {
    path: '.pre-commit-config.yaml',
    kind: '钩子',
    advice: '二选一，避免同一检查跑两遍或两边都不跑'
  },
  {
    path: 'lefthook.yml',
    kind: '钩子',
    advice: '二选一，避免双钩子'
  }
];

function parseArgs(argv) {
  const options = { target: '', dryRun: false, force: false, update: false, stacks: [], trunk: '', platform: 'auto' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') options.target = argv[++i] ?? '';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--update') options.update = true;
    else if (arg === '--trunk') options.trunk = argv[++i] ?? '';
    else if (arg === '--platform') options.platform = (argv[++i] ?? 'auto').toLowerCase();
    else if (arg === '--stack') options.stacks = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数：${arg}`);
      process.exit(1);
    }
  }
  return options;
}

/** 在目标仓库执行 git 命令，失败返回空串（非 Git 仓库或命令不支持时都走这里） */
function gitIn(target, args) {
  try {
    return execFileSync('git', ['-C', target, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

/** 识别目标仓库的主干分支，写入 workflow.config.json 供 scripts/tasks.mjs（任务占用看板）使用 */
function detectTrunk(target, explicit) {
  if (explicit) return explicit;
  const git = (args) => gitIn(target, args);
  const remoteHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead) return remoteHead.replace(/^[^/]+\//, '');

  for (const candidate of ['main', 'master', 'develop', 'int']) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])) return candidate;
  }

  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current && ['main', 'master', 'develop', 'int'].includes(current)) return current;
  return '';
}

/**
 * 代码托管平台相关产物：CI、代码所有者、合并请求模板。
 * 这三样各平台路径与语法都不同，注入哪套由 --platform 决定。
 * 产物统一存放在 templates/platform/<平台>/ 下，且**按目标项目里的相对路径**存放，
 * 例如 templates/platform/gitlab/.gitlab-ci.yml 注入到项目根的 .gitlab-ci.yml。
 * 而 CLAUDE.md、.cursor/rules、.github/copilot-instructions.md 属于 AI 工具配置，
 * 与代码托管在哪无关（Copilot 插件只认 .github/ 这个固定路径），所以不随平台切换。
 */
const PLATFORM_ENTRIES = {
  github: [
    { from: 'templates/platform/github/.github/workflows', to: '.github/workflows' },
    { from: 'templates/platform/github/.github/CODEOWNERS', to: '.github/CODEOWNERS' },
    {
      from: 'templates/platform/github/.github/PULL_REQUEST_TEMPLATE.md',
      to: '.github/PULL_REQUEST_TEMPLATE.md'
    }
  ],
  gitlab: [
    { from: 'templates/platform/gitlab/.gitlab-ci.yml', to: '.gitlab-ci.yml' },
    { from: 'templates/platform/gitlab/CODEOWNERS', to: 'CODEOWNERS' },
    { from: 'templates/platform/gitlab/.gitlab', to: '.gitlab' }
  ],
  gitee: [
    { from: 'templates/platform/gitee/.gitee', to: '.gitee' }
  ]
};

/** 平台产物几乎必然被团队改过（加自己的 CI 步骤、填真实负责人），--update 时一律不覆盖 */
const PLATFORM_KEEP = new Set([
  'CODEOWNERS',
  '.gitlab-ci.yml',
  '.gitlab',
  '.gitee',
  '.gitee/PULL_REQUEST_TEMPLATE.md',
  '.github/CODEOWNERS',
  '.github/workflows',
  '.github/PULL_REQUEST_TEMPLATE.md'
]);

/**
 * 识别代码托管平台：
 *   1. 命令行 --platform 优先；
 *   2. 文件标记（已有的 CI / 代码所有者 / 合并请求模板）与 origin 地址交叉判断，
 *      两者冲突时以 origin 为准——远程地址才代表项目真正的归属；
 *   3. 只有文件标记时按 GitLab → Gitee → GitHub 的顺序取第一个；
 *   4. 都识别不出时默认 GitLab（企业内网最常见），并在输出里说明怎么纠正。
 */
async function detectPlatform(target, explicit) {
  if (explicit && explicit !== 'auto') {
    return { id: explicit, reason: '命令行指定' };
  }

  const markers = [];
  if ((await exists(path.join(target, '.gitlab-ci.yml'))) || (await isDirectory(path.join(target, '.gitlab')))) {
    markers.push({ id: 'gitlab', why: '已有 .gitlab-ci.yml 或 .gitlab/' });
  }
  if ((await exists(path.join(target, '.gitee'))) || (await isDirectory(path.join(target, '.workflow')))) {
    markers.push({ id: 'gitee', why: '已有 .gitee/ 或 .workflow/' });
  }
  if ((await isDirectory(path.join(target, '.github', 'workflows'))) || (await exists(path.join(target, '.github', 'CODEOWNERS')))) {
    markers.push({ id: 'github', why: '已有 .github/workflows 或 .github/CODEOWNERS' });
  }

  const remote = gitIn(target, ['remote', 'get-url', 'origin']).toLowerCase();
  const fromRemote = remote.includes('gitlab')
    ? 'gitlab'
    : remote.includes('gitee')
      ? 'gitee'
      : remote.includes('github')
        ? 'github'
        : '';

  if (fromRemote) {
    const matched = markers.find((marker) => marker.id === fromRemote);
    if (matched) return { id: matched.id, reason: `${matched.why}，与 origin 一致（${remote}）` };
    if (markers.length > 0) {
      const other = markers[0].id;
      return {
        id: fromRemote,
        reason: `origin 地址：${remote}（仓库里另有 ${markers.map((marker) => marker.id).join(' / ')} 的产物，如需沿用请加 --platform ${other}）`
      };
    }
    return { id: fromRemote, reason: `origin 地址：${remote}` };
  }

  if (markers.length > 0) {
    return { id: markers[0].id, reason: `${markers[0].why}（未配置 origin，按文件标记判断）` };
  }

  return { id: 'gitlab', reason: '未识别出托管平台，默认 GitLab；若用 GitHub / Gitee 请加 --platform' };
}

/** 项目侧 package.json：只提供校验入口，不写 type 字段，避免改变项目已有 .js 文件的模块语义 */
async function renderProjectPackage(target) {
  const template = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const name = path.basename(target).toLowerCase().replace(/[^a-z0-9-_.]/g, '-');
  return `${JSON.stringify({
    name: name || 'project',
    private: true,
    description: 'AI 工作流校验入口，由 hqc-ai-coding-work-flow 模板生成',
    scripts: template.scripts,
    engines: template.engines
  }, null, 2)}\n`;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(source) {
  const result = [];
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(source, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      result.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** 接入体检：项目里已有哪些约定，需要人工融合而不是覆盖 */
const TEMPLATE_WORKFLOWS = new Set(['docs-guard.yml', 'standards.yml']);

/** 带生成标记的入口文件由模板维护，不属于项目既有约定 */
async function isTemplateGenerated(full) {
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) return false;
  const content = await readFile(full, 'utf8').catch(() => '');
  return content.includes('本文件由 node scripts/sync-agent-config.mjs 生成');
}

async function inspectExisting(target) {
  const items = [];

  for (const item of FUSION_TARGETS) {
    const full = path.join(target, item.path);
    if (!(await exists(full))) continue;
    // 模板自己生成的入口文件不算「项目既有约定」，否则重跑时会把上一轮的产物报成历史包袱
    if (await isTemplateGenerated(full)) continue;
    items.push({ ...item });
  }

  const workflows = path.join(target, '.github', 'workflows');
  if (await isDirectory(workflows)) {
    const files = (await readdir(workflows).catch(() => []))
      .filter((name) => /\.ya?ml$/.test(name) && !TEMPLATE_WORKFLOWS.has(name));
    if (files.length > 0 && !items.some((item) => item.kind === '流水线')) {
      items.push({
        path: `.github/workflows（已有 ${files.length} 个文件）`,
        kind: '流水线',
        advice: '把校验步骤追加到现有工作流，不要新建第二套流水线'
      });
    }
  }

  const pkgPath = path.join(target, 'package.json');
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const templateValidate = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).scripts?.validate;
      if (pkg.scripts?.validate && pkg.scripts.validate !== templateValidate) {
        items.push({
          path: 'package.json 的 scripts.validate',
          kind: '命令',
          advice: '项目已有 validate，请把 docs、skills、stacks 三项检查合并进去，不要覆盖原有内容'
        });
      }
    } catch {
      // 无法解析的 package.json 跳过，不影响注入
    }
  }

  for (const nested of await inspectNestedAiConfig(target)) items.push(nested);

  return items;
}

/** 子项目里的 AI 工具配置：模板不接管，但要在融合清单里点出来，避免两套规则互相矛盾 */
async function inspectNestedAiConfig(target) {
  const items = [];
  const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!(await isDirectory(path.join(target, entry.name, '.claude')))) continue;
    items.push({
      path: `${entry.name}/.claude`,
      kind: 'AI 入口',
      advice: '子项目已有 Claude Code 配置；规则以本仓库 AGENTS.md 为准，避免两处描述冲突'
    });
  }
  return items;
}

/** 文档门禁口径，与 scripts/check-docs.mjs 的 E101 保持一致 */
const CJK_RATIO_MIN = 0.1;
const CJK_MIN_CHARS = 20;

function needsLanguageExempt(content) {
  const cjk = (content.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (content.match(/[A-Za-z]/g) ?? []).length;
  if (cjk + latin < CJK_MIN_CHARS) return false;
  return cjk / (cjk + latin) < CJK_RATIO_MIN;
}

function needsNamingExempt(relative) {
  if (!/^docs\/[^/]+$/.test(relative)) return false;
  const base = path.basename(relative);
  return !(/^\d{2}-.+\.md$/.test(base) || /^[A-Z0-9_-]+\.md$/.test(base) || base === 'README.md');
}

/**
 * 接入豁免清单：项目里已有的 Markdown 若不符合「中文主语言」或「docs 命名」规范，
 * 登记到 workflow.config.json 后只降级这两类提示，历史文档不会卡住首次接入。
 * 同一目录命中 3 篇以上折叠成 dir/**，避免清单过长。
 */
async function scanLegacyDocs(target) {
  const managed = await collectManagedDocs();
  const hits = [];

  for (const file of await collectFiles(target)) {
    const relative = path.relative(target, file).split(path.sep).join('/');
    if (!/\.(md|markdown)$/i.test(relative)) continue;
    if (managed.has(relative)) continue;

    const content = await readFile(file, 'utf8').catch(() => '');
    if (needsLanguageExempt(content) || needsNamingExempt(relative)) hits.push(relative);
  }

  return collapseByDir(hits.sort());
}

/** 模板托管的 Markdown：这些文件按模板规范从严校验，不进豁免清单 */
async function collectManagedDocs() {
  const managed = new Set();
  for (const entry of ENTRY_LIST) {
    const source = path.join(ROOT, entry.from);
    if (!(await exists(source))) continue;
    if (await isDirectory(source)) {
      for (const file of await collectFiles(source)) {
        const relative = path.relative(source, file).split(path.sep).join('/');
        managed.add(`${entry.to}/${relative}`);
      }
    } else {
      managed.add(entry.to);
    }
  }
  return managed;
}

function collapseByDir(list) {
  const counts = new Map();
  for (const item of list) {
    const dir = path.posix.dirname(item);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }

  const collapsed = [];
  const usedDirs = new Set();
  for (const item of list) {
    const dir = path.posix.dirname(item);
    if (counts.get(dir) >= 3) {
      if (usedDirs.has(dir)) continue;
      usedDirs.add(dir);
      collapsed.push(`${dir}/**`);
    } else {
      collapsed.push(item);
    }
  }
  return collapsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.target) {
    console.log('用法：node scripts/bootstrap.mjs --target <目标项目路径> [--dry-run] [--force] [--stack auto|none|<技术栈 id 列表>] [--trunk <主干分支>]');
    console.log('  技术栈默认 auto：自动探测项目用到的栈；none：跳过探测；也可显式指定，例如 java-springboot,vue3');
    console.log('  --update：模板已迭代，把托管文件刷新到最新版；已存在的 .env.example 与人工填写过的内容不动');
    console.log('  --platform：代码托管平台，github | gitlab | gitee | auto（默认自动识别，识别不出按 gitlab）');
    process.exit(options.help ? 0 : 1);
  }

  const target = path.resolve(process.cwd(), options.target);
  if (target === ROOT) {
    console.error('目标目录与模板仓库相同，已终止。请指定业务项目路径。');
    process.exit(1);
  }
  if (!(await exists(target))) {
    console.error(`目标目录不存在：${target}`);
    process.exit(1);
  }
  if (await exists(path.join(target, '.git')) === false) {
    console.log(`提示：${target} 看起来不是 Git 仓库，仍会继续注入文件。`);
  }

  const created = [];
  const skipped = [];
  const platformKept = [];
  const warnings = [];

  let platform = await detectPlatform(target, options.platform);
  if (!PLATFORM_ENTRIES[platform.id]) {
    warnings.push(`未知平台 ${platform.id}，可选 github / gitlab / gitee；本次改为自动探测`);
    platform = await detectPlatform(target, 'auto');
  }

  // 融合体检必须放在写入之前：否则模板刚注入的文件会被误判成「项目既有约定」。
  // --update 是已接入项目的刷新，接入期早就处理过融合项，重复体检只会产生噪音。
  const fusion = options.update ? [] : await inspectExisting(target);

  for (const entry of [...ENTRY_LIST, ...(PLATFORM_ENTRIES[platform.id] ?? [])]) {
    const source = path.join(ROOT, entry.from);
    if (!(await exists(source))) {
      warnings.push(`模板文件缺失，已跳过：${entry.from}`);
      continue;
    }

    const isDir = await isDirectory(source);
    const files = isDir ? await collectFiles(source) : [source];
    for (const file of files) {
      const relative = isDir ? path.relative(source, file) : '';
      const destination = relative ? path.join(target, entry.to, relative) : path.join(target, entry.to);
      const display = path.relative(target, destination).split(path.sep).join('/');

      const destinationExists = await exists(destination);
      const overwrite = options.force
        || (options.update && !FUSION_KEEP.has(entry.to) && !PLATFORM_KEEP.has(entry.to));
      if (destinationExists && !overwrite) {
        // 平台产物在 --update 时被刻意保留（团队会改 CI 与负责人），单独列出避免与「已存在未覆盖」混淆
        if (options.update && PLATFORM_KEEP.has(entry.to)) {
          platformKept.push(display);
        } else {
          skipped.push(display);
        }
        continue;
      }

      if (destinationExists && options.update && !options.force && CUSTOMIZABLE.has(display)) {
        if (await looksCustomized(target, display)) {
          skipped.push(`${display}（已定制，保留项目版本）`);
          continue;
        }
      }

      if (options.dryRun) {
        created.push(`${display}${destinationExists ? '（将覆盖）' : ''}`);
        continue;
      }

      await mkdir(path.dirname(destination), { recursive: true });
      await cp(file, destination);
      created.push(display);
    }
  }

  // .gitignore 单独处理：已存在时不覆盖，改写入 .gitignore.workflow
  const gitignoreSource = path.join(ROOT, '.gitignore');
  const gitignoreTarget = path.join(target, '.gitignore');
  if (await exists(gitignoreSource)) {
    if (await exists(gitignoreTarget)) {
      if (options.update) {
        // 已接入项目的刷新：不重复生成待合并文件，缺规则时由门禁兜底
        skipped.push('.gitignore');
      } else {
        const extra = path.join(target, '.gitignore.workflow');
        if (!options.dryRun) {
          await cp(gitignoreSource, extra);
        }
        warnings.push('目标已存在 .gitignore，未覆盖；模板规则写入 .gitignore.workflow，请手动合并后删除该文件');
        created.push('.gitignore.workflow');
      }
    } else if (options.dryRun) {
      created.push('.gitignore');
    } else {
      await cp(gitignoreSource, gitignoreTarget);
      created.push('.gitignore');
    }
  }

  // .gitattributes 单独处理：换行规则必须合并，否则 .githooks 在 Linux / macOS 上会因 CRLF 失效
  const attrSource = path.join(ROOT, '.gitattributes');
  const attrTarget = path.join(target, '.gitattributes');
  if (await exists(attrSource)) {
    if (await exists(attrTarget)) {
      if (options.update) {
        skipped.push('.gitattributes');
      } else {
        const extra = path.join(target, '.gitattributes.workflow');
        if (!options.dryRun) {
          await cp(attrSource, extra);
        }
        warnings.push('目标已存在 .gitattributes，未覆盖；模板规则写入 .gitattributes.workflow。必须合并：缺少 .githooks/* eol=lf 时，core.autocrlf=true 的机器会把钩子脚本转成 CRLF，钩子在 Linux / macOS 上直接失效');
        created.push('.gitattributes.workflow');
      }
    } else if (options.dryRun) {
      created.push('.gitattributes');
    } else {
      await cp(attrSource, attrTarget);
      created.push('.gitattributes');
    }
  }

  // package.json：模板的校验入口是 npm script。项目没有就生成一份，已有就另存待合并，绝不覆盖
  const pkgSource = path.join(ROOT, 'package.json');
  const pkgTarget = path.join(target, 'package.json');
  if (await exists(pkgSource)) {
    if (await exists(pkgTarget)) {
      if (options.update) {
        skipped.push('package.json');
      } else {
        const extra = path.join(target, '.package.json.workflow');
        if (!options.dryRun) {
          await cp(pkgSource, extra);
        }
        warnings.push('目标已存在 package.json，未覆盖；模板校验脚本写入 .package.json.workflow，请把 scripts 合并进现有文件后删除该文件');
        created.push('.package.json.workflow');
      }
    } else if (options.dryRun) {
      created.push('package.json');
    } else {
      await writeFile(pkgTarget, await renderProjectPackage(target), 'utf8');
      created.push('package.json');
    }
  }

  // ---- 技术栈体检：探测 → 分成三类 → 生成配置与项目侧登记表 ----
  const { registry } = await loadRegistry(ROOT);
  for (const item of validateRegistry(registry)) {
    warnings.push(`技术栈登记表有问题：${item.message}（见 stacks/README.md）`);
  }

  const manual = options.stacks.filter((id) => id !== 'auto' && id !== 'none');
  const wantsDetect = !options.stacks.includes('none');

  let enabled = [];
  let available = [];
  let gaps = [];

  if (wantsDetect) {
    const context = await buildContext(target, await scanTarget(target));
    const detected = classify(registry, context);
    enabled = [...detected.enabled];
    available = detected.available;
    gaps = detected.gaps;
  }

  for (const id of manual) {
    const stack = (registry.stacks ?? []).find((item) => item.id === id);
    if (!stack) {
      warnings.push(`未知技术栈标识：${id}；可用值见 stacks/registry.json`);
      continue;
    }
    if (enabled.some((item) => item.id === id)) continue;
    enabled.push({ ...stack, evidence: ['命令行指定'] });
    available = available.filter((item) => item.id !== id);
  }

  let legacyDocs = await scanLegacyDocs(target);
  const previousConfigPath = path.join(target, 'workflow.config.json');
  let aiEntries = [...AI_ENTRY_KEYS];
  if ((await exists(previousConfigPath)) && !options.force) {
    // 用户可能手工增删过豁免清单或 AI 入口清单，非 --force 时保留既有内容，避免每次重跑都被覆盖
    try {
      const previous = JSON.parse(await readFile(previousConfigPath, 'utf8'));
      if (Array.isArray(previous.legacyDocs)) legacyDocs = previous.legacyDocs.map(String);
      if (Array.isArray(previous.aiEntries)) {
        aiEntries = AI_ENTRY_KEYS.filter((key) => previous.aiEntries.map(String).includes(key));
      }
    } catch {
      // 旧配置读不动时按本次扫描结果写入
    }
  }

  const config = {
    template: 'hqc-ai-coding-work-flow',
    generatedAt: new Date().toISOString().slice(0, 10),
    trunkBranch: detectTrunk(target, options.trunk),
    platform: platform.id,
    legacyDocs,
    aiEntries,
    stacks: enabled.map((stack) => stack.id),
    availableStacks: available.map((stack) => stack.id),
    stackGaps: gaps.map((stack) => ({
      id: stack.id,
      name: stack.name,
      slot: stack.slot,
      evidence: stack.evidence
    })),
    suggestedValidate: Object.fromEntries(enabled.map((stack) => [stack.id, stack.validate]))
  };

  const configPath = path.join(target, 'workflow.config.json');
  if (options.dryRun) {
    created.push('workflow.config.json');
  } else {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    created.push('workflow.config.json');
  }

  if (legacyDocs.length > 0) {
    fusion.push({
      path: `项目历史文档 ${legacyDocs.length} 项`,
      kind: '文档基线',
      advice: '已登记接入豁免，不阻塞文档门禁；建议随迭代迁移为中文正文与规范命名，清单见 workflow.config.json 的 legacyDocs'
    });
  }

  const techStackPath = path.join(target, 'docs', 'TECH_STACK.md');
  const techStackDoc = renderTechStackDoc({
    generatedAt: config.generatedAt,
    trunkBranch: config.trunkBranch,
    enabled,
    available,
    gaps,
    fusion
  });

  if ((await exists(techStackPath)) && !options.force) {
    if (options.update) {
      // 记录文件可能已被人填过负责人与期限，不直接覆盖，但要能发现「探测结果变了」这件事
      const current = await readFile(techStackPath, 'utf8');
      if (current.trim() !== techStackDoc.trim()) {
        warnings.push('docs/TECH_STACK.md 与本次探测结果不一致：请手动更新对应表格，或用 --force 重新生成（缺口表的负责人与期限需要重填）');
      }
    }
    skipped.push('docs/TECH_STACK.md');
  } else if (options.dryRun) {
    created.push(`docs/TECH_STACK.md${(await exists(techStackPath)) ? '（将覆盖）' : ''}`);
  } else {
    await mkdir(path.dirname(techStackPath), { recursive: true });
    await writeFile(techStackPath, techStackDoc, 'utf8');
    created.push('docs/TECH_STACK.md');
  }

  // 按目标项目自己的 AGENTS.md 重新生成各 AI 工具入口，否则注入后 CI 会立刻失败
  const synced = [];
  if (!options.dryRun) {
    const syncScript = path.join(target, 'scripts', 'sync-agent-config.mjs');
    if (await exists(syncScript)) {
      try {
        const output = execFileSync(process.execPath, [syncScript], {
          cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
        });
        for (const line of output.split(/\r?\n/).filter(Boolean)) synced.push(line);
      } catch {
        warnings.push('未能自动生成 AI 工具入口，请手动运行：node scripts/sync-agent-config.mjs');
      }
    }
  } else {
    synced.push(
      `预览模式不写文件：正式执行会按 AGENTS.md 生成 AI 工具入口，清单见 workflow.config.json 的 aiEntries（默认 ${AI_ENTRY_KEYS.join('、')}）`
    );
  }

  console.log(options.dryRun ? '预览模式（未写入任何文件）' : options.update ? '模板更新完成' : '注入完成');
  console.log(`目标项目：${target}`);
  console.log(`模板来源：${ROOT}`);
  console.log(`托管平台：${platform.id}（${platform.reason}）`);
  console.log('');
  console.log(`${options.dryRun ? '将写入' : '已更新'} ${created.length} 个文件：`);
  for (const item of created) console.log(`  + ${item}`);

  console.log('');
  console.log('技术栈体检（口径见 docs/10-技术栈适配.md）：');
  console.log(`  已启用 ${enabled.length}：${enabled.map((stack) => stack.id).join('、') || '无'}`);
  console.log(`  装箱未启用 ${available.length}：${available.map((stack) => stack.id).join('、') || '无'}（规范留库，不注入阅读顺序、不进 CI）`);
  console.log(`  缺口 ${gaps.length}：${gaps.map((stack) => `${stack.name}（${stack.evidence.join('、')}）`).join('；') || '无'}`);
  if (gaps.length > 0) {
    console.log('  → 缺口按 docs/10-技术栈适配.md 第三节补最小规范，登记后转正');
  }

  if (fusion.length > 0) {
    console.log('');
    console.log(`接入融合清单（已有约定不覆盖，共 ${fusion.length} 项，已写入 docs/TECH_STACK.md）：`);
    for (const item of fusion) console.log(`  · [${item.kind}] ${item.path} —— ${item.advice}`);
  }

  if (synced.length > 0) {
    console.log('');
    console.log(options.dryRun ? 'AI 工具入口（预览）：' : '已按目标项目的 AGENTS.md 生成 AI 工具入口：');
    for (const item of synced) console.log(`  ~ ${item}`);
  }
  if (skipped.length > 0) {
    console.log('');
    console.log(`已存在，跳过 ${skipped.length} 个文件（--update 刷新托管文件，--force 全部覆盖）：`);
    for (const item of skipped) console.log(`  = ${item}`);
  }
  if (platformKept.length > 0) {
    console.log('');
    console.log(`平台产物保持原样 ${platformKept.length} 个（团队必然会改，--update 不覆盖；确需重置用 --force）：`);
    for (const item of platformKept) console.log(`  = ${item}`);
  }
  if (warnings.length > 0) {
    console.log('');
    console.log('注意：');
    for (const item of warnings) console.log(`  ! ${item}`);
  }

  if (!options.dryRun) {
    console.log('');
    console.log('下一步：');
    console.log('  1. 阅读 docs/08-接入清单.md，逐项完成定制');
    console.log('  2. 确认 workflow.config.json 的 trunkBranch 是真正的主干分支（例如 int / develop），任务看板依赖它');
    console.log('  3. 修改 AGENTS.md 中的项目概览、模块划分与命令索引');
    const ownerHint =
      platform.id === 'gitee'
        ? '在仓库设置里指定评审人（Gitee 不支持 CODEOWNERS），并核对 .gitee/PULL_REQUEST_TEMPLATE.md'
        : `修改 ${platform.id === 'gitlab' ? 'CODEOWNERS' : '.github/CODEOWNERS'} 中的负责人`;
    console.log(`  4. ${ownerHint}`);
    console.log('  5. 安装 Git 钩子：bash scripts/install-hooks.sh（或 pwsh scripts/install-hooks.ps1）');
    console.log('  6. 补全 docs/TECH_STACK.md 里的负责人与期限（缺口未认领等于没接入）');
    console.log('  7. 运行自检：npm run validate 与 node scripts/detect-stack.mjs --check');
    console.log('  8. 团队不用的 AI 工具：在 workflow.config.json 的 aiEntries 里去掉后重跑 sync-agent-config.mjs，不留空目录');
  }
}

main().catch((error) => {
  console.error('注入失败：', error);
  process.exit(1);
});
