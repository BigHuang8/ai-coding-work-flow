#!/usr/bin/env node
/**
 * 把工作流模板注入到业务项目
 *
 * 用法：
 *   node scripts/bootstrap.mjs --target ../your-project --dry-run
 *   node scripts/bootstrap.mjs --target ../your-project
 *   node scripts/bootstrap.mjs --target ../your-project --stack java-springboot,vue3
 *   node scripts/bootstrap.mjs --target ../your-project --force
 *
 * 默认行为：目标已存在的文件一律跳过，不覆盖。
 */

import { readdir, readFile, writeFile, mkdir, cp, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'build', 'coverage', '.cache']);

/** 注入清单：from 相对模板仓库，to 相对目标项目 */
const ENTRY_LIST = [
  { from: 'templates/project/AGENTS.md', to: 'AGENTS.md' },
  { from: 'templates/project/SPEC.md', to: 'SPEC.md' },
  { from: 'templates/project/MEMORY.md', to: 'MEMORY.md' },
  { from: 'templates/project/.env.example', to: '.env.example' },
  { from: 'templates/project/docs/API_CONTRACT.md', to: 'docs/API_CONTRACT.md' },
  { from: 'templates/project/docs/verification/README.md', to: 'docs/verification/README.md' },
  { from: 'templates/project/spec/README.md', to: 'spec/README.md' },
  { from: 'docs', to: 'docs' },
  { from: 'skills', to: 'skills' },
  { from: 'scripts', to: 'scripts' },
  { from: '.githooks', to: '.githooks' },
  { from: '.github', to: '.github' },
  { from: '.editorconfig', to: '.editorconfig' },
  { from: '.gitattributes', to: '.gitattributes' },
  { from: 'skills-lock.json', to: 'skills-lock.json' }
];

const STACK_COMMANDS = {
  'java-springboot': 'mvn test -q',
  vue3: 'npm run validate',
  uniapp: 'npm run validate',
  node: 'node scripts/check-docs.mjs',
  python: 'ruff check . && pytest -q'
};

function parseArgs(argv) {
  const options = { target: '', dryRun: false, force: false, stacks: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') options.target = argv[++i] ?? '';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--stack') options.stacks = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数：${arg}`);
      process.exit(1);
    }
  }
  return options;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.target) {
    console.log('用法：node scripts/bootstrap.mjs --target <目标项目路径> [--dry-run] [--force] [--stack java-springboot,vue3]');
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

  // 记录技术栈与推荐校验命令
  if (options.stacks.length > 0) {
    const unknown = options.stacks.filter((stack) => !STACK_COMMANDS[stack]);
    if (unknown.length > 0) {
      warnings.push(`未知技术栈标识：${unknown.join('、')}；可用值：${Object.keys(STACK_COMMANDS).join('、')}`);
    }
    const config = {
      template: 'hqc-ai-coding-work-flow',
      generatedAt: new Date().toISOString().slice(0, 10),
      stacks: options.stacks,
      suggestedValidate: Object.fromEntries(
        options.stacks.filter((stack) => STACK_COMMANDS[stack]).map((stack) => [stack, STACK_COMMANDS[stack]])
      )
    };
    const configPath = path.join(target, 'workflow.config.json');
    if (options.dryRun) {
      created.push('workflow.config.json');
    } else {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      created.push('workflow.config.json');
    }
  }

  console.log(options.dryRun ? '预览模式（未写入任何文件）' : '注入完成');
  console.log(`目标项目：${target}`);
  console.log(`模板来源：${ROOT}`);
  console.log('');
  console.log(`将写入 ${created.length} 个文件：`);
  for (const item of created) console.log(`  + ${item}`);
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
    console.log('  2. 修改 AGENTS.md 中的项目概览、模块划分与命令索引');
    console.log('  3. 修改 .github/CODEOWNERS 中的负责人');
    console.log('  4. 安装 Git 钩子：bash scripts/install-hooks.sh（或 pwsh scripts/install-hooks.ps1）');
    console.log('  5. 生成各 AI 工具入口：node scripts/sync-agent-config.mjs');
    console.log('  6. 运行自检：node scripts/check-docs.mjs');
  }
}

main().catch((error) => {
  console.error('注入失败：', error);
  process.exit(1);
});
