#!/usr/bin/env node
/**
 * 技能来源与结构自检
 *
 * 规则：开发本项目**只允许使用仓库内技能**——自研技能放 skills/，外部引入技能放 .agents/skills/。
 * 个人目录下的技能（~/.codex/skills、~/.claude/skills 等）换个人、换台机器就不存在，
 * 既不可复现，也无法评审，因此不能作为交付依据。
 *
 * 检查项：
 *   E601 技能目录名不符合规范（小写连字符）
 *   E602 技能目录缺少 SKILL.md
 *   E603 SKILL.md 缺少 front-matter 的 name / description，或 name 与目录名不一致
 *   E604 技能出现在白名单目录之外
 *   E605 技能内容引用了仓库外的个人目录或绝对路径
 *   E606 skills/README.md 技能清单与目录不一致
 *
 * 用法：
 *   node scripts/check-skills.mjs
 *
 * 引入技能的来源与哈希由 node scripts/sync-agent-config.mjs --check 校验。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, formatStatistics, formatSummary } from './lib/reporter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = Date.now();

/** 唯一允许存放技能的目录（相对仓库根） */
const ALLOWED_ROOTS = ['skills', '.agents/skills'];
/** 自研技能索引文件 */
const INDEX_FILE = 'skills/README.md';
/** 外部引入技能的锁定文件，仅用于提示 */
const LOCK_FILE = 'skills-lock.json';

const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'out', 'coverage',
  '.cache', '.turbo', '.vite', 'unpackage', '.idea', '.vscode', 'tmp'
]);

/** 指向仓库外个人目录的写法：换台机器就失效，属于不可复现依赖 */
const EXTERNAL_REF_PATTERNS = [
  { re: /~[\\/]\.(codex|claude|cursor|config)/i, message: '引用了用户主目录下的个人配置或技能目录' },
  { re: /%USERPROFILE%/i, message: '引用了 Windows 用户目录变量' },
  { re: /\b[A-Za-z]:[\\/]Users[\\/]/i, message: '引用了 Windows 用户目录绝对路径' },
  { re: /\/Users\/[^/\s]+\/\.(codex|claude|cursor|config)/i, message: '引用了 macOS 个人配置目录' },
  { re: /\/home\/[^/\s]+\/\.(codex|claude|cursor|config)/i, message: '引用了 Linux 个人配置目录' },
  { re: /AppData[\\/](Roaming|Local)/i, message: '引用了 Windows AppData 路径' }
];

const issues = [];
let scannedFiles = 0;

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, out = []) {
  if (!(await exists(dir))) return out;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function rel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function parseFrontMatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (item) fields[item[1]] = item[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

function checkExternalRefs(file, content) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of EXTERNAL_REF_PATTERNS) {
      if (!pattern.re.test(line)) continue;
      issues.push({
        ruleId: 'E605',
        file: rel(file),
        line: index + 1,
        message: pattern.message,
        detail: line.trim().slice(0, 120),
        suggestion: '技能必须是自包含的：改成仓库内相对路径，或把依赖的技能引入到 .agents/skills/ 并登记哈希'
      });
      break;
    }
  });
}

/** 白名单目录下的技能目录（一层一个技能） */
async function collectSkillDirs() {
  const result = [];
  for (const root of ALLOWED_ROOTS) {
    const abs = path.join(ROOT, root);
    if (!(await exists(abs))) continue;
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      result.push({ name: entry.name, dir: path.join(abs, entry.name), root });
    }
  }
  return result;
}

