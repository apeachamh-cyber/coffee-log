// review.js — AIユーザー目線レビュー（[3]・Haiku中心）
// auditの成果物（スクショ＋検出問題）を読み、Drippinを初めて使うユーザーの気持ちでレポートを書く
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

// APIキーは x-company の .env から拝借（コードには書かない）
const ENV_PATH = 'C:\\Users\\百々廣久\\Desktop\\x-company\\config\\.env';
if (existsSync(ENV_PATH)) config({ path: ENV_PATH, override: true });

const MODEL = process.env.LAB_MODEL || 'claude-haiku-4-5-20251001';

const SCREENS_FOR_REVIEW = ['01-home-top', '02-home-mid', '04-cafes', '05-map', '06-detail', '07-record'];

export async function reviewPersona(audit, { model = MODEL } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { markdown: '> ⚠️ ANTHROPIC_API_KEY が見つからず、AIレビューをスキップしました。', skipped: true };

  const client = new Anthropic({ apiKey });
  const shots = audit.shots.filter(s => SCREENS_FOR_REVIEW.includes(s.name));

  const findingsText = audit.findings.length
    ? audit.findings.map(f => `- [${f.sev}] (${f.screen}) ${f.msg}`).join('\n')
    : '（自動検出された不具合はなし）';

  const content = [
    { type: 'text', text:
`あなたはカフェ記録アプリ「Drippin」を今日はじめて使う実在のユーザーです。
あなたのタイプ: 「${audit.label}」（記録 ${audit.counts.visits}件 / カフェ ${audit.counts.cafes}軒 / 気になる ${audit.counts.wishes}軒）

これから、あなたがアプリを操作した各画面のスクリーンショットを順に見せます（ホーム上部→ホーム中盤→カフェ一覧→地図→記録詳細→記録フォーム）。
実際のユーザーの率直な感情で、声に出して感想を言うつもりでレビューしてください。忖度は不要。気持ちよかった所も、イラッとした所も正直に。

自動検出された不具合（参考）:
${findingsText}

以下のMarkdownフォーマットでJSONではなく文章で出力してください:

## 第一印象（3秒で受けた印象）
## 画面ごとの気持ち
（各画面、良かった点と引っかかった点を1〜2行ずつ）
## 迷った・つまずいた瞬間
## ここで離脱しそう（重要）
## 良かった点・また開きたくなる要素
## 改善提案 TOP5（優先度順・具体的に）

辛口で具体的に。「なんとなく良い」ではなく、何がどう良い/悪いかを書くこと。` },
  ];
  for (const s of shots) {
    content.push({ type: 'text', text: `▼ ${s.label}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: s.b64 } });
  }

  const res = await client.messages.create({
    model, max_tokens: 2000,
    messages: [{ role: 'user', content }],
  });
  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  return { markdown: text, model, usage: res.usage, skipped: false };
}
