#!/usr/bin/env node
/**
 * 流程信息图导出脚本
 *
 * 把 assets/src/*.html 渲染成 assets/*.png，用于 README 与文档配图。
 * 图片是文档的可视化摘要，不是事实来源；正文改动后请同步重出配图。
 *
 * 用法：
 *   node scripts/build-posters.mjs                     渲染全部
 *   node scripts/build-posters.mjs workflow-overview   只渲染指定图，可多个
 *   node scripts/build-posters.mjs --check-only        只做排版自检，不写文件
 *   node scripts/build-posters.mjs --width 1400 --scale 2
 *   node scripts/build-posters.mjs --no-compress       输出未压缩 PNG
 *
 * 依赖：
 *   playwright  必需。缺失时给出安装提示，不影响其余门禁。
 *   sharp       可选。存在时把 PNG 压成 128 色调色板，体积约降六成。
 *
 * 退出码：0 正常；1 排版自检未通过；2 参数或文件问题；3 运行环境不满足。
 */

import { readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'assets', 'src');
const OUT_DIR = path.join(ROOT, 'assets');

/** 排版自检：正文与右侧标签框之间至少留出的间距，单位为 CSS 像素 */
const MIN_CLEARANCE = 12;
/** 条带斜切后，右缘相对矩形边界的内缩量，用于判断文本是否压出条带 */
const BAND_INSET = 30;

function fail(message, code = 2) {
  console.error(`[信息图] ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { names: [], width: 1400, scale: 2, compress: true, checkOnly: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--width') options.width = Number(argv[(index += 1)]);
    else if (arg === '--scale') options.scale = Number(argv[(index += 1)]);
    else if (arg === '--no-compress') options.compress = false;
    else if (arg === '--check-only') options.checkOnly = true;
    else if (arg.startsWith('--')) fail(`未知参数：${arg}`);
    else options.names.push(arg);
  }

  if (!Number.isFinite(options.width) || options.width < 320) fail('--width 需要是 320 以上的数字');
  if (!Number.isFinite(options.scale) || options.scale < 1) fail('--scale 需要是 1 以上的数字');

  return options;
}

/** 依次在仓库、当前目录、环境变量指定的位置尝试解析模块，便于接入业务项目后复用 */
function loadModule(name) {
  const bases = [process.cwd(), ROOT];
  if (process.env.POSTER_MODULE_ROOT) bases.unshift(path.resolve(process.env.POSTER_MODULE_ROOT));

  for (const base of bases) {
    try {
      return createRequire(path.join(base, 'index.js'))(name);
    } catch {
      // 换下一个位置继续尝试
    }
  }

  try {
    return createRequire(import.meta.url)(name);
  } catch {
    return null;
  }
}

async function launchBrowser(playwright) {
  try {
    return await playwright.chromium.launch();
  } catch (first) {
    try {
      return await playwright.chromium.launch({ channel: 'chrome' });
    } catch {
      fail(
        `无法启动浏览器：${first.message}\n` +
          '  请执行 npx playwright install chromium，或安装本机 Chrome 后重试',
        3
      );
    }
  }
}

/** 在页面里做排版自检：正文不得溢出条带，也不得压到右侧标签框 */
async function inspectLayout(page) {
  return page.evaluate((inset) => {
    const rows = [...document.querySelectorAll('.row')];

    return rows.map((row, index) => {
      const line = row.querySelector('.nm .line');
      const sub = row.querySelector('.nm .sub');
      const tag = row.querySelector('.tag');
      const band = row.querySelector('.band').getBoundingClientRect();
      const tip = tag.getBoundingClientRect().left - 17;

      const textBox = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };

      const boxes = [textBox(line), textBox(sub)];

      return {
        row: index + 1,
        title: line.textContent.trim(),
        tagClearance: Math.round(Math.min(...boxes.map((box) => tip - box.right))),
        bandClearance: Math.round(Math.min(...boxes.map((box) => band.right - inset - box.right)))
      };
    });
  }, BAND_INSET);
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const options = parseArgs(process.argv.slice(2));

const sources = (await readdir(SRC_DIR).catch(() => [])).filter((name) => name.endsWith('.html')).sort();
if (sources.length === 0) fail(`未找到 HTML 源文件：${path.relative(ROOT, SRC_DIR)}`, 2);

const targets = options.names.length
  ? sources.filter((name) => options.names.includes(path.basename(name, '.html')))
  : sources;
if (targets.length === 0) fail(`未找到指定信息图：${options.names.join('、')}`, 2);

const playwright = loadModule('playwright');
if (!playwright) fail('未找到 playwright，请先执行 npm i -D playwright && npx playwright install chromium', 3);
const sharp = loadModule('sharp');

const browser = await launchBrowser(playwright);
const page = await browser.newPage({
  viewportSize: { width: options.width, height: 1000 },
  deviceScaleFactor: options.scale
});

const summary = [];
let problems = 0;

for (const file of targets) {
  const name = path.basename(file, '.html');
  await page.goto(pathToFileURL(path.join(SRC_DIR, file)).href);
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const rows = await inspectLayout(page);
  const failed = rows.filter((row) => row.tagClearance < MIN_CLEARANCE || row.bandClearance < 0);
  problems += failed.length;

  for (const row of failed) {
    console.error(
      `[信息图] 排版自检未通过：${name} 第 ${row.row} 行「${row.title}」` +
        `——距标签框 ${row.tagClearance}px，距条带右缘 ${row.bandClearance}px`
    );
  }

  if (options.checkOnly) {
    summary.push(`${name}  ${rows.length} 行，${failed.length ? `异常 ${failed.length} 行` : '排版正常'}`);
    continue;
  }

  const shot = await page.screenshot({ fullPage: true });
  let buffer = shot;
  let compressed = false;

  if (options.compress && sharp) {
    buffer = await sharp(shot)
      .resize({ width: options.width })
      .png({ palette: true, colours: 128, effort: 10, dither: 0.6 })
      .toBuffer();
    compressed = true;
  }

  await writeFile(path.join(OUT_DIR, `${name}.png`), buffer);

  const size = pngSize(buffer);
  summary.push(
    `${name}  ${size.width}×${size.height}  ${Math.round(buffer.length / 1024)} KB` +
      `${compressed ? '（调色板压缩）' : ''}`
  );
}

await browser.close();

for (const line of summary) console.log(`[信息图] ${line}`);
console.log(`[信息图] 完成：${summary.length} 张，排版问题 ${problems} 处`);

process.exit(problems > 0 ? 1 : 0);