async function checkSkillDirs(skillDirs) {
  for (const skill of skillDirs) {
    const display = rel(skill.dir);
    if (!SKILL_NAME_RE.test(skill.name)) {
      issues.push({
        ruleId: 'E601',
        file: display,
        message: '技能目录名不符合规范',
        detail: `当前名称：${skill.name}`,
        suggestion: '用小写字母、数字与连字符，例如 dual-axis-review'
      });
    }

    const entry = path.join(skill.dir, 'SKILL.md');
    if (!(await exists(entry))) {
      issues.push({
        ruleId: 'E602',
        file: display,
        message: '技能目录缺少 SKILL.md',
        detail: 'SKILL.md 是技能的唯一定义入口，AI 靠它决定何时加载该技能',
        suggestion: '参考 skills/README.md 的结构规范补齐；不需要时删除该目录'
      });
      continue;
    }

    scannedFiles += 1;
    const content = await readFile(entry, 'utf8');
    const fields = parseFrontMatter(content);
    if (!fields) {
      issues.push({
        ruleId: 'E603',
        file: rel(entry),
        message: '缺少 front-matter',
        detail: '文件未以 --- 开头的 YAML 头开始，AI 无法识别技能名与触发场景',
        suggestion: '在文件开头补 name 与 description 两个字段'
      });
    } else {
      if (!fields.name) {
        issues.push({
          ruleId: 'E603',
          file: rel(entry),
          message: 'front-matter 缺少 name',
          suggestion: `补上 name: ${skill.name}`
        });
      } else if (fields.name !== skill.name) {
        issues.push({
          ruleId: 'E603',
          file: rel(entry),
          message: 'front-matter 的 name 与目录名不一致',
          detail: `name: ${fields.name}，目录名：${skill.name}`,
          suggestion: '两者必须一致，否则 AI 找不到技能'
        });
      }
      if (!fields.description) {
        issues.push({
          ruleId: 'E603',
          file: rel(entry),
          message: 'front-matter 缺少 description',
          suggestion: '写清「什么场景下用这个技能」，它是 AI 决定是否加载的唯一依据'
        });
      }
    }

    checkExternalRefs(entry, content);

    const files = await walk(skill.dir);
    for (const file of files) {
      if (file.endsWith('.md') && path.basename(file) !== 'SKILL.md') {
        scannedFiles += 1;
        checkExternalRefs(file, await readFile(file, 'utf8'));
      } else if (!file.endsWith('.md')) {
        scannedFiles += 1;
      }
    }
  }
}

/** 白名单之外的 SKILL.md：个人或工具专属目录不得作为技能来源 */
async function checkStraySkills(allFiles) {
  for (const file of allFiles) {
    if (path.basename(file) !== 'SKILL.md') continue;
    const r = rel(file);
    if (ALLOWED_ROOTS.some((root) => r.startsWith(`${root}/`))) continue;
    issues.push({
      ruleId: 'E604',
      file: r,
      message: '技能出现在白名单目录之外',
      detail: `只允许 skills/ 与 .agents/skills/ 存放技能，当前位于 ${r.split('/').slice(0, -1).join('/') || '.'}`,
      suggestion: '移到 skills/（自研）或 .agents/skills/（引入并登记哈希）；个人工具专属目录不参与团队交付'
    });
  }
}

async function checkIndex(skillDirs) {
  const selfMade = skillDirs.filter((skill) => skill.root === 'skills').map((skill) => skill.name);
  if (selfMade.length === 0) return;

  const indexPath = path.join(ROOT, INDEX_FILE);
  if (!(await exists(indexPath))) {
    issues.push({
      ruleId: 'E606',
      file: INDEX_FILE,
      message: '缺少自研技能索引文件',
      suggestion: '补一份技能清单，列出每个技能的用途与触发语句'
    });
    return;
  }

  scannedFiles += 1;
  const content = await readFile(indexPath, 'utf8');
  const listed = new Set();
  for (const line of content.split(/\r?\n/)) {
    const item = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(line);
    if (item) listed.add(item[1]);
  }

  for (const name of selfMade) {
    if (!listed.has(name)) {
      issues.push({
        ruleId: 'E606',
        file: INDEX_FILE,
        message: `技能 ${name} 未登记到技能清单`,
        detail: '清单是团队发现技能的唯一入口，未登记等于没人知道它存在',
        suggestion: '在「技能清单」表格中补一行：用途 + 典型触发语句'
      });
    }
  }

  for (const name of listed) {
    if (!selfMade.includes(name)) {
      issues.push({
        ruleId: 'E606',
        file: INDEX_FILE,
        message: `技能清单中的 ${name} 没有对应目录`,
        suggestion: '删除该行，或补回 skills/' + name + '/SKILL.md'
      });
    }
  }
}

async function main() {
  const allFiles = await walk(ROOT);
  const skillDirs = await collectSkillDirs();

  if (skillDirs.length === 0) {
    console.log('未发现技能目录（skills/ 与 .agents/skills/），已跳过技能自检。');
    return;
  }

  await checkStraySkills(allFiles);
  await checkSkillDirs(skillDirs);
  await checkIndex(skillDirs);

  const errors = issues.filter((item) => (item.level ?? 'error') === 'error').length;
  const warnings = issues.filter((item) => item.level === 'warn').length;

  console.log(formatReport(issues, '技能来源与结构自检'));
  console.log(formatStatistics({
    totalFiles: scannedFiles,
    duration: Date.now() - START,
    issues: errors,
    warnings
  }));
  console.log(formatSummary(errors));

  if (await exists(path.join(ROOT, LOCK_FILE))) {
    console.log('提示：引入技能的来源与哈希由 node scripts/sync-agent-config.mjs --check 校验。');
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('技能自检执行失败：', error);
  process.exit(1);
});
