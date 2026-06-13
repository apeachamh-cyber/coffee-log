// generate-data.js — 全ペルソナの合成データを lab/data/*.json に書き出す（[1]）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERSONAS, generate } from './personas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2]; // 任意：特定ペルソナだけ

const keys = only ? [only] : Object.keys(PERSONAS);
for (const key of keys) {
  const data = generate(key);
  const out = join(__dirname, 'data', `${key}.json`);
  writeFileSync(out, JSON.stringify(data));
  console.log(`✓ ${key.padEnd(9)} ${PERSONAS[key].label}  →  visits:${data.visits.length} cafes:${data.cafes.length} wishes:${data.wishes.length}`);
}
console.log('\nlab/data/ に書き出しました。アプリの ☁ → 読み込む で取り込めます。');
