#!/usr/bin/env node
/**
 * 任务归属与文件占用看板
 *
 * 完全从 Git 事实推导（分支、作者、近期改动文件），不维护手工台账——
 * 手写台账有两个致命问题：多人同时改会冲突，且没有人愿意持续维护。
 *
 * 统计口径（很重要）：
 *   统计「最近 N 天内该分支**自身**提交所触及的文件」，等价于 git log --since=N --not <主干>。
 *   少了 --since，分支的历史差异会全被算成本次改动；少了 --not，主干已有提交会被算进每个分支。
 *   两者都是误报来源，缺一不可。
 *
 * 主干分支：优先读仓库根 workflow.config.json 的 trunkBranch（scripts/bootstrap.mjs 会写入），
 *   其次按 origin/main、origin/master、main、master 探测，也可用 --base 显式指定。
 *   单分支自身改动超过 200 个文件时，判定为长命 / 严重分叉分支并排除在重叠分析之外。
 *
 * 用法：
 *   node scripts/tasks.mjs                    # 查看活跃分支与文件占用
 *   node scripts/tasks.mjs --check            # 检查当前分支是否与他人重叠
 *   node scripts/tasks.mjs --check --strict   # 有代码文件重叠时以非零码退出（可用在 CI）
 *   node scripts/tasks.mjs --active-days 3    # 只看最近 3 天有提交的分支
 *   node scripts/tasks.mjs --ignore "int"     # 排除长命共享分支（也可写进 .tasksignore）
 *   node scripts/tasks.mjs --base origin/int  # 真正的主干不是 master 时显式指定
 *   node scripts/tasks.mjs --json             # 机器可读输出（含完整重叠列表）
 *
 * 说明：
 *   - 「谁在开发」来自分支的作者信息，无需额外登记。
 *   - 这是**协调提示**，不是质量门禁：发现重叠的正确动作是沟通，不是拒绝提交。
 *
 * 协调规则见 docs/02-团队协作与角色.md。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master'];
const DEFAULT_ACTIVE_DAYS = 14;
const TRUNK_NAMES = new Set(['main', 'master', 'develop', 'dev', 'HEAD']);
const MAX_PRINT_PER_GROUP = 15;

/** 单分支「自身改动」超过该文件数，视为长命 / 严重分叉分支：通常是基线选错，或分支寿命过长 */
const DIVERGED_FILE_THRESHOLD = 200;

/** 低风险路径：文档与配置，重叠时通常不需要协调 */
const LOW_RISK_PATTERNS = [
  /^docs\//,
  /^spec\//,
  /^skills\//,
  /^\.agents\//,
  /^\.claude\//,
  /^\.cursor\//,
  /^\.github\//,
  /^\.gitee\//,
  /^CHANGELOG\.md$/,
  /^README\.md$/,
  /^package(-lock)?\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^\.editorconfig$/,
  /^logs?\//,
  /^\.run-logs\//,
  /^\.env/
];

function parseArgs(argv) {
  const options = { check: false, strict: false, json: false, activeDays: DEFAULT_ACTIVE_DAYS, base: '', ignore: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--base') options.base = argv[++i] ?? '';
    else if (arg === '--active-days') options.activeDays = Number(argv[++i] ?? DEFAULT_ACTIVE_DAYS);
    else if (arg === '--ignore') options.ignore.push(argv[++i] ?? '');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数：${arg}`);
      process.exit(1);
    }
  }
  return options;
}

function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function lines(text) {
  return (text ?? '').split(/\r?\n/).filter(Boolean);
}

/** 读取 workflow.config.json 中配置的主干分支（由 scripts/bootstrap.mjs 生成） */
function configuredTrunk() {
  const top = tryGit(['rev-parse', '--show-toplevel']);
  if (!top) return '';
  try {
    const config = JSON.parse(readFileSync(path.join(top, 'workflow.config.json'), 'utf8'));
    return typeof config.trunkBranch === 'string' ? config.trunkBranch.trim() : '';
  } catch {
    return '';
  }
}

function resolveBase(explicit) {
  if (explicit) return explicit;
  const configured = configuredTrunk();
  if (configured) {
    if (tryGit(['rev-parse', '--verify', '--quiet', configured])) return configured;
    console.error(`提示：workflow.config.json 配置的主干分支「${configured}」不存在，改用默认候选。`);
  }
  for (const candidate of DEFAULT_BASE_CANDIDATES) {
    if (tryGit(['rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  return null;
}

function isLowRisk(file) {
  return LOW_RISK_PATTERNS.some((pattern) => pattern.test(file));
}

function isMergedInto(branch, base) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', branch, base], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 读取需要排除的分支规则：来自 --ignore 与仓库根的 .tasksignore */
function loadIgnoreRules(cliValues) {
  const raw = [...cliValues];
  const top = tryGit(['rev-parse', '--show-toplevel']);
  if (top) {
    try {
      raw.push(...readFileSync(path.join(top, '.tasksignore'), 'utf8').split(/\r?\n/));
    } catch {
      // 没有 .tasksignore 属正常情况
    }
  }

  return raw
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const escaped = line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`);
    });
}

