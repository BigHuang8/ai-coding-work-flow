import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODE = process.execPath;

function run(script, args = [], cwd = ROOT) {
  return spawnSync(NODE, [path.join(ROOT, script), ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('当前模板版本通过一致性检查', () => {
  const result = run('scripts/check-version.mjs');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /模板版本一致/);
});

test('模板版本漂移时检查失败', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'hqc-version-'));
  try {
    await mkdir(path.join(target, 'templates'));
    await writeFile(path.join(target, 'package.json'), '{"version":"9.9.9"}\n', 'utf8');
    await writeFile(path.join(target, 'README.md'), '**模板版本**：1.0.0\n', 'utf8');
    await writeFile(path.join(target, 'CHANGELOG.md'), '## [1.0.0] - 2026-09-27\n', 'utf8');
    const result = run('scripts/check-version.mjs', ['--path', target]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /版本一致性检查未通过/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('复制到业务项目的版本检查会明确跳过模板专属校验', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'hqc-project-'));
  try {
    await mkdir(path.join(target, 'scripts'), { recursive: true });
    const copied = path.join(target, 'scripts/check-version.mjs');
    await copyFile(path.join(ROOT, 'scripts/check-version.mjs'), copied);
    const result = spawnSync(NODE, [copied], { cwd: target, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /业务项目，跳过/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('接入项目残留关键占位符时被拦截', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'hqc-placeholder-'));
  try {
    await writeFile(path.join(target, 'AGENTS.md'), '# <项目名> AI 协作总纲\n', 'utf8');
    const failed = run('scripts/check-placeholders.mjs', ['--path', target]);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /<项目名>/);

    await writeFile(path.join(target, 'AGENTS.md'), '# 客户中心 AI 协作总纲\n', 'utf8');
    const passed = run('scripts/check-placeholders.mjs', ['--path', target]);
    assert.equal(passed.status, 0, passed.stderr || passed.stdout);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('bootstrap 按显式平台生成对应产物且不生成另一平台', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'hqc-bootstrap-'));
  try {
    await writeFile(path.join(target, 'README.md'), '# 示例项目\n', 'utf8');
    await writeFile(path.join(target, 'AGENTS.md'), '# 示例项目 AI 协作总纲\n', 'utf8');
    await writeFile(path.join(target, 'SPEC.md'), '# 需求规格说明书\n', 'utf8');
    await writeFile(path.join(target, 'MEMORY.md'), '# 决策索引\n', 'utf8');
    const result = run('scripts/bootstrap.mjs', ['--target', target, '--platform', 'github']);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = JSON.parse(await readFile(path.join(target, 'workflow.config.json'), 'utf8'));
    assert.equal(config.platform, 'github');
    assert.equal(await fileExists(path.join(target, '.github/workflows/standards.yml')), true);
    assert.equal(await fileExists(path.join(target, '.gitlab-ci.yml')), false);

    const targetPackage = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(typeof targetPackage.scripts.validate, 'string');
    assert.equal(targetPackage.scripts.test, undefined);
    assert.doesNotMatch(targetPackage.scripts.validate, /npm run test/);

    const ownersFile = path.join(target, '.github/CODEOWNERS');
    const owners = await readFile(ownersFile, 'utf8');
    await writeFile(ownersFile, owners.replaceAll('@your-team/', '@example/'), 'utf8');

    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run validate'] : ['run', 'validate'];
    const validation = spawnSync(command, args, {
      cwd: target,
      encoding: 'utf8'
    });
    assert.equal(
      validation.status,
      0,
      validation.stderr || validation.stdout || validation.error?.message || JSON.stringify(validation)
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

async function fileExists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}
