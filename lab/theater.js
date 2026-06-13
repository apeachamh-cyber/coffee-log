// theater.js — 実際のaudit結果を「ゲーム風シーン台本」に変換して可視化する（[4'] Lab Theater）
// --watch N          : N分ごとに自動サイクル（省略=1回で終了）
// --review-interval M: Mサイクルごとにインターバルレポート生成（デフォルト5）
// --no-ai            : AIレビューをスキップ
// --build-only       : JSONのみ生成してサーバ起動しない
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { PERSONAS, generate } from './personas.js';
import { auditPersona } from './audit.js';
import { reviewPersona } from './review.js';
import { startStaticServer } from './server.js';
import { generateIntervalReport } from './reporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(__dirname, 'reports');
const SESSION_PATH = join(__dirname, 'viewer', 'session.json');
const MAX_CYCLES = 10; // session.json に保持する最大サイクル数

const AVATARS = {
  newbie:   { emoji: '🐣', name: 'ルーキー' },
  light:    { emoji: '☕', name: 'ライトくん' },
  heavy:    { emoji: '🔥', name: 'ヘビーさん' },
  explorer: { emoji: '🧭', name: 'タンケンくん' },
  moody:    { emoji: '🌗', name: 'ムラさん' },
};

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
      home.hasMemory   ? `"思い出の一杯"…懐かしさで開いちゃうな` : `中盤、もう少し情報が欲しいかも`,
      home.hasWishlist ? `気になるリストがここにあると行きたくなる` : `行きたいリストは別画面か`,
    ],
    '03-home-bottom': [
      home.hasBadges ? `記章コレクション、次のバッジ欲しくなるね` : ``,
      `アーカイブのグリッド、写真が主役で気持ちいい`,
    ],
    '04-cafes':  [`お店コレクション一覧。${counts.cafes}軒、自分の地図って感じ`],
    '05-map':    [
      `地図にピンが立つの、旅の記録っぽくて好き`,
      mapState.pins >= 12 ? `ただ…ピンが団子になって重なってる。これは少し見づらいかも` : `パスポートの数字がいい演出`,
    ],
    '06-detail': [`記録の詳細。スワイプで前後にめくれるの楽しい`],
    '07-record': [`記録フォーム。保存ボタンが下に固定されてるの安心する`, `味覚チャートが畳まれてて、最初はシンプルでいい`],
    '08-account': [`バックアップ画面。"端末だけ"って言われると守りたくなる`],
  };
  const lines = (L[name] || [`${name}を見ている`]).filter(Boolean);
  const out = lines.map(say => ({ say, tone: 'think' }));
  if (bug) out.push({ say: `ん、ここ…ちょっと引っかかるな`, tone: 'oops' });
  return out;
}

function buildScenes(key, audit) {
  const av = AVATARS[key] || { emoji: '🤖', name: key };
  const scenes = [];

  scenes.push({ phase: 'plan', actor: 'strategy', shotIdx: -1, tone: 'plan',
    say: `今日のテスト相手は「${audit.label}」。記録${audit.counts.visits}杯・カフェ${audit.counts.cafes}軒・気になる${audit.counts.wishes}軒のデータで1日を再現するぞ。${av.emoji}${av.name}、頼んだ！` });
  scenes.push({ phase: 'plan', actor: 'tester', shotIdx: -1, tone: 'happy', avatar: av,
    say: `まかせて！${av.name}として、初見のつもりで触ってみる` });

  audit.shots.forEach((s, i) => {
    const screenKey = s.name.startsWith('01') || s.name.startsWith('02') || s.name.startsWith('03') ? 'home'
      : s.name.includes('cafes') ? 'cafes' : s.name.includes('map') ? 'map'
      : s.name.includes('detail') ? 'detail' : s.name.includes('record') ? 'record' : 'account';
    const ctx = { counts: audit.counts, label: audit.label, home: audit.home, mapState: audit.mapState,
      findingsForScreen: audit.findings.filter(f => f.screen === screenKey) };
    for (const line of testerLines(s.name, ctx)) {
      scenes.push({ phase: 'do', actor: 'tester', shotIdx: i, screen: s.label, tone: line.tone, avatar: av, say: line.say });
    }
  });

  if (audit.findings.length) {
    for (const f of audit.findings) {
      scenes.push({ phase: 'check', actor: 'reviewer', shotIdx: -1, tone: 'bug',
        say: `【${f.sev === 'high' ? '要対応' : f.sev === 'med' ? '気になる' : '小ネタ'}】${f.screen}：${f.msg}`, badge: f.sev });
    }
  } else {
    scenes.push({ phase: 'check', actor: 'reviewer', shotIdx: -1, tone: 'ok',
      say: `致命的な不具合はゼロ。コンソールエラーも無し。土台はかなり安定してる` });
  }

  const act = audit.mapState.pins >= 12
    ? `次の一手：地図のピンが密集すると重なる。クラスタリング（まとめ表示）を検討したい`
    : `次の一手：体験は良好。記録のハードルをさらに下げる方向を試したい`;
  scenes.push({ phase: 'act', actor: 'strategy', shotIdx: -1, tone: 'plan', say: act });

  return scenes;
}

