#!/usr/bin/env node
/**
 * 文档与规范自检脚本
 *
 * 检查项：
 *   E1xx 文档主语言必须为中文
 *   E2xx 相对链接必须有效
 *   E3xx 敏感信息不得入库
 *   E4xx 目录与文件命名必须符合规范
 *   E5xx 模板必需文件必须存在
 *   E8xx 仓库自身一致性（平台产物副本、引用文件是否入库）
 *
 * 用法：
 *   node scripts/check-docs.mjs
 *   node scripts/check-docs.mjs --path docs
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, formatStatistics, formatSummary } from './lib/reporter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = Date.now();

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'out', 'coverage',
  '.cache', '.turbo', '.vite', 'unpackage', '.idea', '.vscode', 'tmp'
]);

const DOC_EXT = /\.(md|markdown)$/i;
const SCAN_EXT = /\.(md|markdown|json|ya?ml|properties|ts|tsx|js|mjs|cjs|java|sh|ps1|example|env)$/i;

/** 中文主语言判定：CJK 字符占「CJK + 拉丁字母」的比例下限 */
const CJK_RATIO_MIN = 0.1;
/** 少于该字符数的文档不参与语言判定（多为纯配置或短说明） */
const CJK_MIN_CHARS = 20;

/** 允许的非中文 Markdown（第三方文件或机器生成文件） */
const LANGUAGE_EXEMPT = [
  '.agents/skills',
  'node_modules',
  'CLAUDE.md',
  '.cursor'
];

