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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'build', 'coverage', '.cache']);

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
  { from: '.github', to: '.github' },
  { from: '.editorconfig', to: '.editorconfig' },
  { from: '.gitattributes', to: '.gitattributes' },
  { from: '.tasksignore', to: '.tasksignore' },
  { from: 'skills-lock.json', to: 'skills-lock.json' }
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
    path: '.gitlab-ci.yml',
    kind: '流水线',
    advice: '在现有流水线里追加：node scripts/check-docs.mjs、node scripts/check-skills.mjs、node scripts/detect-stack.mjs --check --strict'
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
  const options = { target: '', dryRun: false, force: false, stacks: [], trunk: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') options.target = argv[++i] ?? '';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--trunk') options.trunk = argv[++i] ?? '';
    else if (arg === '--stack') options.stacks = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数：${arg}`);
      process.exit(1);
    }
  }
  return options;
}

/** 识别目标仓库的主干分支，写入 workflow.config.json 供 scripts/tasks.mjs（任务占用看板）使用 */
function detectTrunk(target, explicit) {
  if (explicit) return explicit;
  const git = (args) => {
    try {
      return execFileSync('git', ['-C', target, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {
      return '';
    }
  };
  const remoteHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead) return remoteHead;
  for (const candidate of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  return '';
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
async function inspectExisting(target) {
  const items = [];

  for (const item of FUSION_TARGETS) {
    if (await exists(path.join(target, item.path))) items.push({ ...item });
  }

  const workflows = path.join(target, '.github', 'workflows');
  if (await isDirectory(workflows)) {
    const files = (await readdir(workflows).catch(() => [])).filter((name) => /\.ya?ml$/.test(name));
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
      if (pkg.scripts?.validate) {
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

  return items;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.target) {
    console.log('用法：node scripts/bootstrap.mjs --target <目标项目路径> [--dry-run] [--force] [--stack auto|none|<技术栈 id 列表>] [--trunk <主干分支>]');
    console.log('  技术栈默认 auto：自动探测项目用到的栈；none：跳过探测；也可显式指定，例如 java-springboot,vue3');
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
  const warnings = [];

  for (const entry of ENTRY_LIST) {
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
      if (destinationExists && !options.force) {
        skipped.push(display);
        continue;
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
      const extra = path.join(target, '.gitignore.workflow');
      if (!options.dryRun) {
        await cp(gitignoreSource, extra);
      }
      warnings.push('目标已存在 .gitignore，未覆盖；模板规则写入 .gitignore.workflow，请手动合并后删除该文件');
      created.push('.gitignore.workflow');
    } else if (options.dryRun) {
      created.push('.gitignore');
    } else {
      await cp(gitignoreSource, gitignoreTarget);
      created.push('.gitignore');
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

  const config = {
    template: 'hqc-ai-coding-work-flow',
    generatedAt: new Date().toISOString().slice(0, 10),
    trunkBranch: detectTrunk(target, options.trunk),
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

  const fusion = await inspectExisting(target);
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
  }

  console.log(options.dryRun ? '预览模式（未写入任何文件）' : '注入完成');
  console.log(`目标项目：${target}`);
  console.log(`模板来源：${ROOT}`);
  console.log('');
  console.log(`将写入 ${created.length} 个文件：`);
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
    console.log('已按目标项目的 AGENTS.md 生成 AI 工具入口：');
    for (const item of synced) console.log(`  ~ ${item}`);
  }
  if (skipped.length > 0) {
    console.log('');
    console.log(`已存在，跳过 ${skipped.length} 个文件（使用 --force 可覆盖）：`);
    for (const item of skipped) console.log(`  = ${item}`);
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
    console.log('  4. 修改 .github/CODEOWNERS 中的负责人');
    console.log('  5. 安装 Git 钩子：bash scripts/install-hooks.sh（或 pwsh scripts/install-hooks.ps1）');
    console.log('  6. 补全 docs/TECH_STACK.md 里的负责人与期限（缺口未认领等于没接入）');
    console.log('  7. 运行自检：npm run validate 与 node scripts/detect-stack.mjs --check');
  }
}

main().catch((error) => {
  console.error('注入失败：', error);
  process.exit(1);
});
