/* 魔鱼世界 · 打包成单个 HTML
   用法：node tools/build.mjs
   产出：dist/魔鱼世界.html

   只做纯字符串内联：把 <link rel=stylesheet> 换成 <style>，把 <script src> 换成 <script>。
   没有压缩、没有转换、没有魔法。出问题一眼能看懂。

   顺便做编码检查：带 BOM 或不是 UTF-8 的文件直接拦下来。
   这个检查有必要——中文 Windows 上编辑器很容易把文件存成 GBK，
   本机看着正常，发给别人就全是乱码。 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, '魔鱼世界.html');

const problems = [];
const inlined = [];

async function readSource(rel) {
  const buf = await readFile(join(ROOT, rel));

  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problems.push(`${rel} 带 BOM，请存成 UTF-8 无 BOM`);
  }
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD')) {
    problems.push(`${rel} 不是合法的 UTF-8（解码出现替换字符）`);
  }
  inlined.push({ rel, bytes: buf.length });
  return text;
}

async function replaceAsync(str, re, fn) {
  const jobs = [];
  str.replace(re, (...args) => { jobs.push(fn(...args)); return args[0]; });
  const done = await Promise.all(jobs);
  let i = 0;
  return str.replace(re, () => done[i++]);
}

/* ---------- 主流程 ---------- */

let html = await readSource('index.html');

/* 1. 样式 */
html = await replaceAsync(
  html,
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  async (whole, href) => {
    const css = await readSource(href);
    return `<style>\n${css}\n</style>`;
  }
);

/* 2. 脚本 */
html = await replaceAsync(
  html,
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
  async (whole, src) => {
    const js = await readSource(src);
    if (js.includes('</script')) {
      problems.push(`${src} 里出现了 </script，会提前截断标签`);
    }
    return `<script>\n${js}\n</script>`;
  }
);

/* 3. 检查有没有漏网的外部引用 */
const leftovers = [...html.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(data:|https?:|javascript:)/.test(u));
if (leftovers.length) {
  problems.push('还有没内联的外部引用：' + leftovers.join('、'));
}

/* ---------- 写文件 ---------- */

if (problems.length) {
  console.error('\n打包中止：\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('');
  process.exit(1);
}

const banner = `<!-- 魔鱼世界 · 单文件版 · 由 tools/build.mjs 生成，请勿直接改这个文件 -->\n`;
html = banner + html;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, html, 'utf8');   /* 无 BOM */

const total = Buffer.byteLength(html, 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

console.log('打包完成。\n');
for (const f of inlined) console.log(`  内联  ${f.rel.padEnd(20)} ${kb(f.bytes)}`);
console.log(`\n  产出  dist/魔鱼世界.html   ${kb(total)}`);
console.log(`  共 ${inlined.length} 个源文件，双击即可运行。\n`);
