#!/usr/bin/env node
/**
 * 技术栈探测与自检
 *
 * 回答两个问题：
 *   1. 这个项目实际用了哪些技术栈？哪些模板有规范、哪些没有？
 *   2. 模板里那些本项目没用到的栈怎么处理？（装箱：不注入、不进阅读顺序、不进 CI）
 *
 * 用法：
 *   node scripts/detect-stack.mjs              探测当前仓库，输出三类清单
 *   node scripts/detect-stack.mjs --target ../your-project
 *   node scripts/detect-stack.mjs --check      自检：登记表结构 + 规范文档 + 缺口 + 配置一致性
 *   node scripts/detect-stack.mjs --check --strict   缺口也判失败，接入稳定后建议在 CI 打开
 *   node scripts/detect-stack.mjs --json       机器可读输出
 *
 * 退出码：0 无错误；1 存在错误；2 用法或环境问题。
 *
 * 规则说明见 docs/10-技术栈适配.md，登记表见 stacks/registry.json。
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, formatSummary } from './lib/reporter.mjs';
import { buildContext, classify, loadRegistry, scanTarget, validateRegistry } from './lib/stacks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = Date.now();

function parseArgs(argv) {
  const options = { target: '', check: false, strict: false, json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') options.target = argv[(index += 1)] ?? '';
    else if (arg === '--check') options.check = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数：${arg}`);
      process.exit(2);
    }
  }

  return options;
}

function group(title, items, render) {
  const lines = [`${title}（${items.length}）`];
  if (items.length === 0) {
    lines.push('  无');
  } else {
    for (const item of items) lines.push(...render(item));
  }
  lines.push('');
  return lines;
}

/** 自检项：规范文档是否到位、缺口是否认领、声明与探测是否一致 */
async function collectChecks({ options, enabled, gaps, target, configPath }) {
  const issues = [];

  for (const stack of enabled) {
    for (const guideline of stack.guidelines ?? []) {
      if (existsSync(path.join(target, guideline))) continue;

      // 只有模板仓库里有：说明还没注入到目标项目，属于流程未走完，不是错误
      if (target !== ROOT && existsSync(path.join(ROOT, guideline))) {
        issues.push({
          level: 'warn',
          ruleId: 'E706',
          file: guideline,
          message: `规范文档尚未注入目标项目：${guideline}`,
          detail: `已启用的技术栈 ${stack.id} 的规范目前只存在于模板仓库`,
          suggestion: '执行 node scripts/bootstrap.mjs --target <项目> 完成注入后重跑'
        });
        continue;
      }

      issues.push({
        level: 'error',
        ruleId: 'E702',
        file: guideline,
        message: `已启用的技术栈 ${stack.id} 缺少规范文档`,
        detail: `探测到本项目使用 ${stack.name}，但 ${guideline} 不存在`,
        suggestion: '补齐该规范文档，或从 stacks/registry.json 移除该栈的登记'
      });
    }

    if (stack.status === 'provisional') {
      issues.push({
        level: 'warn',
        ruleId: 'E705',
        file: 'stacks/registry.json',
        message: `技术栈 ${stack.id} 的规范尚未转正`,
        detail: '当前为 provisional 状态，规范细节可能不完整',
        suggestion: '按 docs/10-技术栈适配.md 第三节补齐后转正，避免长期停留在临时状态'
      });
    }
  }

  for (const gap of gaps) {
    issues.push({
      level: options.strict ? 'error' : 'warn',
      ruleId: 'E703',
      file: 'stacks/registry.json',
      message: `技术栈缺口：${gap.name}`,
      detail: `证据：${gap.evidence.join('、')}；模板暂无该栈规范${gap.id.startsWith('unregistered-') ? '，且该构建文件未登记' : ''}`,
      suggestion: '按 docs/10-技术栈适配.md 第三节补最小规范并登记到 stacks/registry.json'
    });
  }

  // 声明与探测比对：声明了没用到的栈，会把无关规范带进阅读顺序与门禁。
  // 只比对 bootstrap 生成的配置（带 template 标记）；手工维护的极简配置
  // （例如模板仓库自己只写 aiEntries）不代表技术栈声明，不参与比对。
  if (existsSync(configPath)) {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if (config.template !== 'hqc-ai-coding-work-flow') return issues;
    const declared = new Set(config.stacks ?? []);
    const detected = new Set(enabled.map((stack) => stack.id));
    const stale = [...declared].filter((id) => !detected.has(id));
    const missing = [...detected].filter((id) => !declared.has(id));

    if (stale.length > 0) {
      issues.push({
        level: 'warn',
        ruleId: 'E704',
        file: 'workflow.config.json',
        message: `声明了未探测到的技术栈：${stale.join('、')}`,
        detail: '声明的栈会把无关规范带进阅读顺序与门禁',
        suggestion: '删除该声明，或补上探测规则后重跑 node scripts/bootstrap.mjs --force'
      });
    }
    if (missing.length > 0) {
      issues.push({
        level: 'warn',
        ruleId: 'E704',
        file: 'workflow.config.json',
        message: `探测到但未声明：${missing.join('、')}`,
        detail: '校验命令聚合与任务看板依赖该声明',
        suggestion: '重跑 node scripts/bootstrap.mjs --force 重新生成配置'
      });
    }
  }

  return issues;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/detect-stack.mjs [--target <项目路径>] [--check] [--strict] [--json]');
    process.exit(0);
  }

  const target = path.resolve(process.cwd(), options.target || ROOT);
  if (!existsSync(target)) {
    console.error(`目标目录不存在：${target}`);
    process.exit(2);
  }

  const registryPath = path.join(ROOT, 'stacks', 'registry.json');
  if (!existsSync(registryPath)) {
    console.error(`未找到技术栈登记表：${path.relative(process.cwd(), registryPath)}`);
    console.error('提示：本项目可能还没接入模板，请先执行 node scripts/bootstrap.mjs --target <项目>');
    process.exit(2);
  }

  const { registry } = await loadRegistry(ROOT);
  const files = await scanTarget(target);
  const context = await buildContext(target, files);
  const { enabled, available, gaps } = classify(registry, context);

  // 登记表结构问题任何时候都报；其余检查只在 --check 模式下跑
  const issues = validateRegistry(registry).map((item) => ({
    level: 'error',
    ruleId: 'E701',
    file: 'stacks/registry.json',
    message: item.message
  }));

  if (options.check) {
    issues.push(
      ...(await collectChecks({
        options,
        enabled,
        gaps,
        target,
        configPath: path.join(target, 'workflow.config.json')
      }))
    );
  }

  const errors = issues.filter((item) => (item.level ?? 'error') === 'error');
  const warnings = issues.filter((item) => item.level === 'warn');

  if (options.json) {
    console.log(JSON.stringify({
      target,
      enabled,
      available,
      gaps,
      issues,
      errors: errors.length,
      warnings: warnings.length
    }, null, 2));
    process.exit(errors.length > 0 ? 1 : 0);
  }

  if (!options.check) {
    console.log('技术栈探测');
    console.log('='.repeat(60));
    console.log(`目标项目：${target}`);
    console.log(
      `登记表：${path.relative(ROOT, registryPath)}` +
        `（模板已覆盖 ${(registry.stacks ?? []).length} 个栈，已知未覆盖 ${(registry.catalog ?? []).length} 个）`
    );
    console.log('');

    console.log(
      group('已启用：项目用到、模板有规范', enabled, (stack) => [
        `  [${stack.slot}] ${stack.id}  ${stack.name}`,
        `      规范：${(stack.guidelines ?? []).join('、')}`,
        `      命令：${stack.validate}`,
        `      证据：${stack.evidence.join('、')}`
      ]).join('\n')
    );

    console.log(
      group('装箱未启用：模板有规范、项目没用到', available, (stack) => [
        `  [${stack.slot}] ${stack.id}  ${stack.name}   规范留库备用，不注入、不进阅读顺序、不进 CI`
      ]).join('\n')
    );

    console.log(
      group('缺口：项目用到、模板没规范', gaps, (stack) => [
        `  [${stack.slot}] ${stack.name}`,
        `      证据：${stack.evidence.join('、')}`,
        '      处理：按 docs/10-技术栈适配.md 第三节补最小规范，先登记 provisional'
      ]).join('\n')
    );

    console.log(`结论：已启用 ${enabled.length} / 装箱 ${available.length} / 缺口 ${gaps.length}`);
    console.log('');
  }

  if (issues.length > 0 || options.check) {
    console.log(formatReport(issues, '技术栈自检'));
    console.log(
      `📊 探测统计：文件 ${files.length} 个，耗时 ${Date.now() - START}ms，错误 ${errors.length}，警告 ${warnings.length}`
    );
    console.log(formatSummary(errors.length));
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('技术栈探测失败：', error);
  process.exit(1);
});