async function runCycle(keys, withAI, cycleNum) {
  console.log(`\n━━━ PDCA サイクル #${cycleNum} 開始 ━━━`);
  const personas = [];

  for (const key of keys) {
    console.log(`\n  [${key}] データ生成中...`);
    const data = generate(key);
    writeFileSync(join(__dirname, 'data', `${key}.json`), JSON.stringify(data));

    console.log(`  [${key}] 監査中...`);
    const audit = await auditPersona(key);
    console.log(`  [${key}] findings=${audit.findings.length}, errors=${audit.consoleErrors.length}`);

    let aiReview = null;
    if (withAI) {
      try {
        const r = await reviewPersona(audit);
        if (!r.skipped) {
          aiReview = r.markdown;
          console.log(`  [${key}] AIレビュー完了 (${r.usage?.input_tokens}in / ${r.usage?.output_tokens}out tokens)`);
        } else {
          console.log(`  [${key}] AIレビュースキップ`);
        }
      } catch (e) {
        console.log(`  [${key}] AIレビュー失敗: ${e.message.slice(0, 60)}`);
      }
    }

    personas.push({
      key, emoji: (AVATARS[key] || {}).emoji, name: (AVATARS[key] || {}).name, label: audit.label,
      counts: audit.counts, ver: audit.ver,
      shots: audit.shots.map(s => ({ name: s.name, label: s.label, b64: s.b64 })),
      scenes: buildScenes(key, audit),
      findings: audit.findings, aiReview,
    });
  }

  const totalFind = personas.reduce((n, p) => n + p.findings.length, 0);
  const meeting = [
    { actor: 'strategy', emoji: '📋', name: '戦略長', say: `全体ミーティングを始める。本日は${personas.length}人のAIが${personas.reduce((n, p) => n + p.counts.visits, 0)}杯ぶんを疑似利用した。` },
    { actor: 'reviewer', emoji: '🔍', name: 'レビ子', say: totalFind ? `検出は合計${totalFind}件。詳細は各レポートに。優先度の高いものから潰しましょう。` : `検出ゼロ。今日のビルドは安定。次は"体験の磨き込み"フェーズに進めます。` },
    { actor: 'tester', emoji: '☕', name: 'テスター陣', say: `共通して「写真が主役で気持ちいい」「儀式感が良い」という声。地図のピン密集だけ要チェックでした。` },
    { actor: 'strategy', emoji: '📋', name: '戦略長', say: `では次のPDCAへ。Claude（廣久さんの相棒）にバトンを渡す。SUMMARYを見て改善だ！` },
  ];

  return { cycleNum, generatedAt: new Date().toISOString(), app: personas[0]?.ver || '?', personas, meeting };
}

function spawnClaudeFix(reportPath) {
  const prompt = `以下のDrippin Labインターバルレポートを読んで、「確定バグ」セクションに記載された問題を修正してください。

レポートファイル: ${reportPath}

作業の進め方:
1. レポートファイルを読む
2. 確定バグを1件ずつ、アプリのソースコード（C:\\Users\\百々廣久\\coffee-log\\index.html）を確認して修正
3. Drippinのコンセプト（カフェ記録×自分だけの雑誌体験・Kinfolk風エディトリアルデザイン）を守る
4. 修正が完了したら git add -A && git commit -m "fix: Drippin Lab 自動修正 #${reportPath.split(/[/\\]/).pop()}" && git push
5. 修正内容のサマリーを lab/reports/fix-log.md に追記する

注意: 確信が持てない修正は行わない。バグでなく仕様と判断できるものはスキップして理由をfix-log.mdに書く。`;

  console.log(`\n🤖 Claude Code 起動 → 自動修正開始...`);
  const proc = spawn('claude', ['-p', prompt,
    '--allowedTools', 'Read,Edit,Write,Bash',
  ], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });
  proc.on('close', code => {
    console.log(`\n✅ Claude Code 自動修正完了 (exit ${code})`);
  });
  proc.on('error', err => {
    console.log(`\n⚠️  Claude Code 起動失敗: ${err.message}`);
    console.log(`   手動で実行: claude -p "$(cat ${reportPath})" --dangerously-skip-permissions`);
  });
}

