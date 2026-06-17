/* Drippin Service Worker — offline shell + CDN cache */
const CACHE = 'drippin-v8';
const CORE = ['./', './index.html', './manifest.json', './icon.svg', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // 動的API（Places / Firestore / Auth / Storage）は絶対にキャッシュしない
  if (/places\.googleapis|firestore\.googleapis|identitytoolkit|securetoken|firebasestorage/.test(url)) return;
  // 地図タイルはキャッシュ爆発するので素通し
  if (/cartocdn\.com/.test(url)) return;

  // ナビゲーション（HTML）はネットワーク優先 → オフライン時はキャッシュ
  if (e.request.mode === 'navigate') {
    e.respondWith(
      // HTMLは常に最新をネットワークから（HTTPキャッシュも無視）。オフライン時のみキャッシュ
      fetch(e.request, { cache: 'no-store' }).then(r => {
        const cl = r.clone();
        caches.open(CACHE).then(c => c.put('./index.html', cl));
        return r;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静的アセット・CDNライブラリ・フォントはキャッシュ優先
  const own = new URL(url).origin === location.origin;
  if (own || /unpkg\.com|gstatic\.com|fonts\.googleapis\.com/.test(url)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        if (r.ok && (r.type === 'basic' || r.type === 'cors')) {
          const cl = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, cl));
        }
        return r;
      }))
    );
  }
});
