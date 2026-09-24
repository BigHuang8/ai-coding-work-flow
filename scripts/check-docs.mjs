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
 *
 * 用法：
 *   node scripts/check-docs.mjs
 *   node scripts/check-docs.mjs --path docs
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  { id: 'E305', re: /jdbc:[a-z]+:\/\/[^\s"']*password=[^\s"'&]+/i, message: 'JDBC 连接串中内联了口令' },
  {
    id: 'E306',
    re: /(password|passwd|pwd|secret|token|apikey|api_key|appsecret)\s*[:=]\s*["']?([^\s"',;#]{6,})/i,
    message: '疑似真实口令或密钥',
    checkValue: true
  }
];

/** 允许出现的占位值 */
const PLACEHOLDER_RE = /^(change[-_]?me|your[-_.].*|example.*|placeholder.*|xxx+|\*+|<.*>|\$\{.*\}|none|null|empty|todo|ffffff|password|passwd|pwd|secret|token|apikey|api_key|appsecret|\d{1,6})$/i;

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
    issues.push({
      ruleId: 'E101',
      file: rel(abs),
      message: '文档主语言不是中文',
      detail: `中文字符 ${cjk} 个，拉丁字母 ${latin} 个，中文占比 ${(ratio * 100).toFixed(1)}%（下限 ${CJK_RATIO_MIN * 100}%）`,
      suggestion: 'Markdown 文档正文改用中文；代码、命令、路径、API 名称保持原文即可'
    });
  }
}

/** E2xx：相对链接有效性 */
function checkLinks(abs, content) {
  const lines = content.split(/\r?\n/);
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;

  lines.forEach((lineText, index) => {
    let match;
    while ((match = linkRe.exec(lineText)) !== null) {
      let target = match[1].trim();
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;

      target = target.split('#')[0];
      if (!target) continue;
      if (/[<>*]/.test(target)) continue;

      const resolved = path.resolve(path.dirname(abs), decodeURI(target));
      if (!existsSync(resolved)) {
        issues.push({
          ruleId: 'E201',
          file: rel(abs),
          line: index + 1,
          message: `相对链接指向的文件不存在：${target}`,
          suggestion: '修正路径，或确认目标文件是否已被移动或删除'
        });
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
      const match = lineText.match(rule.re);
      if (!match) continue;
      if (rule.checkValue) {
        const value = (match[2] ?? '').trim();
        if (PLACEHOLDER_RE.test(value)) continue;
      }
      issues.push({
        ruleId: rule.id,
        file: rel(abs),
        line: index + 1,
        message: rule.message,
        suggestion: '改为环境变量占位符，真实值放入本地 .env（不入库）；若已提交，先轮换密钥再清理历史'
      });
      break;
    }

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

/** E4xx：命名规范 */
async function checkNaming(abs) {
  const r = rel(abs);
  const base = path.basename(abs);

  if (/^docs\/[^/]+$/.test(r) && DOC_EXT.test(base)) {
    const allowed = /^\d{2}-.+\.md$/.test(base) || /^[A-Z0-9_-]+\.md$/.test(base) || base === 'README.md';
    if (!allowed) {
      issues.push({
        ruleId: 'E401',
        file: r,
        message: 'docs 根目录下的文档命名不符合规范',
        detail: '流程类文档应为「两位序号-中文名称.md」，例如 01-工作流总览.md；契约类文档可为全大写，例如 API_CONTRACT.md',
        suggestion: `重命名为「NN-${base}」或全大写形式，或移入 docs 的子目录`
      });
    }
  }

  if (/^spec\/[^/]+$/.test(r) && DOC_EXT.test(base) && base !== 'README.md') {
    if (!/^\d{8}-.+\.md$/.test(base)) {
      issues.push({
        ruleId: 'E402',
        file: r,
        message: 'spec 目录下的需求留档命名不符合规范',
        detail: '应为「YYYYMMDD-中文主题.md」',
        suggestion: '使用 node scripts/new-spec.mjs --title "主题" 生成，可自动带上日期'
      });
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
