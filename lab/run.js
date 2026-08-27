// run.js — オーケストレーション: データ生成 → 自動監査 → AIレビュー → レポート出力
// 使い方: node run.js                （既定3ペルソナ）
//        node run.js light heavy      （指定ペルソナ）
//        node run.js all              （全ペルソナ）
//        node run.js light --no-ai    （AIレビュー無しで高速）
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { PERSONAS, generate } from './personas.js';
import { auditPersona } from './audit.js';
import { reviewPersona } from './review.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS = join(__dirname, 'reports');
mkdirSync(REPORTS, { recursive: true });

const args = process.argv.slice(2);
const noAI = args.includes('--no-ai');
let keys = args.filter(a => !a.startsWith('--'));
if (keys.includes('all')) keys = Object.keys(PERSONAS);
if (!keys.length) keys = ['light', 'heavy', 'explorer'];

const SEV_ORDER = { high: 0, med: 1, low: 2 };
const today = new Date().toISOString().slice(0, 10);

function findingsTable(findings) {
  if (!findings.length) return '_自動検出された不具合なし_ ✅\n';
  return ['| 重要度 | 画面 | 内容 |', '|---|---|---|',
    ...findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev])
      .map(f => `| ${f.sev === 'high' ? '🔴 高' : f.sev === 'med' ? '🟠 中' : '🟡 低'} | ${f.screen} | ${f.msg} |`)].join('\n') + '\n';
}

const allFindings = [];
const summaries = [];

for (const key of keys) {
  const p = PERSONAS[key];
  console.log(`\n=== ${key} (${p.label}) ===`);

  // [1] データ生成
  const data = generate(key);
  writeFileSync(join(__dirname, 'data', `${key}.json`), JSON.stringify(data));
  console.log(`  data: visits ${data.visits.length} / cafes ${data.cafes.length} / wishes ${data.wishes.length}`);

  // [2] 自動監査
  console.log('  auditing (Playwright)...');
  const audit = await auditPersona(key);
  console.log(`  findings: ${audit.findings.length}, console errors: ${audit.consoleErrors.length}`);

  // [3] AIレビュー
  let review = { markdown: '_（--no-ai 指定のためスキップ）_', skipped: true };
  if (!noAI) {
    console.log('  AI review (Haiku)...');
    try { review = await reviewPersona(audit); }
    catch (e) { review = { markdown: `> ⚠️ AIレビュー失敗: ${e.message}`, skipped: true }; console.warn('  review error:', e.message); }
    if (review.usage) console.log(`  tokens in/out: ${review.usage.input_tokens}/${review.usage.output_tokens}`);
  }

  audit.findings.forEach(f => allFindings.push({ ...f, persona: key }));

  // レポート出力
  const shotLinks = audit.shots.map(s => `- ![${s.label}](${relative(REPORTS, s.file).replace(/\\/g, '/')}) — ${s.label}`).join('\n');
  const md = `# Drippin Lab レポート — ${p.label}
> ペルソナ: \`${key}\` / アプリ ${audit.ver} / 生成日 ${today}
> 記録 ${audit.counts.visits}件 ・ カフェ ${audit.counts.cafes}軒 ・ 気になる ${audit.counts.wishes}軒

## 🤖 自動検出（ヒューリスティック）
${findingsTable(audit.findings)}
${audit.consoleErrors.length ? `\n**コンソールエラー ${audit.consoleErrors.length}件**:\n\`\`\`\n${audit.consoleErrors.slice(0, 10).join('\n')}\n\`\`\`\n` : ''}
## 🧑 AIユーザー目線レビュー${review.model ? `（${review.model}）` : ''}
${review.markdown}

## 📸 スクリーンショット
${shotLinks}
`;
  writeFileSync(join(REPORTS, `${key}.md`), md);
  console.log(`  → reports/${key}.md`);

  summaries.push({ key, label: p.label, counts: audit.counts, findings: audit.findings.length, errors: audit.consoleErrors.length });
}

// SUMMARY
const high = allFindings.filter(f => f.sev === 'high');
const med = allFindings.filter(f => f.sev === 'med');
const summary = `# Drippin Lab — サマリー（${today}）
Claudeはこのファイルだけ読めばOK。詳細は各ペルソナのレポートへ。

## ペルソナ別ダッシュボード
| ペルソナ | 記録 | カフェ | 気になる | 検出 | エラー | レポート |
|---|---|---|---|---|---|---|
${summaries.map(s => `| ${s.label} | ${s.counts.visits} | ${s.counts.cafes} | ${s.counts.wishes} | ${s.findings} | ${s.errors} | [${s.key}](./${s.key}.md) |`).join('\n')}

## 🔴 高優先の検出（${high.length}件）
${high.length ? high.map(f => `- (${f.persona}/${f.screen}) ${f.msg}`).join('\n') : '_なし_ ✅'}

## 🟠 中優先の検出（${med.length}件）
${med.length ? med.map(f => `- (${f.persona}/${f.screen}) ${f.msg}`).join('\n') : '_なし_'}

## 次アクション
各レポートの「AIユーザー目線レビュー → 改善提案TOP5」を読み、共通して挙がる項目から着手する。
`;
writeFileSync(join(REPORTS, 'SUMMARY.md'), summary);
console.log(`\n✅ 完了 → lab/reports/SUMMARY.md（${summaries.length}ペルソナ）`);