function loadCycles() {
  if (!existsSync(SESSION_PATH)) return [];
  try { return JSON.parse(readFileSync(SESSION_PATH, 'utf8')).cycles || []; }
  catch { return []; }
}

function saveSession(cycles) {
  mkdirSync(join(__dirname, 'viewer'), { recursive: true });
  const data = { cycles: cycles.slice(-MAX_CYCLES), lastUpdated: new Date().toISOString(), totalCycles: cycles.length };
  writeFileSync(SESSION_PATH, JSON.stringify(data));
}

async function main() {
  const args = process.argv.slice(2);
  const withAI = !args.includes('--no-ai');
  const buildOnly = args.includes('--build-only');

  const watchIdx = args.indexOf('--watch');
  const watchMin = watchIdx >= 0 ? (parseInt(args[watchIdx + 1]) || 10) : 0;

  const riIdx = args.indexOf('--review-interval');
  const reviewInterval = riIdx >= 0 ? (parseInt(args[riIdx + 1]) || 5) : 5;

  let keys = args.filter(a => !a.startsWith('--') && isNaN(Number(a)));
  if (keys.includes('all')) keys = Object.keys(PERSONAS);
  if (!keys.length) keys = ['newbie', 'light', 'heavy', 'explorer'];

  if (watchMin > 0) {
    console.log(`🔄 自動ループモード: ${watchMin}分ごと / インターバルレポート: ${reviewInterval}サイクルごと`);
    console.log(`   ペルソナ: ${keys.join(', ')} / AIレビュー: ${withAI ? 'あり' : 'なし'}`);
    console.log(`   停止: Ctrl+C\n`);
  }

  let intervalReportCount = 0;
  let allCyclesEver = loadCycles(); // インターバルレポート用の全サイクル蓄積

  const runOne = async () => {
    const cycleNum = allCyclesEver.length + 1;
    try {
      const cycle = await runCycle(keys, withAI, cycleNum);
      allCyclesEver.push(cycle);
      saveSession(allCyclesEver);
      console.log(`\n✓ サイクル #${cycleNum} 完了 → session.json 更新`);

      // インターバルレポート
      if (allCyclesEver.length % reviewInterval === 0) {
        intervalReportCount++;
        const result = generateIntervalReport(allCyclesEver, intervalReportCount, REPORTS_DIR);
        console.log(`\n📊 インターバルレポート #${intervalReportCount} 生成: ${result.filename}`);
        if (result.confirmed.length > 0) {
          console.log(`   確定バグ ${result.confirmed.length}件:`);
          result.confirmed.forEach(r => console.log(`   - [${r.sev}] ${r.screen}: ${r.msg}`));
          spawnClaudeFix(result.filename);
        } else {
          console.log(`   確定バグなし ✅ → Claude起動スキップ`);
        }
      }

      if (watchMin > 0) {
        console.log(`\n⏱  次のサイクルまで ${watchMin}分待機... (Ctrl+C で停止)`);
      }
    } catch (e) {
      console.error(`サイクル #${cycleNum} エラー:`, e.message);
    }
  };

  await runOne();

  if (!buildOnly) {
    if (watchMin === 0) {
      // 1回だけモード
      const { port } = await startStaticServer(ROOT);
      const url = `http://127.0.0.1:${port}/lab/viewer/index.html`;
      console.log(`\n🎬 劇場を開きました → ${url}`);
      console.log('   ブラウザで開いてください。停止は Ctrl+C。');
    } else {
      // 自動ループモード：サーバを起動してsetIntervalで回し続ける
      const { port } = await startStaticServer(ROOT);
      const url = `http://127.0.0.1:${port}/lab/viewer/index.html`;
      console.log(`\n🎬 劇場 → ${url}`);
      setInterval(runOne, watchMin * 60 * 1000);
    }
    process.stdin.resume();
    process.on('SIGINT', () => { console.log('\n\n停止しました。'); process.exit(0); });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
