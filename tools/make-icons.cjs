// make-icons.cjs — icon.svg からホーム画面用の PNG を書き出す（Chrome で描画）。
// 実行: NODE_PATH=$(npm root -g) node tools/make-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-512-maskable.png', 512], // 図柄は安全域（中心から半径40%）に収まるので同じ絵で良い
  ['apple-touch-icon.png', 180],
];

(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    for (const [name, size] of OUT) {
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent(`<html><body style="margin:0">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
      await page.screenshot({ path: path.join(ROOT, name), clip: { x: 0, y: 0, width: size, height: size } });
      console.log('wrote', name);
    }
  } finally {
    await browser.close();
  }
})();
