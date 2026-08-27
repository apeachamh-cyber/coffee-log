// personas.js — ペルソナ定義 + 合成データ生成エンジン（[1]）
// アプリのデータスキーマ（cafes/visits/wishes）に完全準拠。importData / 直接注入の両方で使える。

// 実在の福岡カフェ（おおよその座標）をシード。多様な立地で地図テスト可能。
const SEED_CAFES = [
  { name: 'COFFEE COUNTY 福岡今泉', lat: 33.5882, lng: 130.3990, tags: ['自家焙煎', 'ロースター併設'] },
  { name: 'REC COFFEE 薬院本店', lat: 33.5826, lng: 130.3962, tags: ['ハンドドリップ', '電源あり'] },
  { name: 'manu coffee 春吉店', lat: 33.5905, lng: 130.4035, tags: ['深夜営業', 'Wi-Fi'] },
  { name: '豆香洞コーヒー 大野城', lat: 33.5008, lng: 130.4787, tags: ['自家焙煎'] },
  { name: 'ABACUS COFFEE', lat: 33.5858, lng: 130.4012, tags: ['ハンドドリップ', 'スイーツ'] },
  { name: 'いるかカフェ', lat: 33.5947, lng: 130.4061, tags: ['古民家', 'テラス'] },
  { name: 'TAS COFFEE', lat: 33.5799, lng: 130.3925, tags: ['電源あり', 'Wi-Fi'] },
  { name: 'No COFFEE 平尾', lat: 33.5731, lng: 130.4072, tags: ['スイーツ'] },
  { name: 'STEREO COFFEE', lat: 33.5889, lng: 130.4068, tags: ['Wi-Fi'] },
  { name: 'コーヒービーチ', lat: 33.6015, lng: 130.3608, tags: ['テラス'] },
  { name: 'Saredo Coffee', lat: 33.5870, lng: 130.3915, tags: ['自家焙煎'] },
  { name: 'FUK COFFEE', lat: 33.5912, lng: 130.4156, tags: ['Wi-Fi', '電源あり'] },
  { name: 'CAFE & BAR BLENDY', lat: 33.5840, lng: 130.3980, tags: ['深夜営業'] },
  { name: 'ハニー珈琲 高宮', lat: 33.5663, lng: 130.4140, tags: ['自家焙煎'] },
  { name: 'kombol cafe', lat: 33.5921, lng: 130.4001, tags: ['古民家', 'スイーツ'] },
  { name: 'マメココロ', lat: 33.5778, lng: 130.4188, tags: ['テラス'] },
  { name: 'COFFEE UNIDOS', lat: 33.5810, lng: 130.3899, tags: ['ロースター併設'] },
  { name: '珈琲花坞', lat: 33.5694, lng: 130.4011, tags: ['古民家'] },
];

// wish専用候補（訪問プールと重複しない＝必ず「気になる」に残る店）
const WISH_EXTRA = [
  { name: 'ROASTERY by Nozy', lat: 33.5851, lng: 130.4002 },
  { name: 'WOODBERRY COFFEE', lat: 33.5790, lng: 130.4090 },
  { name: 'コーヒー雪文', lat: 33.5705, lng: 130.4220 },
  { name: 'FUGLEN（行きたい）', lat: 33.5933, lng: 130.4015 },
  { name: 'BLUE BOTTLE（福岡できたら）', lat: 33.5895, lng: 130.4188 },
  { name: 'PADDLERS COFFEE', lat: 33.5772, lng: 130.3955 },
  { name: 'THE LOCAL COFFEE STAND', lat: 33.5860, lng: 130.4100 },
  { name: 'TRUNK COFFEE', lat: 33.5680, lng: 130.4080 },
  { name: 'LiLo COFFEE', lat: 33.5820, lng: 130.4150 },
  { name: 'GLITCH COFFEE（夢）', lat: 33.5910, lng: 130.3990 },
];

const DRINKS = [
  'エチオピア ハンドドリップ', 'ケニア AA', 'コロンビア スプレモ', 'グァテマラ',
  'カフェラテ', 'カプチーノ', 'フラットホワイト', 'エスプレッソ', 'アイスラテ',
  'コールドブリュー', '本日のドリップ', 'ゲイシャ', 'ブレンド（深煎り）', 'カフェモカ',
];

// オフラインでも崩れないサンプル写真（Unsplashのコーヒー写真。audit中はオンラインで読込）
const PHOTOS = [
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800',
  'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800',
  'https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=800',
  'https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=800',
  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=800',
  'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800',
  'https://images.unsplash.com/photo-1559496417-e7f25cb247f3?w=800',
];

