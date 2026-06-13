// suggest.js — インターバルレポートを集計して IMPROVEMENT_QUEUE.md を生成
// 使い方: node suggest.js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImprovementQueue } from './reporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, 'reports');
const OUTPUT = join(__dirname, 'IMPROVEMENT_QUEUE.md');

generateImprovementQueue(REPORTS_DIR, OUTPUT);
