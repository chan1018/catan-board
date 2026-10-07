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

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
// PNG の幅と高さ（IHDR）
const pngSize = (file) => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
// 実際に指で押したときと同じく、その位置の最前面の要素を押す
const realTap = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (top !== el && !el.contains(top)) return false;
  top.click();
  return true;
}, sel);
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
}, sel);

const readBoard = (page) => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.tile')].map((g) => ({
    terrain: g.dataset.terrain,
    number: g.dataset.number,
    numColor: g.querySelector('.num')?.getAttribute('fill') ?? null,
  }));
  const ports = [...document.querySelectorAll('.port')].map((g) => g.dataset.port);
  // 枠パーツごとに「何番目の辺に何の港」かをまとめる（並びは slot 順）
  const frames = [0, 1, 2, 3, 4, 5].map((k) => [...document.querySelectorAll(`.port[data-slot="${k}"]`)]
    .map((g) => `${g.dataset.edge}:${g.dataset.port}`).sort().join(','));
  const seams = document.querySelectorAll('.seam').length;
  const svg = document.getElementById('board');
  const vb = svg.viewBox.baseVal;
  // 盤面の全要素が viewBox の内側に収まっているか
  let inside = true;
  for (const e of svg.querySelectorAll('polygon, circle, text, line, path')) {
    const b = e.getBBox();
    if (b.x < vb.x - 1 || b.y < vb.y - 1 || b.x + b.width > vb.x + vb.width + 1 || b.y + b.height > vb.y + vb.height + 1) inside = false;
  }
  // 画面上の文字の大きさ(px) = font-size × 拡大率
  const scale = svg.getScreenCTM().a;
  const minPx = (sel) => Math.min(...[...svg.querySelectorAll(sel)].map((e) => Number(e.getAttribute('font-size')) * scale));
  // 地形名と数字チップが重ならないか・港の札どうしが重ならないか
  let overlap = false;
  for (const g of svg.querySelectorAll('.tile')) {
    const label = g.querySelector('.label').getBBox();
    const chip = g.querySelector('circle');
    if (g.dataset.number && label.y + label.height > Number(chip.getAttribute('cy')) - Number(chip.getAttribute('r'))) overlap = true;
  }
  const portCircles = [...svg.querySelectorAll('.port circle')].map((c) => ['cx', 'cy', 'r'].map((k) => Number(c.getAttribute(k))));
  portCircles.forEach((a, i) => portCircles.slice(i + 1).forEach((b) => {
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < a[2] + b[2]) overlap = true;
  }));
  const px = { num: minPx('.num'), label: minPx('.label'), port: minPx('.port-name') };
  const compact = svg.dataset.compact;
  const r = svg.getBoundingClientRect();
  const btn = document.getElementById('regen').getBoundingClientRect();
  return {
    tiles, ports, frames, seams, inside, px, compact, overlap, vbW: vb.width, vbH: vb.height,
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
    // 写真の枠パーツ6枚: 1番目の辺に3:1＋4番目に2:1（小麦・レンガ・羊）／3番目に1つ（石・木・3:1）
    const PIECES = ['0:any,3:wheat', '0:any,3:brick', '0:any,3:sheep', '2:ore', '2:wood', '2:any'];
    ok('港が枠パーツ6枚の組み合わせどおり', [...b1.frames].sort().join('|') === [...PIECES].sort().join('|'), b1.frames.join(' | '));
    ok('継ぎ目が6本', b1.seams === 6, b1.seams);
    // 6つの枠の位置が、上辺の枠を60度ずつ時計回りに回したものになっているか
    const slotsOk = await page.evaluate(() => {
      const key = (e) => `${e.q},${e.r},${e.i}`;
      const rot = (e, k) => {
        let { q, r, i } = e;
        for (let n = 0; n < k; n++) { [q, r] = [-r, q + r]; i = (i + 1) % 6; }
        return { q, r, i };
      };
      const top = SLOTS[0].map(key).join('|') === '0,-2,4|0,-2,5|1,-2,4|1,-2,5|2,-2,4';
      const rotated = SLOTS.every((slot, k) => slot.map(key).join('|') === SLOTS[0].map((e) => key(rot(e, k))).join('|'));
      const all = new Set(SLOTS.flat().map(key)).size === 30;
      return top && rotated && all;
    });
    ok('枠6つが外周30辺を5辺ずつ・同じ形で覆う', slotsOk);
    ok('PC: はみ出しなし', b1.inside);
    ok('PC: 横長の向き', b1.vbW > b1.vbH, `${b1.vbW}x${b1.vbH}`);
    ok('PC: 盤面が画面の大半を使う', b1.svgH / 800 > 0.8, (b1.svgH / 800).toFixed(2));
    ok('PC: 通常表示のまま（スマホ表示にならない）', b1.compact === '0', b1.compact);
    ok('PC: 重なりなし', !b1.overlap);
    await page.screenshot({ path: path.join(SHOTS, 'pc.png') });

    // --- ボタンで作り直し（20回中、配置が前回と同じだった回数は 0 のはず）---
    const sig = (b) => b.tiles.map((x) => x.terrain + x.number).join('|') + '#' + b.ports.join('|');
    let prev = sig(b1);
    let same = 0;
    let valid = true;
    const frameOrders = new Set([b1.frames.join('|')]);
    for (let i = 0; i < 20; i++) {
      await page.click('#regen');
      const b = await readBoard(page);
      if (sig(b) === prev) same++;
      prev = sig(b);
      frameOrders.add(b.frames.join('|'));
      const c = count(b.tiles.map((x) => x.terrain));
      if (b.tiles.length !== 19 || c.desert !== 1 || b.ports.length !== 9 || !b.inside) valid = false;
      if ([...b.frames].sort().join('|') !== [...PIECES].sort().join('|')) valid = false;
    }
    ok('ボタンで盤面が変わる', same === 0, `同一 ${same}/20`);
    ok('作り直しても毎回正しい構成', valid);
    ok('枠パーツの並び順も変わる', frameOrders.size >= 15, `${frameOrders.size}/21 通り`);

    // --- スマホ縦 ---
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'load' });
    const b2 = await readBoard(page);
    ok('スマホ縦: 盤面を回して縦長に', b2.vbH > b2.vbW, `${b2.vbW}x${b2.vbH}`);
    ok('スマホ縦: はみ出しなし', b2.inside);
    ok('スマホ縦: スマホ表示に切り替わる', b2.compact === '1', b2.compact);
    ok('スマホ縦: 数字14px以上・地形名10px以上・港の資源名8px以上',
      b2.px.num >= 14 && b2.px.label >= 10 && b2.px.port >= 8, JSON.stringify(Object.fromEntries(Object.entries(b2.px).map(([k, v]) => [k, v.toFixed(1)]))));
    ok('スマホ縦: 重なりなし', !b2.overlap);
    ok('スマホ縦: 横スクロールなし', !b2.scrollX);
    ok('スマホ縦: ボタンが画面内・44px以上', b2.btnVisible && b2.btnH >= 44, b2.btnH);
    await page.screenshot({ path: path.join(SHOTS, 'phone-portrait.png') });

    // --- スマホ横 ---
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 200));
    const b3 = await readBoard(page);
    ok('スマホ横: 回転を戻す', b3.vbW > b3.vbH, `${b3.vbW}x${b3.vbH}`);
    ok('スマホ横: はみ出しなし', b3.inside);
    ok('スマホ横: スマホ表示・重なりなし', b3.compact === '1' && !b3.overlap, b3.compact);
    ok('スマホ横: 盤面が高さのほぼ全部を使う', b3.svgH / 390 > 0.9, (b3.svgH / 390).toFixed(2));
    ok('スマホ横: ボタンが画面内・44px以上', b3.btnVisible && b3.btnH >= 44, b3.btnH);
    await page.screenshot({ path: path.join(SHOTS, 'phone-landscape.png') });

    // --- ホーム画面に追加（PWA）---
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const iconsOk = manifest.icons.every((ic) => {
      const f = path.join(ROOT, ic.src);
      const [w, h] = fs.existsSync(f) ? pngSize(f) : [0, 0];
      return `${w}x${h}` === ic.sizes;
    }) && pngSize(path.join(ROOT, 'apple-touch-icon.png')).join('x') === '180x180';
    ok('マニフェストのアイコンが揃っている（192/512/maskable/apple 180）', iconsOk && manifest.icons.some((i) => i.purpose === 'maskable'));
    ok('マニフェストが standalone 表示', manifest.display === 'standalone' && manifest.start_url === './');

    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'load' });
    const swOk = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]));
    ok('Service Worker が動く（オフラインで開ける）', swOk);
    ok('PC: 「ホームに追加」は出さない', !(await visible(page, '#install')));
    // オフラインでも開けるか
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    ok('オフラインでも盤面が出る', (await page.$$eval('.tile', (g) => g.length)) === 19);
    await page.setOfflineMode(false);

    const phone = await browser.newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.goto(url, { waitUntil: 'load' });
    ok('スマホ: 「ホームに追加」ボタンが出る', await visible(phone, '#install'));
    const bar = await phone.evaluate(() => ({
      title: getComputedStyle(document.querySelector('.bar h1')).display,
      btns: [...document.querySelectorAll('.bar button')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.right, r.height]; }),
      w: innerWidth,
    }));
    ok('スマホ: ボタン2つが画面内に並ぶ（44px以上）', bar.btns.every(([l, r, h]) => l >= 0 && r <= bar.w && h >= 44) && bar.btns[0][1] <= bar.btns[1][0], JSON.stringify(bar.btns.map((b) => b.map(Math.round))));
    ok('スマホ: 実タップで手順シートが開く', (await realTap(phone, '#install')) && (await visible(phone, '#sheet')));
    const steps = await phone.$$eval('#sheet-steps li', (li) => li.map((x) => x.textContent));
    ok('iPhone: 共有ボタン→ホーム画面に追加→追加 の3手順', steps.length === 3 && steps[0].includes('共有ボタン') && steps[1].includes('ホーム画面に追加'), steps[0].slice(0, 20));
    await phone.screenshot({ path: path.join(SHOTS, 'install-sheet.png') });
    ok('スマホ: 「閉じる」で閉じる', (await realTap(phone, '#sheet-close')) && !(await visible(phone, '#sheet')));
    await phone.close();

    // --- 小さいスマホ（iPhone SE 相当）---
    await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'load' });
    const b4 = await readBoard(page);
    ok('SE: はみ出しなし・重なりなし・横スクロールなし', b4.inside && !b4.overlap && !b4.scrollX);
    ok('SE: 数字14px以上', b4.px.num >= 14, b4.px.num.toFixed(1));
    await page.screenshot({ path: path.join(SHOTS, 'phone-se.png') });

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