/** 敏感信息模式：命中即报错 */
const SECRET_PATTERNS = [
  { id: 'E301', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: '发现私钥内容' },
  { id: 'E302', re: /\bAKIA[0-9A-Z]{16}\b/, message: '发现疑似 AWS Access Key' },
  { id: 'E303', re: /\bghp_[A-Za-z0-9]{30,}\b/, message: '发现疑似 GitHub Token' },
  { id: 'E304', re: /\bsk-[A-Za-z0-9]{24,}\b/, message: '发现疑似 API Key（sk- 前缀）' },
  { id: 'E305', re: /jdbc:[a-z]+:\/\/[^\s"']*password=[^\s"'&]+/i, message: 'JDBC 连接串中内联了口令' }
];

/**
 * E306 的键名锚定：关键字前不能是字母数字，避免 requestToken、accessToken、bearerToken
 * 这类驼峰变量被截成 token 误报；下划线与点是合法分隔，所以 DB_PASSWORD、
 * spring.datasource.password 仍能命中。
 */
const SECRET_KEY_RE = /(?:^|[^A-Za-z0-9])(password|passwd|pwd|secret|token|apikey|api_key|appsecret)\s*[:=]\s*(.+)$/i;

/**
 * 值不是字面量：变量引用、函数调用、模板占位、三元表达式。
 * 命中即认定「这是代码而不是凭证」，例如 ${POSTGRES_PASSWORD:?...}、getItem('accessToken')。
 */
const SECRET_EXPRESSION_RE = /[{}()<>?!|&$[\]]/;

/** 允许出现的占位值：显式占位词、测试假值、纯数字短串 */
const PLACEHOLDER_RE = /^(change[-_]?me|replace[-_].*|your[-_.].*|example.*|placeholder.*|sample.*|dummy.*|fake.*|mock.*|test.*|demo.*|local[-_].*|dev[-_].*|staging[-_].*|xxx+|\*+|<.*>|\$\{.*\}|none|null|nil|empty|todo|ffffff|password|passwd|pwd|secret|token|apikey|api_key|appsecret|\d{1,6}|[a-z]+[-_](token|key|secret|pwd|password|value|test))$/i;

/** 测试与示例文件：命中密钥规则时降级为警告（测试常含虚构凭证，但仍需人工确认） */
function isTestLikeFile(abs) {
  const r = rel(abs);
  return /(^|\/)(tests?|__tests__|e2e|fixtures)\//i.test(r)
    || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(r)
    || /(^|\/)src\/test\//.test(r)
    || /(Test|Tests|TestCase)\.java$/.test(r);
}

/**
 * 接入豁免：已有项目的历史文档不符合本模板规范时，把路径登记到 workflow.config.json 的
 * legacyDocs 里，只降级「主语言」「命名」两类提示，密钥与断链等硬问题照常报错。
 * 支持两种写法：精确路径 docs/deployment.md，目录前缀 docs/superpowers/**。
 */
const LEGACY_EXEMPT = loadLegacyDocs();

function loadLegacyDocs() {
  try {
    const configPath = path.join(ROOT, 'workflow.config.json');
    if (!existsSync(configPath)) return [];
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return Array.isArray(config.legacyDocs) ? config.legacyDocs.map(String) : [];
  } catch {
    return [];
  }
}

function isLegacyDoc(abs) {
  const r = rel(abs);
  return LEGACY_EXEMPT.some((rule) => {
    if (rule.endsWith('/**')) return r.startsWith(rule.slice(0, -2));
    return r === rule;
  });
}

/** 敏感但需人工判断：仅告警 */
const WARN_PATTERNS = [
  { id: 'E311', re: /\b1[3-9]\d{9}\b/, message: '发现疑似真实手机号' }
];

const issues = [];
let fileCount = 0;

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

function isExempt(target, exemptList) {
  const r = rel(target);
  return exemptList.some((rule) => r === rule || r.startsWith(`${rule}/`));
}

/** E1xx：文档主语言检查 */
function checkLanguage(abs, content) {
  if (isExempt(abs, LANGUAGE_EXEMPT)) return;
  const cjk = (content.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (content.match(/[A-Za-z]/g) ?? []).length;
  if (cjk + latin < CJK_MIN_CHARS) return;

  const ratio = cjk / (cjk + latin);
  if (ratio < CJK_RATIO_MIN) {
    const legacy = isLegacyDoc(abs);
    issues.push({
      ruleId: 'E101',
      level: legacy ? 'warn' : 'error',
      file: rel(abs),
      message: legacy ? '文档主语言不是中文，已登记接入豁免，建议随迭代迁移' : '文档主语言不是中文',
      detail: `中文字符 ${cjk} 个，拉丁字母 ${latin} 个，中文占比 ${(ratio * 100).toFixed(1)}%（下限 ${CJK_RATIO_MIN * 100}%）`,
      suggestion: 'Markdown 文档正文改用中文；代码、命令、路径、API 名称保持原文即可'
    });
  }
}

/**
 * E307：会随模板注入业务项目的文档，不得链接到只有本仓库才有的路径。
 * docs/、skills/、stacks/、spec/、db/ 与根级 AGENTS.md/SPEC.md/MEMORY.md 都会注入业务项目，
 * 它们一旦链接 templates/ 或根 README.md、CHANGELOG.md，在业务项目里就是断链——
 * 本仓库里却因为文件存在而不报错，属于「只在接入后才炸」的隐形问题。
 */
const INJECTED_DOC_ROOTS = ['docs/', 'skills/', 'stacks/', 'spec/', 'db/'];
const INJECTED_DOC_FILES = ['AGENTS.md', 'SPEC.md', 'MEMORY.md'];

function isInjectedDoc(file) {
  if (INJECTED_DOC_FILES.includes(file)) return true;
  return INJECTED_DOC_ROOTS.some((prefix) => file.startsWith(prefix));
}

function isTemplateOnlyPath(relTarget) {
  return (
    relTarget.startsWith('templates/') ||
    relTarget === 'README.md' ||
    relTarget === 'CHANGELOG.md' ||
    relTarget.startsWith('..')
  );
}

/**
 * E308：文档引用的文件被 .gitignore 忽略。
 * 本地有文件，E201 不会报，但别人克隆后既拿不到文件又会看到断链——
 * 「本地全绿、克隆即坏」的典型，配图 secrets.png 就曾这样漏掉。
 * 链接扫描时先收集，全部扫完再用一次 git check-ignore --stdin 批量判定：
 * 逐条起 git 进程在 Windows 上要 0.5 秒，链接多了会拖垮 pre-commit。
 */
const referencedFiles = [];

function checkIgnoredReferences() {
  if (referencedFiles.length === 0) return;
  const rels = [...new Set(referencedFiles.map((item) => item.relTarget))];
  const ignored = new Set();
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: ROOT,
      input: `${rels.join('\n')}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    for (const line of out.split(/\r?\n/)) if (line.trim()) ignored.add(line.trim());
  } catch (error) {
    // 退出码 1 = 没有任何路径被忽略；128 = 当前不是 Git 仓库。两种都不报。
    for (const line of String(error.stdout ?? '').split(/\r?\n/)) if (line.trim()) ignored.add(line.trim());
  }

  for (const item of referencedFiles) {
    if (!ignored.has(item.relTarget)) continue;
    issues.push({
      ruleId: 'E308',
      file: item.file,
      line: item.line,
      message: `引用文件被 .gitignore 忽略，不会入库：${item.target}`,
      detail: '本地存在所以看不出问题，别人克隆后既拿不到文件，还会看到断链',
      suggestion: '调整 .gitignore 规则（可加 !路径 例外），或把引用换成会入库的文件'
    });
  }
}

/** E2xx：相对链接有效性 */
function checkLinks(abs, content) {
  const lines = content.split(/\r?\n/);
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  const self = rel(abs);

  lines.forEach((lineText, index) => {
    let match;
    while ((match = linkRe.exec(lineText)) !== null) {
      let target = match[1].trim();
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;

      target = target.split('#')[0];
      if (!target) continue;
      if (/[<>*]/.test(target)) continue;

      const resolved = path.resolve(path.dirname(abs), decodeURI(target));
      const relTarget = path.relative(ROOT, resolved).split(path.sep).join('/');
      if (isInjectedDoc(self) && isTemplateOnlyPath(relTarget)) {
        issues.push({
          ruleId: 'E307',
          file: self,
          line: index + 1,
          message: `共享文档链接到仅模板仓库存在的路径：${target}`,
          detail: '该文档会注入业务项目，而 templates/、根 README.md、CHANGELOG.md 不会随模板注入，届时链接必然失效',
          suggestion: '改成纯文本说明（例如「见模板仓库的 templates/platform/README.md」），或改链到会注入的文档'
        });
      }
      if (!existsSync(resolved)) {
        issues.push({
          ruleId: 'E201',
          file: self,
          line: index + 1,
          message: `相对链接指向的文件不存在：${target}`,
          suggestion: '修正路径，或确认目标文件是否已被移动或删除'
        });
        continue;
      }
      if (!relTarget.startsWith('..')) {
        referencedFiles.push({ file: self, line: index + 1, target, relTarget });
      }
    }
  });
}

/** E3xx：敏感信息扫描 */
function checkSecrets(abs, content) {
  const lines = content.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    if (/^\s*(\/\/|#|\*|<!--)/.test(lineText) && !/[:=]/.test(lineText)) return;

    for (const rule of SECRET_PATTERNS) {
      if (!lineText.match(rule.re)) continue;
      issues.push({
        ruleId: rule.id,
        file: rel(abs),
        line: index + 1,
        message: rule.message,
        suggestion: '改为环境变量占位符，真实值放入本地 .env（不入库）；若已提交，先轮换密钥再清理历史'
      });
      break;
    }

    checkSecretAssignment(abs, lineText, index);

    for (const rule of WARN_PATTERNS) {
      if (lineText.match(rule.re)) {
        issues.push({
          level: 'warn',
          ruleId: rule.id,
          file: rel(abs),
          line: index + 1,
          message: rule.message,
          suggestion: '如为真实数据请脱敏；如为示例请改用明显虚假的示例号码'
        });
        break;
      }
    }
  });
}

/**
 * E306：口令/密钥赋值。
 *
 * 只认「键名 = 字面量」这一种形态：
 *   - 键名必须是独立单词，避免 requestToken、currentToken 这类驼峰变量被截断后误报；
 *   - 值必须像字面量，含括号、三元、模板占位的一律按代码处理；
 *   - 值命中占位词表（change-me、replace-*、test-*、token-a 之类）按占位处理；
 *   - 测试与示例文件降级为警告：测试里的虚构凭证不该阻塞门禁，但也不能视而不见。
 */
function checkSecretAssignment(abs, lineText, index) {
  const match = lineText.match(SECRET_KEY_RE);
  if (!match) return;

  const raw = (match[2] ?? '').trim().replace(/[,;]+\s*$/, '');
  const quoted = raw.match(/^["']([^"']*)["']$/);
  const value = quoted ? quoted[1].trim() : raw.split(/\s+/)[0].replace(/[,;]+$/, '');

  if (value.length < 6) return;
  if (SECRET_EXPRESSION_RE.test(value)) return;
  if (PLACEHOLDER_RE.test(value)) return;

  const testLike = isTestLikeFile(abs);
  issues.push({
    ruleId: 'E306',
    level: testLike ? 'warn' : 'error',
    file: rel(abs),
    line: index + 1,
    message: testLike ? '疑似口令或密钥，且位于测试或示例文件，请确认是虚构值' : '疑似真实口令或密钥',
    detail: `键名 ${match[1]}，值为字面量且未命中占位词表（出于安全不回显原值）`,
    suggestion: '改为环境变量占位符，真实值放入本地 .env（不入库）；若已提交，先轮换密钥再清理历史'
  });
}

/** E4xx：命名规范 */
async function checkNaming(abs) {
  const r = rel(abs);
  const base = path.basename(abs);

  if (/^docs\/[^/]+$/.test(r) && DOC_EXT.test(base)) {
    const allowed = /^\d{2}-.+\.md$/.test(base) || /^[A-Z0-9_-]+\.md$/.test(base) || base === 'README.md';
    if (!allowed) {
      const legacy = isLegacyDoc(abs);
      issues.push({
        ruleId: 'E401',
        level: legacy ? 'warn' : 'error',
        file: r,
        message: legacy ? 'docs 根目录下的文档命名不符合规范，已登记接入豁免，建议随迭代改名' : 'docs 根目录下的文档命名不符合规范',
        detail: '流程类文档应为「两位序号-中文名称.md」，例如 01-工作流总览.md；契约类文档可为全大写，例如 API_CONTRACT.md',
        suggestion: `重命名为「NN-${base}」或全大写形式，或移入 docs 的子目录`
      });
    }
  }

}

/** E4xx：spec 目录结构检查
 *  允许两种形态：
 *    目录 spec/<YYYYMMDD>-<主题>/  （推荐，含原始需求、原型、需求与技术对照.md）
 *    文件 spec/<YYYYMMDD>-<主题>.md（兼容轻量需求）
 */
async function checkSpecStructure() {
  const specDir = path.join(ROOT, 'spec');
  if (!(await exists(specDir))) return;

  const entries = await readdir(specDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'README.md') continue;

    if (!/^\d{8}-/.test(entry.name)) {
      issues.push({
        ruleId: 'E402',
        file: `spec/${entry.name}`,
        message: 'spec 目录下的条目命名不符合规范',
        detail: '应以日期开头，形如「20260924-客户列表团队筛选」',
        suggestion: '使用 node scripts/new-spec.mjs --title "主题" 生成，可自动带上日期'
      });
      continue;
    }

    if (entry.isDirectory()) {
      const mainDoc = path.join(specDir, entry.name, '需求与技术对照.md');
      if (!(await exists(mainDoc))) {
        issues.push({
          level: 'warn',
          ruleId: 'E403',
          file: `spec/${entry.name}`,
          message: '需求目录缺少主文档「需求与技术对照.md」',
          detail: '该文件承载需求编号、验收标准与技术实现对照，是设计与验收的依据',
          suggestion: '纳入该文件；技术实现写在对照表里，不要写回 PRD 原件'
        });
      }
    }
  }
}

/** E5xx：必需文件存在性 */
const REQUIRED_FILES = [
  'AGENTS.md',
  'docs/01-工作流总览.md',
  'docs/03-技能体系.md',
  'docs/05-分支提交与评审.md',
  'docs/06-验收与证据留档.md',
  'docs/07-安全与密钥.md',
  'skills/README.md',
  'stacks/registry.json',
  'scripts/check-docs.mjs'
];

/** 建议文件：缺失时仅告警（业务项目可能已有自己的总览文档） */
const RECOMMENDED_FILES = [
  'README.md',
  'docs/verification/README.md'
];

async function checkRequiredFiles() {
  for (const item of REQUIRED_FILES) {
    if (!(await exists(path.join(ROOT, item)))) {
      issues.push({
        ruleId: 'E501',
        file: item,
        message: '模板必需文件缺失',
        suggestion: '从模板仓库同步该文件；若为有意删除，请同时更新 scripts/check-docs.mjs 的必需文件清单'
      });
    }
  }

  for (const item of RECOMMENDED_FILES) {
    if (!(await exists(path.join(ROOT, item)))) {
      issues.push({
        level: 'warn',
        ruleId: 'E502',
        file: item,
        message: '建议文件缺失',
        suggestion: '补齐该文件有助于团队协作；若项目已有等价文档，可在本项目 AGENTS.md 中指向它'
      });
    }
  }
}

/** E5xx：换行规则保护——.githooks 必须被 eol=lf 覆盖，否则 Linux / macOS 上的钩子会失效 */
async function checkAttributes() {
  const attrPath = path.join(ROOT, '.gitattributes');
  const hooksDir = path.join(ROOT, '.githooks');
  if (!(await exists(attrPath)) || !(await exists(hooksDir))) return;

  const rules = (await readFile(attrPath, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const coversHooks = rules.some((line) => /^(\.githooks\/.*|\*)\s+.*eol=lf/.test(line));
  if (coversHooks) return;

  issues.push({
    level: 'warn',
    ruleId: 'E503',
    file: '.gitattributes',
    message: 'Git 钩子脚本缺少 LF 换行保护',
    detail: 'core.autocrlf=true 的机器会把 .githooks 转成 CRLF，钩子在 Linux / macOS 上会以 bad interpreter 失败',
    suggestion: '在 .gitattributes 补一行 .githooks/* text eol=lf，或采用模板自带的 * text=auto eol=lf'
  });
}

async function main() {
  const argPath = (() => {
    const index = process.argv.indexOf('--path');
    return index !== -1 ? process.argv[index + 1] : null;
  })();

  const scanRoot = argPath ? path.resolve(ROOT, argPath) : ROOT;
  const files = await walk(scanRoot);

  for (const abs of files) {
    const name = path.basename(abs);
    const isEnvExample = name === '.env.example';
    if (!isEnvExample && !SCAN_EXT.test(name)) continue;
    if (IGNORE_DIRS.has(path.basename(path.dirname(abs)))) continue;

    fileCount += 1;
    const content = await readFile(abs, 'utf8');

    checkSecrets(abs, content);
    if (DOC_EXT.test(name)) {
      checkLanguage(abs, content);
      checkLinks(abs, content);
      await checkNaming(abs);
    }
  }

  await checkRequiredFiles();
  await checkSpecStructure();
  await checkAttributes();
  checkIgnoredReferences();

  const errors = issues.filter((item) => (item.level ?? 'error') === 'error');
  const warnings = issues.filter((item) => item.level === 'warn');

  console.log(formatReport(issues, '文档与规范自检'));
  console.log(formatStatistics({
    totalFiles: fileCount,
    duration: Date.now() - START,
    issues: errors.length,
    warnings: warnings.length
  }));
  console.log(formatSummary(errors.length));

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('校验脚本执行失败：', error);
  process.exit(1);
});
