# Drippin Lab 🧪

AIが疑似ユーザーとしてDrippinを使い、ユーザー目線のレポートを自動生成する仕組み。
**Claudeのコンテキストを疑似利用に使わず、レポート消費だけに回す**のが目的。

## 仕組み
```
[1] データ生成     personas.js     1年分×複数ペルソナの記録を決定論的に生成（無料）
[2] 自動UX監査     audit.js        Playwrightで実ブラウザ起動→データ注入→全画面巡回→スクショ/コンソール/ヒューリスティック
[3] AIレビュー     review.js       Haikuが各画面のスクショを見て「ユーザー目線」で感想＋改善提案（激安）
 →  run.js         上記を束ねて lab/reports/SUMMARY.md を出力
```
アプリは `?lab` で起動するとWebGL背景をOFFにし、監査を安定化。

## セットアップ（初回のみ）
```powershell
cd lab
npm install
npx playwright install chromium
```
AIレビューは `C:\Users\百々廣久\Desktop\x-company\config\.env` の `ANTHROPIC_API_KEY` を使用。

## 使い方
```powershell
# 全部入り（既定3ペルソナ: light/heavy/explorer）
node run.js

# ペルソナ指定 / 全ペルソナ
node run.js light heavy
node run.js all

# AIレビュー無し（高速・無料）
node run.js light --no-ai

# データ生成だけ（アプリの ☁→読み込み で取り込める）
node generate-data.js

# 単体監査（デバッグ。--headed でブラウザ表示）
node audit.js heavy --headed
```

## ペルソナ
| key | 内容 |
|---|---|
| newbie | 新規（1〜2件・ほぼ空状態のテスト） |
| light | 週1・お気に入り中心 |
| heavy | ほぼ毎日・大量記録（スケールのテスト） |
| explorer | 常に新店・地図広域 |
| moody | 波がある（バースト＋空白期） |

## 出力
- `reports/SUMMARY.md` ← **Claudeはまずこれを読む**
- `reports/<persona>.md` 各ペルソナの詳細＋AIレビュー
- `artifacts/<persona>/*.png` スクショ
- `data/<persona>.json` 生成データ（アプリにimport可能）

## 🎬 ゲーム風シアター（可視化）
AIくんがスマホを触って試行錯誤・作戦会議する様子を、本物のスクショで再生する。
```powershell
node theater.js                 # 既定4ペルソナで監査→劇場をサーバ配信（URL表示・Ctrl+Cで停止）
node theater.js heavy --no-ai   # AIレビュー無し・ヘビーのみ
node theater.js all --build-only # session.jsonだけ生成（配信しない）
```
- 左=スマホ（本物のスクショが切替）/ 右=AIキャラ（戦略長📋・テスター・レビ子🔍）が喋る
- PDCA（Plan作戦→Do疑似利用→Check検証→Act改善）をゲーム風に再生・ループ
- ペルソナタブで切替、「このAIのレポート」で詳細（AIレビュー込み）を表示
- 出力: `viewer/session.json`（スクショ込み）。ビューア本体: `viewer/index.html`

## モデル変更
`LAB_MODEL` 環境変数で上書き可（既定 Haiku）。深掘りしたい時だけ `LAB_MODEL=claude-opus-4-8 node run.js light`。
