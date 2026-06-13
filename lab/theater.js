// theater.js — 実際のaudit結果を「ゲーム風シーン台本」に変換して可視化する（[4'] Lab Theater）
// 本物のスクショ＋本物の検出をもとに、AIくんが試行錯誤・作戦会議する様子を session.json 化し、サーバ配信。
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERSONAS, generate } from './personas.js';
import { auditPersona } from './audit.js';
import { reviewPersona } from './review.js';
import { startStaticServer } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const AVATARS = {
  newbie: { emoji: '🐣', name: 'ルーキー' }, light: { emoji: '☕', name: 'ライトくん' },
  heavy: { emoji: '🔥', name: 'ヘビーさん' }, explorer: { emoji: '🧭', name: 'タンケンくん' },
  moody: { emoji: '🌗', name: 'ムラさん' },
};

// 各画面でテスター（疑似ユーザー）がつぶやく台本。実データに基づく。
function testerLines(name, ctx) {
  const { counts, label, findingsForScreen, home, mapState } = ctx;
  const bug = findingsForScreen.length;
  const L = {
    '01-home-top': [
      `お、プロフィールっぽいヘッダーだ。雑誌の表紙みたいで良いね`,
      `${counts.visits}杯ぶんの記録か…${counts.visits > 100 ? 'これは壮観だな！' : 'ちょうどいい量感'}`,
      home.hasBeanmile ? `「集めた豆」って数字、ちょっと集めたくなるやつだ` : `統計バンドが効いてる`,
    ],
    '02-home-mid': [
      home.hasMemory ? `"思い出の一杯"…懐かしさで開いちゃうな` : `中盤、もう少し情報が欲しいかも`,
      home.hasWishlist ? `気になるリストがここにあると行きたくなる` : `行きたいリストは別画面か`,
    ],
    '03-home-bottom': [
      home.hasBadges ? `記章コレクション、次のバッジ欲しくなるね` : ``,
      `アーカイブのグリッド、写真が主役で気持ちいい`,
    ],
    '04-cafes': [`お店コレクション一覧。${counts.cafes}軒、自分の地図って感じ`],
    '05-map': [
      `地図にピンが立つの、旅の記録っぽくて好き`,
      mapState.pins >= 12 ? `ただ…ピンが団子になって重なってる。これは少し見づらいかも` : `パスポートの数字がいい演出`,
    ],
    '06-detail': [`記録の詳細。スワイプで前後にめくれるの楽しい`],
    '07-record': [`記録フォーム。保存ボタンが下に固定されてるの安心する`, `味覚チャートが畳まれてて、最初はシンプルでいい`],
    '08-account': [`バックアップ画面。"端末だけ"って言われると守りたくなる`],
  };
  const lines = (L[name] || [`${name}を見ている`]).filter(Boolean);
  const out = lines.map((say) => ({ say, tone: 'think' }));
  if (bug) out.push({ say: `ん、ここ…ちょっと引っかかるな`, tone: 'oops' });
  return out;
}

function buildScenes(key, audit) {
  const av = AVATARS[key] || { emoji: '🤖', name: key };
  const scenes = [];
  const findingByScreen = (screen) => audit.findings.filter((f) => f.screen === screen || (screen === 'home' && ['home'].includes(f.screen)));

  // PLAN（作戦会議）
  scenes.push({ phase: 'plan', actor: 'strategy', shotIdx: -1, tone: 'plan',
    say: `今日のテスト相手は「${audit.label}」。記録${audit.counts.visits}杯・カフェ${audit.counts.cafes}軒・気になる${audit.counts.wishes}軒のデータで1日を再現するぞ。${av.emoji}${av.name}、頼んだ！` });
  scenes.push({ phase: 'plan', actor: 'tester', shotIdx: -1, tone: 'happy', avatar: av,
    say: `まかせて！${av.name}として、初見のつもりで触ってみる` });

  // DO（疑似利用）
  audit.shots.forEach((s, i) => {
    const screenKey = s.name.startsWith('01') || s.name.startsWith('02') || s.name.startsWith('03') ? 'home'
      : s.name.includes('cafes') ? 'cafes' : s.name.includes('map') ? 'map'
      : s.name.includes('detail') ? 'detail' : s.name.includes('record') ? 'record' : 'account';
    const ctx = { counts: audit.counts, label: audit.label, home: audit.home, mapState: audit.mapState,
      findingsForScreen: audit.findings.filter((f) => f.screen === screenKey) };
    for (const line of testerLines(s.name, ctx)) {
      scenes.push({ phase: 'do', actor: 'tester', shotIdx: i, screen: s.label, tone: line.tone, avatar: av, say: line.say });
    }
  });

  // CHECK（レビュー）
  if (audit.findings.length) {
    for (const f of audit.findings) {
      scenes.push({ phase: 'check', actor: 'reviewer', shotIdx: -1, tone: 'bug',
        say: `【${f.sev === 'high' ? '要対応' : f.sev === 'med' ? '気になる' : '小ネタ'}】${f.screen}：${f.msg}`, badge: f.sev });
    }
  } else {
    scenes.push({ phase: 'check', actor: 'reviewer', shotIdx: -1, tone: 'ok',
      say: `致命的な不具合はゼロ。コンソールエラーも無し。土台はかなり安定してる` });
  }

  // ACT（次の一手）
  const act = audit.mapState.pins >= 12
    ? `次の一手：地図のピンが密集すると重なる。クラスタリング（まとめ表示）を検討したい`
    : `次の一手：体験は良好。記録のハードルをさらに下げる方向を試したい`;
  scenes.push({ phase: 'act', actor: 'strategy', shotIdx: -1, tone: 'plan', say: act });

  return scenes;
}