function matchesIgnore(shortName, rules) {
  return rules.some((rule) => rule.test(shortName));
}

/** 收集候选分支：优先远程分支；本地分支仅在未推送时纳入，避免同名重复 */
function collectBranches(base, ignoreRules) {
  const remoteShortNames = new Set();
  const result = new Set();
  const ignored = [];

  for (const line of lines(tryGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes']))) {
    if (line.endsWith('/HEAD')) continue;
    const short = line.replace(/^origin\//, '');
    if (TRUNK_NAMES.has(short)) continue;
    if (matchesIgnore(short, ignoreRules)) {
      ignored.push(short);
      continue;
    }
    remoteShortNames.add(short);
    result.add(line);
  }

  for (const line of lines(tryGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']))) {
    if (TRUNK_NAMES.has(line) || line === base) continue;
    if (matchesIgnore(line, ignoreRules)) {
      ignored.push(line);
      continue;
    }
    if (remoteShortNames.has(line)) continue;
    result.add(line);
  }

  return { branches: [...result], ignored: [...new Set(ignored)] };
}

/** 生成 `--not <base>` 参数：排除主干已包含的提交，避免共享基线被算成本分支的改动 */
function excludeBase(branch, base) {
  return base && base !== branch ? ['--not', base] : [];
}

/** 最近 days 天内该分支「自身」改动过的文件 */
function recentFiles(branch, days, base = '') {
  const output = tryGit([
    'log', `--since=${days} days ago`, '--name-only', '--format=', '--no-merges', branch,
    ...excludeBase(branch, base)
  ]);
  return [...new Set(lines(output))];
}

function authorsSince(branch, days, base = '') {
  const output = tryGit([
    'log', `--since=${days} days ago`, '--format=%an', '--no-merges', branch,
    ...excludeBase(branch, base)
  ]);
  return [...new Set(lines(output))];
}

function describeBranch(branch, days, base = '') {
  const files = recentFiles(branch, days, base);
  if (files.length === 0) return null;

  const specMatch = files.map((file) => file.match(/^spec\/(\d{8}-[^/]+)\//)).find(Boolean);
  const lastDate = tryGit(['log', '-1', '--format=%ad', '--date=short', branch]) ?? '';

  return {
    branch,
    authors: authorsSince(branch, days, base),
    lastAuthor: tryGit(['log', '-1', '--format=%an', branch]) ?? '未知',
    lastDate,
    lastSubject: tryGit(['log', '-1', '--format=%s', branch]) ?? '',
    fileCount: files.length,
    files,
    topic: specMatch ? specMatch[1] : ''
  };
}

/** 找出被两个及以上分支同时改动的文件 */
function findOverlaps(tasks) {
  const owners = new Map();
  for (const task of tasks) {
    for (const file of task.files) {
      const list = owners.get(file) ?? [];
      list.push(task.branch);
      owners.set(file, list);
    }
  }

  const high = [];
  const low = [];
  for (const [file, branches] of owners) {
    if (branches.length < 2) continue;
    (isLowRisk(file) ? low : high).push({ file, branches });
  }

  const byFile = (a, b) => a.file.localeCompare(b.file);
  high.sort(byFile);
  low.sort(byFile);
  return { high, low };
}

/** 指定文件集合与其他分支的重叠 */
function overlapsWith(files, selfBranch, others) {
  const mine = new Set(files);
  const high = [];
  const low = [];

  for (const task of others) {
    for (const file of task.files) {
      if (!mine.has(file)) continue;
      (isLowRisk(file) ? low : high).push({ file, branches: [selfBranch, task.branch] });
    }
  }

  const byFile = (a, b) => a.file.localeCompare(b.file);
  high.sort(byFile);
  low.sort(byFile);
  return { high, low };
}

function printGroup(title, entries, note) {
  if (entries.length === 0) return;
  console.log(title);
  for (const entry of entries.slice(0, MAX_PRINT_PER_GROUP)) {
    console.log(`  ${entry.file}`);
    console.log(`    涉及分支：${entry.branches.join('、')}`);
  }
  if (entries.length > MAX_PRINT_PER_GROUP) {
    console.log(`  …另有 ${entries.length - MAX_PRINT_PER_GROUP} 处，使用 --json 查看完整列表`);
  }
  if (note) console.log(note);
  console.log('');
}

/** 拆分出长命 / 严重分叉分支，把它们排除在重叠分析之外，避免输出被噪声淹没 */
function splitDiverged(tasks) {
  return {
    active: tasks.filter((task) => task.fileCount < DIVERGED_FILE_THRESHOLD),
    diverged: tasks.filter((task) => task.fileCount >= DIVERGED_FILE_THRESHOLD)
  };
}

function printDiverged(diverged) {
  if (diverged.length === 0) return;
  console.log(`⚠️  ${diverged.length} 个分支自身改动超过 ${DIVERGED_FILE_THRESHOLD} 个文件，已排除在重叠分析之外：`);
  for (const task of diverged) {
    console.log(`  ${task.branch}（${task.fileCount} 个文件）`);
  }
  console.log('  常见原因：对比基线选错（真正的主干可能是 int / develop 而非 master），或分支寿命过长。');
  console.log('  处理方式：用 --base <真正的主干> 重新分析；确认是长命共享分支后写进 .tasksignore。');
  console.log('');
}

function printBoard(tasks, base, days, overlaps, diverged = []) {
  console.log('任务占用看板');
  console.log('='.repeat(72));
  console.log(`对比基线：${base}`);
  console.log(`统计口径：最近 ${days} 天内该分支自身的提交所触及的文件（已排除基线已有提交）`);
  console.log(`活跃分支：${tasks.length} 个`);
  console.log('');
  printDiverged(diverged);

  if (tasks.length === 0) {
    console.log('当前没有进行中的分支：全部工作已合并，或尚未开始。');
    return;
  }

  console.log('分支 / 负责人 / 最近提交 / 改动范围');
  console.log('-'.repeat(72));
  for (const task of tasks) {
    const owner = task.authors.length > 1
      ? `${task.authors.slice(0, 3).join('、')} 等 ${task.authors.length} 人`
      : (task.lastAuthor || '未知');
    console.log(`● ${task.branch}`);
    console.log(`  负责人：${owner}`);
    console.log(`  最近提交：${task.lastDate}  ${task.lastSubject}`);
    if (task.topic) console.log(`  需求主题：${task.topic}`);
    console.log(`  近期改动文件：${task.fileCount} 个`);
    console.log('');
  }

  console.log('文件占用分析');
  console.log('-'.repeat(72));

  if (overlaps.high.length === 0) {
    console.log('✅ 未发现多个分支同时改动同一批代码文件。');
    if (overlaps.low.length > 0) {
      console.log(`提示：文档 / 配置重叠 ${overlaps.low.length} 处，合并时留意即可（用 --json 查看）。`);
    }
    return;
  }

  printGroup(
    `⚠️  代码文件重叠 ${overlaps.high.length} 处（需要沟通）：`,
    overlaps.high,
    ''
  );
  if (overlaps.low.length > 0) {
    console.log(`提示：文档 / 配置重叠 ${overlaps.low.length} 处（通常无需协调）。`);
    console.log('');
  }

  console.log('建议动作：');
  console.log('  1. 按文件划分边界：谁改哪个文件，写进各自的需求目录；');
  console.log('  2. 存在调用关系时接口先行：先提交签名与数据结构，再并行实现；');
  console.log('  3. 契约类文件（如 docs/API_CONTRACT.md）同一时间只允许一个人修改；');
  console.log('  4. 分支寿命不超过 3 个工作日，每天从主干同步一次。');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/tasks.mjs [--check] [--strict] [--json] [--active-days N] [--base <分支>]');
    process.exit(0);
  }

  if (!tryGit(['rev-parse', '--git-dir'])) {
    console.error('当前目录不是 Git 仓库，无法分析任务占用。');
    process.exit(1);
  }

  const base = resolveBase(options.base);
  if (!base) {
    console.error('未找到主干分支（main / master）。请用 --base 指定对比基线。');
    process.exit(1);
  }

  const days = Number.isFinite(options.activeDays) && options.activeDays > 0 ? options.activeDays : DEFAULT_ACTIVE_DAYS;
  const currentBranch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '';

  const ignoreRules = loadIgnoreRules(options.ignore);
  const { branches, ignored } = collectBranches(base, ignoreRules);

  const tasks = branches
    .filter((branch) => !isMergedInto(branch, base))
    .map((branch) => describeBranch(branch, days, base))
    .filter(Boolean)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  const { active, diverged } = splitDiverged(tasks);

  if (!options.check) {
    const overlaps = findOverlaps(active);
    if (options.json) {
      console.log(JSON.stringify({
        base, days, currentBranch, ignoredBranches: ignored, tasks, divergedBranches: diverged, overlaps
      }, null, 2));
      return;
    }
    if (ignored.length > 0) {
      console.log(`已按 .tasksignore 排除 ${ignored.length} 个分支：${ignored.join('、')}`);
      console.log('');
    }
    printBoard(active, base, days, overlaps, diverged);
    return;
  }

  const others = active.filter((task) => task.branch !== currentBranch);
  const currentFiles = TRUNK_NAMES.has(currentBranch) ? [] : recentFiles(currentBranch, days, base);
  const mine = overlapsWith(currentFiles, currentBranch, others);
  const overlaps = findOverlaps(others);

  if (options.json) {
    console.log(JSON.stringify({
      base, days, currentBranch, currentFiles, others, divergedBranches: diverged, overlaps, myOverlaps: mine
    }, null, 2));
    if (options.strict && mine.high.length > 0) process.exit(1);
    return;
  }

  printBoard(others, base, days, overlaps, diverged);

  console.log('');
  console.log(`当前分支「${currentBranch}」的重叠检查`);
  console.log('-'.repeat(72));

  if (TRUNK_NAMES.has(currentBranch)) {
    console.log('当前处于主干分支，自身没有待合并的改动。');
    return;
  }

  if (currentFiles.length === 0) {
    console.log(`当前分支最近 ${days} 天内没有改动，无需检查。`);
    return;
  }

  if (currentFiles.length >= DIVERGED_FILE_THRESHOLD) {
    console.log(`⚠️  当前分支自身改动 ${currentFiles.length} 个文件，与基线 ${base} 差异过大，已跳过重叠判定。`);
    console.log('    请确认 --base 是否指向真正的主干（例如 int / develop），确认后重新运行。');
    return;
  }

  if (mine.high.length === 0) {
    console.log(`✅ 当前分支近期改动的 ${currentFiles.length} 个文件，没有与其他活跃分支重叠。`);
    if (mine.low.length > 0) {
      console.log(`提示：文档 / 配置重叠 ${mine.low.length} 处，合并时留意即可。`);
    }
    return;
  }

  console.log(`⚠️  与其它活跃分支重叠 ${mine.high.length} 处代码文件：`);
  for (const entry of mine.high.slice(0, MAX_PRINT_PER_GROUP)) {
    console.log(`  ${entry.file}  ←  ${entry.branches.filter((item) => item !== currentBranch).join('、')}`);
  }
  if (mine.high.length > MAX_PRINT_PER_GROUP) {
    console.log(`  …另有 ${mine.high.length - MAX_PRINT_PER_GROUP} 处，使用 --json 查看完整列表`);
  }
  console.log('');
  console.log('建议：先与对方沟通边界，再决定是否继续推进；必要时改为接口先行。');

  if (options.strict && mine.high.length > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error('任务占用分析失败：', error.message ?? error);
  process.exit(1);
}
