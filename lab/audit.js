// audit.js — Playwright自動UX監査（[2]）
// アプリを実ブラウザで起動→ペルソナデータ注入→主要画面を巡回→スクショ/コンソール/ヒューリスティック収集
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startStaticServer } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // coffee-log/

const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 相当

export async function auditPersona(key, { headless = true } = {}) {
  const data = JSON.parse(readFileSync(join(__dirname, 'data', `${key}.json`), 'utf-8'));
  const shotsDir = join(__dirname, 'artifacts', key);
  mkdirSync(shotsDir, { recursive: true });

  const { server, port } = await startStaticServer(ROOT);
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  const findings = [];
  const shots = [];
  const add = (sev, screen, msg) => findings.push({ sev, screen, msg });

  const shot = async (name, label) => {
    const file = join(shotsDir, `${name}.png`);
    const buf = await page.screenshot({ path: file });
    shots.push({ name, label, file, b64: buf.toString('base64') });
  };
  const overflowCheck = async (screen) => {
    const ov = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    if (ov > 3) add('med', screen, `横スクロールが発生（はみ出し ${ov}px）。要素のはみ出しを確認。`);
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?lab`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderHome === 'function' && document.getElementById('ver'), { timeout: 15000 });

    // ペルソナデータ注入（preview_evalと同じ手法：トップレベルlet束縛にbareアクセス）
    await page.evaluate((d) => {
      cafes.length = 0; visits.length = 0; wishes.length = 0;
      cafes.push(...d.cafes); visits.push(...d.visits); wishes.push(...d.wishes);
      visits.sort((a, b) => b.date.localeCompare(a.date));
      renderAll();
    }, data);
    await page.waitForTimeout(500);

    const ver = await page.$eval('#ver', (e) => e.textContent).catch(() => '?');

    // ---- HOME ----
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot('01-home-top', 'ホーム上部（ヘッダー・統計・最新の一杯）');
    await overflowCheck('home');
    const home = await page.evaluate(() => ({
      hasHero: !!document.querySelector('.hero'),
      hasStatband: !!document.querySelector('.statband'),
      hasBeanmile: !!document.querySelector('.beanmile'),
      hasMemory: !!document.querySelector('.memory'),
      hasWishlist: !!document.querySelector('.wishrow'),
      hasRevisit: !!document.querySelector('.revisit'),
      hasBadges: !!document.querySelector('.badges'),
      entries: document.querySelectorAll('.entry').length,
      visits: visits.length,
    }));
    if (home.visits > 0 && !home.hasHero) add('high', 'home', '記録があるのにヒーロー（最新の一杯）が表示されていない。');
    if (home.visits > 0 && !home.hasStatband) add('high', 'home', '統計バンドが表示されていない。');

    // ホーム中盤・下部
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
    await page.waitForTimeout(250);
    await shot('02-home-mid', 'ホーム中盤（思い出・気になる・今月の一冊）');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    await shot('03-home-bottom', 'ホーム下部（アーカイブ・記章）');

    // ---- CAFES ----
    await page.evaluate(() => show('cafes'));
    await page.waitForTimeout(400);
    await shot('04-cafes', 'カフェ一覧（コレクション）');
    await overflowCheck('cafes');
    const cafeCards = await page.evaluate(() => document.querySelectorAll('.cafecard').length);
    if (data.cafes.length > 0 && cafeCards === 0) add('high', 'cafes', 'カフェがあるのに一覧が空。');

    // ---- MAP ----
    await page.evaluate(() => show('map'));
    await page.waitForTimeout(1200);
    await shot('05-map', '地図（ピン・旅の軌跡・パスポート）');
    const mapState = await page.evaluate(() => ({
      leaflet: !!document.querySelector('.leaflet-container'),
      passport: getComputedStyle(document.getElementById('passport')).display !== 'none',
      pins: document.querySelectorAll('.photo-pin,.bean-pin').length,
    }));
    if (!mapState.leaflet) add('high', 'map', '地図（Leaflet）が初期化されていない。');

    // ---- DETAIL ----
    await page.evaluate(() => { show('home'); const v = visits[0]; if (v) openVisit(v.id); });
    await page.waitForTimeout(500);
    await shot('06-detail', '記録詳細（ページめくり・味覚チャート）');
    await overflowCheck('detail');

    // ---- RECORD SHEET ----
    await page.evaluate(() => { closeLightbox && closeLightbox(); show('home'); openAdd(); });
    await page.waitForTimeout(500);
    await shot('07-record', '記録シート（入力フォーム）');
    const rec = await page.evaluate(() => {
      const sb = document.getElementById('saveBtn');
      const r = sb ? sb.getBoundingClientRect() : null;
      const bar = document.querySelector('.btnrow.sticky');
      return {
        saveVisible: r ? (r.top < innerHeight && r.bottom > 0) : false,
        stickyPos: bar ? getComputedStyle(bar).position : null,
        sheetScrollH: document.getElementById('sheet').scrollHeight,
      };
    });
    if (!rec.saveVisible) add('high', 'record', '保存ボタンが画面内に見えない（スクロールしないと押せない恐れ）。');
    if (rec.stickyPos !== 'sticky') add('med', 'record', '保存バーがstickyになっていない。');
    await page.evaluate(() => closeSheet());
    await page.waitForTimeout(200);

    // ---- ACCOUNT / DATA ----
    await page.evaluate(() => openAccount());
    await page.waitForTimeout(400);
    await shot('08-account', 'データ画面（バックアップ状態・書き出し/読み込み）');
    await page.evaluate(() => closeSheet());

    for (const e of consoleErrors) add('high', 'console', 'コンソールエラー: ' + e.slice(0, 200));

    return { key, label: data.persona, ver, counts: { visits: data.visits.length, cafes: data.cafes.length, wishes: data.wishes.length }, home, mapState, findings, shots, consoleErrors };
  } finally {
    await browser.close();
    server.close();
  }
}

// CLI: node audit.js <persona> [--headed]
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/audit.js')) {
  const key = process.argv[2] || 'light';
  const headless = !process.argv.includes('--headed');
  auditPersona(key, { headless }).then((r) => {
    writeFileSync(join(__dirname, 'artifacts', `${key}.json`), JSON.stringify({ ...r, shots: r.shots.map(s => ({ name: s.name, label: s.label, file: s.file })) }, null, 2));
    console.log(`\n[${key}] ver ${r.ver} / visits ${r.counts.visits} cafes ${r.counts.cafes}`);
    console.log(`findings: ${r.findings.length}, console errors: ${r.consoleErrors.length}`);
    for (const f of r.findings) console.log(`  [${f.sev}] (${f.screen}) ${f.msg}`);
    console.log(`スクショ: lab/artifacts/${key}/`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