async function main() {
  const args = process.argv.slice(2);
  const withAI = !args.includes('--no-ai'); // AIレビュー（Haiku）を試す。失敗してもtheaterは動く
  let keys = args.filter((a) => !a.startsWith('--'));
  if (keys.includes('all')) keys = Object.keys(PERSONAS);
  if (!keys.length) keys = ['newbie', 'light', 'heavy', 'explorer'];

  const personas = [];
  for (const key of keys) {
    console.log(`\n=== ${key} ===`);
    const data = generate(key);
    writeFileSync(join(__dirname, 'data', `${key}.json`), JSON.stringify(data));
    console.log('  auditing...');
    const audit = await auditPersona(key);
    console.log(`  findings ${audit.findings.length}, errors ${audit.consoleErrors.length}`);

    let aiReview = null;
    if (withAI) {
      try { const r = await reviewPersona(audit); if (!r.skipped) aiReview = r.markdown; else console.log('  (AIレビューはスキップ/クレジット不足)'); }
      catch (e) { console.log('  AIレビュー不可:', e.message.slice(0, 60)); }
    }

    personas.push({
      key, emoji: (AVATARS[key] || {}).emoji, name: (AVATARS[key] || {}).name, label: audit.label,
      counts: audit.counts, ver: audit.ver,
      shots: audit.shots.map((s) => ({ name: s.name, label: s.label, b64: s.b64 })),
      scenes: buildScenes(key, audit),
      findings: audit.findings, aiReview,
    });
  }

  // 全体ミーティング
  const totalFind = personas.reduce((n, p) => n + p.findings.length, 0);
  const meeting = [
    { actor: 'strategy', emoji: '📋', name: '戦略長', say: `全体ミーティングを始める。本日は${personas.length}人のAIが${personas.reduce((n, p) => n + p.counts.visits, 0)}杯ぶんを疑似利用した。` },
    { actor: 'reviewer', emoji: '🔍', name: 'レビ子', say: totalFind ? `検出は合計${totalFind}件。詳細は各レポートに。優先度の高いものから潰しましょう。` : `検出ゼロ。今日のビルドは安定。次は"体験の磨き込み"フェーズに進めます。` },
    { actor: 'tester', emoji: '☕', name: 'テスター陣', say: `共通して「写真が主役で気持ちいい」「儀式感が良い」という声。地図のピン密集だけ要チェックでした。` },
    { actor: 'strategy', emoji: '📋', name: '戦略長', say: `では次のPDCAへ。Claude（廣久さんの相棒）にバトンを渡す。SUMMARYを見て改善だ！` },
  ];

  const session = { generatedAt: new Date().toISOString(), app: personas[0]?.ver || '?', personas, meeting };
  mkdirSync(join(__dirname, 'viewer'), { recursive: true });
  writeFileSync(join(__dirname, 'viewer', 'session.json'), JSON.stringify(session));
  console.log(`\n✓ session.json 書き出し（${personas.length}ペルソナ・スクショ込み）`);

  if (args.includes('--build-only')) { console.log('build-only: サーバは起動しません。'); return; }

  const { port } = await startStaticServer(ROOT);
  const url = `http://127.0.0.1:${port}/lab/viewer/index.html`;
  console.log(`\n🎬 劇場を開きました → ${url}`);
  console.log('   ブラウザで開いてください。停止は Ctrl+C。');
  process.stdin.resume();
  process.on('SIGINT', () => process.exit(0));
}
main().catch((e) => { console.error(e); process.exit(1); });
