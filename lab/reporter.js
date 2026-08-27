// reporter.js — サイクル横断でのバグ頻度分析・改善提案キュー生成
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 複数サイクルの findings を横断集計して interval レポートを書く
 */
export function generateIntervalReport(cycles, reportNum, reportsDir) {
  mkdirSync(reportsDir, { recursive: true });

  // finding を "screen||msg||sev" キーで集計（1サイクル内重複なし）
  const freq = {};
  for (const c of cycles) {
    const seen = new Set();
    for (const p of c.personas) {
      for (const f of p.findings) {
        const key = `${f.screen}||${f.msg}||${f.sev}`;
        if (!seen.has(key)) {
          seen.add(key);
          freq[key] = (freq[key] || 0) + 1;
        }
      }
    }
  }

  const total = cycles.length;
  const ranked = Object.entries(freq)
    .map(([key, count]) => {
      const [screen, msg, sev] = key.split('||');
      return { screen, msg, sev, count, rate: count / total };
    })
    .sort((a, b) => b.count - a.count);

  const confirmed = ranked.filter(r => r.rate >= 0.6);
  const possible  = ranked.filter(r => r.rate >= 0.3 && r.rate < 0.6);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  let md = `# インターバルレポート #${reportNum}\n`;
  md += `生成: ${now} / 対象サイクル: ${total}回\n\n`;

  md += `## 確定バグ（${total}回中60%以上で検出）\n`;
  if (confirmed.length === 0) {
    md += `なし ✅\n`;
  } else {
    for (const r of confirmed) {
      md += `- [${r.sev}] **${r.screen}**: ${r.msg}（${r.count}/${total}回 = ${Math.round(r.rate * 100)}%）\n`;
    }
  }

  md += `\n## 要観察（30〜59%）\n`;
  if (possible.length === 0) {
    md += `なし\n`;
  } else {
    for (const r of possible) {
      md += `- [${r.sev}] ${r.screen}: ${r.msg}（${r.count}/${total}回）\n`;
    }
  }

  // AIレビューの頻出キーワード抽出
  const aiTexts = cycles.flatMap(c => c.personas.map(p => p.aiReview || '')).filter(Boolean);
  if (aiTexts.length > 0) {
    const keywords = ['離脱', '迷った', 'つまずき', '改善', '不明', 'わかりにくい', '見づらい', 'エラー', '遅い', '豆', 'バックアップ', 'ピン'];
    const hit = keywords.filter(k => aiTexts.filter(t => t.includes(k)).length >= Math.ceil(aiTexts.length * 0.5));
    if (hit.length > 0) {
      md += `\n## AIレビュー頻出テーマ（過半数のレビューで言及）\n`;
      md += hit.map(k => `- 「${k}」`).join('\n') + '\n';
    }
  }

  md += `\n---\n*次のアクション: \`node suggest.js\` で改善提案キューを生成*\n`;

  const filename = join(reportsDir, `interval-${String(reportNum).padStart(3, '0')}.md`);
  writeFileSync(filename, md);
  return { filename, confirmed, possible };
}

/**
 * 全インターバルレポートを集計して IMPROVEMENT_QUEUE.md を生成
 */
export function generateImprovementQueue(reportsDir, outputPath) {
  if (!existsSync(reportsDir)) { console.log('レポートがまだありません。'); return null; }

  const files = readdirSync(reportsDir).filter(f => f.startsWith('interval-')).sort();
  if (files.length === 0) { console.log('インターバルレポートなし。'); return null; }

  const allLines = files.flatMap(f => readFileSync(join(reportsDir, f), 'utf8').split('\n'));
  const bugLines = allLines.filter(l => l.match(/^\- \[(?:high|med|low)\]/));

  const tally = {};
  for (const l of bugLines) {
    const m = l.match(/\[(\w+)\] \*{0,2}(.+?)\*{0,2}: (.+?)（(\d+)\/(\d+)/);
    if (!m) continue;
    const key = `${m[2]}:${m[3]}`;
    if (!tally[key]) tally[key] = { sev: m[1], screen: m[2], msg: m[3], totalMentions: 0 };
    tally[key].totalMentions += parseInt(m[4]);
  }

  const sevScore = { high: 3, med: 2, low: 1 };
  const queue = Object.values(tally).sort(
    (a, b) => (sevScore[b.sev] * b.totalMentions) - (sevScore[a.sev] * a.totalMentions)
  );

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  let md = `# IMPROVEMENT_QUEUE.md\n`;
  md += `更新: ${now} / インターバルレポート ${files.length}本の集計\n\n`;
  md += `## 優先度順・修正キュー\n\n`;

  queue.slice(0, 10).forEach((q, i) => {
    md += `### ${i + 1}. [${q.sev}] ${q.screen} — ${q.msg}\n`;
    md += `累計言及: ${q.totalMentions}回\n\n`;
  });

  md += `---\n*Claudeに「IMPROVEMENT_QUEUEを見て修正して」と伝えると改善実施*\n`;
  writeFileSync(outputPath, md);
  console.log(`✓ ${outputPath} を生成しました`);
  return queue;
}
