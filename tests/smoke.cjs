// smoke.cjs — 実ブラウザ(Chrome)で盤面の中身と表示を確かめる。
// 実行: NODE_PATH=$(npm root -g) node tests/smoke.cjs  （puppeteer-core + システム Chrome）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(ROOT, 'index.html')));
});

const readBoard = (page) => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.tile')].map((g) => ({
    terrain: g.dataset.terrain,
    number: g.dataset.number,
    numColor: g.querySelector('.num')?.getAttribute('fill') ?? null,
  }));
  const ports = [...document.querySelectorAll('.port')].map((g) => g.dataset.port);
  const svg = document.getElementById('board');
  const vb = svg.viewBox.baseVal;
  // 盤面の全要素が viewBox の内側に収まっているか
  let inside = true;
  for (const e of svg.querySelectorAll('polygon, circle, text, line, path')) {
    const b = e.getBBox();
    if (b.x < vb.x - 1 || b.y < vb.y - 1 || b.x + b.width > vb.x + vb.width + 1 || b.y + b.height > vb.y + vb.height + 1) inside = false;
  }
  const r = svg.getBoundingClientRect();
  const btn = document.getElementById('regen').getBoundingClientRect();
  return {
    tiles, ports, inside, vbW: vb.width, vbH: vb.height,
    svgW: r.width, svgH: r.height, btnH: btn.height,
    btnVisible: btn.bottom <= innerHeight && btn.top >= 0,
    scrollX: document.documentElement.scrollWidth > innerWidth,
  };
});

const count = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    // --- PC 横長 ---
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'load' });
    const b1 = await readBoard(page);
    const t = count(b1.tiles.map((x) => x.terrain));
    ok('タイル19枚', b1.tiles.length === 19, b1.tiles.length);
    ok('地形の内訳 木4/レンガ3/羊4/小麦4/石3/砂漠1',
      t.wood === 4 && t.brick === 3 && t.sheep === 4 && t.wheat === 4 && t.ore === 3 && t.desert === 1, JSON.stringify(t));
    const desert = b1.tiles.find((x) => x.terrain === 'desert');
    ok('砂漠に数字なし', desert && desert.number === '', JSON.stringify(desert));
    const nums = b1.tiles.filter((x) => x.number !== '').map((x) => Number(x.number)).sort((a, b) => a - b);
    ok('数字18枚が標準どおり', nums.join(',') === '2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12', nums.join(','));
    ok('6と8だけ赤', b1.tiles.filter((x) => x.number).every((x) => (x.number === '6' || x.number === '8') === (x.numColor === '#B3261E')));
    const p = count(b1.ports);
    ok('港9か所 3:1×4 と 2:1各1', b1.ports.length === 9 && p.any === 4 && ['wood', 'brick', 'sheep', 'wheat', 'ore'].every((k) => p[k] === 1), JSON.stringify(p));
    ok('PC: はみ出しなし', b1.inside);
    ok('PC: 横長の向き', b1.vbW > b1.vbH, `${b1.vbW}x${b1.vbH}`);
    ok('PC: 盤面が画面の大半を使う', b1.svgH / 800 > 0.8, (b1.svgH / 800).toFixed(2));
    await page.screenshot({ path: path.join(SHOTS, 'pc.png') });

    // --- ボタンで作り直し（20回中、配置が前回と同じだった回数は 0 のはず）---
    const sig = (b) => b.tiles.map((x) => x.terrain + x.number).join('|') + '#' + b.ports.join('|');
    let prev = sig(b1);
    let same = 0;
    let valid = true;
    for (let i = 0; i < 20; i++) {
      await page.click('#regen');
      const b = await readBoard(page);
      if (sig(b) === prev) same++;
      prev = sig(b);
      const c = count(b.tiles.map((x) => x.terrain));
      if (b.tiles.length !== 19 || c.desert !== 1 || b.ports.length !== 9 || !b.inside) valid = false;
    }
    ok('ボタンで盤面が変わる', same === 0, `同一 ${same}/20`);
    ok('作り直しても毎回正しい構成', valid);

    // --- スマホ縦 ---
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'load' });
    const b2 = await readBoard(page);
    ok('スマホ縦: 盤面を回して縦長に', b2.vbH > b2.vbW, `${b2.vbW}x${b2.vbH}`);
    ok('スマホ縦: はみ出しなし', b2.inside);
    ok('スマホ縦: 横スクロールなし', !b2.scrollX);
    ok('スマホ縦: ボタンが画面内・44px以上', b2.btnVisible && b2.btnH >= 44, b2.btnH);
    await page.screenshot({ path: path.join(SHOTS, 'phone-portrait.png') });

    // --- スマホ横 ---
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 200));
    const b3 = await readBoard(page);
    ok('スマホ横: 回転を戻す', b3.vbW > b3.vbH, `${b3.vbW}x${b3.vbH}`);
    ok('スマホ横: はみ出しなし', b3.inside);
    await page.screenshot({ path: path.join(SHOTS, 'phone-landscape.png') });

    ok('コンソールエラーなし', errors.length === 0, errors.join(' / '));
  } finally {
    await browser.close();
    server.close();
  }
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra !== '' ? '  (' + r.extra + ')' : ''}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