// 決定論的な疑似乱数（seedで再現可能）
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PERSONAS = {
  newbie:   { label: '新規ユーザー（1〜2件）', months: 1, perWeek: 0.5, cafePool: 2, repeatBias: 0.2, wishes: 1, ratingMean: 3.5 },
  light:    { label: 'ライト（週1・お気に入り中心）', months: 12, perWeek: 1, cafePool: 6, repeatBias: 0.7, wishes: 4, ratingMean: 3.8 },
  heavy:    { label: 'ヘビー（ほぼ毎日・大量記録）', months: 12, perWeek: 5, cafePool: 16, repeatBias: 0.5, wishes: 9, ratingMean: 4.1 },
  explorer: { label: '開拓型（常に新店・地図広域）', months: 12, perWeek: 2, cafePool: 18, repeatBias: 0.1, wishes: 12, ratingMean: 3.6 },
  moody:    { label: '波がある（バースト＋空白期）', months: 12, perWeek: 1.5, cafePool: 8, repeatBias: 0.5, wishes: 3, ratingMean: 3.9 },
};

const uid = (rng) => Math.floor(rng() * 1e9).toString(36) + Math.floor(rng() * 1e9).toString(36);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const clampBean = (n) => Math.max(1, Math.min(5, Math.round(n)));
const gauss = (rng, mean, sd) => mean + (rng() + rng() + rng() - 1.5) * 2 * sd;

export function generate(personaKey, seed = 42) {
  const p = PERSONAS[personaKey];
  if (!p) throw new Error('unknown persona: ' + personaKey);
  const rng = mulberry32(seed + personaKey.length * 1000);

  // この人が通うカフェ集合
  const pool = [...SEED_CAFES].sort(() => rng() - 0.5).slice(0, p.cafePool)
    .map(c => ({ id: uid(rng), name: c.name, lat: c.lat, lng: c.lng, tags: c.tags }));

  const cafes = [];
  const visits = [];
  const now = Date.now();
  const start = now - p.months * 30 * 864e5;
  const dayMs = 864e5;

  // 週あたり頻度から訪問日を生成
  for (let t = start; t <= now; t += dayMs) {
    const d = new Date(t);
    // moody: 一定期間“空白期”を作る
    if (personaKey === 'moody') {
      const phase = Math.sin(t / (dayMs * 22));
      if (phase < -0.4) continue; // 空白期
    }
    const dailyProb = p.perWeek / 7;
    if (rng() > dailyProb) continue;

    // 既訪 or 新規（repeatBias）
    const visitedCafes = cafes.length ? cafes : null;
    let cafe;
    if (visitedCafes && rng() < p.repeatBias) {
      cafe = pick(rng, cafes);
    } else {
      const next = pool.find(pc => !cafes.some(c => c.id === pc.id)) || pick(rng, pool);
      if (!cafes.some(c => c.id === next.id)) cafes.push(next);
      cafe = next;
    }

    // 季節性：夏(6-8月)はアイス寄り
    const month = d.getMonth();
    const summer = month >= 5 && month <= 7;
    let drink = pick(rng, DRINKS);
    if (summer && rng() < 0.5) drink = pick(rng, ['アイスラテ', 'コールドブリュー', 'アイスコーヒー']);

    const base = p.ratingMean;
    const taste = clampBean(gauss(rng, base, 0.7));
    const space = clampBean(gauss(rng, base, 0.8));
    const again = clampBean(gauss(rng, (taste + space) / 2, 0.6));
    const hasFlavor = rng() < 0.35;
    const photoCount = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
    const photos = Array.from({ length: photoCount }, () => pick(rng, PHOTOS));

    visits.push({
      id: uid(rng), cafeId: cafe.id,
      photo: photos[0], photos,
      drink,
      taste, space, again,
      acid: hasFlavor ? clampBean(gauss(rng, 3, 1.2)) : 0,
      bitter: hasFlavor ? clampBean(gauss(rng, 3, 1.2)) : 0,
      sweet: hasFlavor ? clampBean(gauss(rng, 3, 1.2)) : 0,
      body: hasFlavor ? clampBean(gauss(rng, 3, 1.2)) : 0,
      memo: rng() < 0.4 ? pick(rng, [
        '窓際の席が落ち着く。', '浅煎りが華やかだった。', '店員さんが親切。', '少し混んでいた。',
        '豆を買って帰った。', 'また来たい。', '静かで作業に最適。', 'ケーキも美味しい。',
      ]) : '',
      date: new Date(t + Math.floor(rng() * dayMs)).toISOString(),
    });
  }

  visits.sort((a, b) => b.date.localeCompare(a.date));

  // wishlist（訪問済みと重複しない店：seedの未訪問＋wish専用候補）
  const visitedNames = new Set(cafes.map(c => c.name));
  const wishCandidates = [...SEED_CAFES.filter(c => !visitedNames.has(c.name)), ...WISH_EXTRA]
    .sort(() => rng() - 0.5);
  const wishes = wishCandidates.slice(0, p.wishes).map(c => ({
    id: uid(rng), name: c.name, lat: c.lat, lng: c.lng, gurl: null, addedAt: new Date().toISOString(),
  }));

  return { app: 'drippin', v: 1, persona: personaKey, exportedAt: new Date().toISOString(), cafes, visits, wishes };
}
