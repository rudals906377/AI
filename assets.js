// 큰 정적 파일(학습 헤드 · 라벨 임베딩 · MediaPipe 모델)을 브라우저 Cache Storage 에 버전별로 저장해 두고 다시 쓴다.
// Hugging Face 정적 호스팅은 'cache-control: no-store' 로 응답해 방문할 때마다 약 40MB 를 다시 받기 때문.
// 버전은 배포 때 tools/deploy-space.py 가 만드는 asset-manifest.json (파일 경로 → 내용 해시). 목록이 없으면(로컬 실행) 그냥 받는다.
//
//   const r = await assetFetch('./heads/marqo-fashionSigLIP.json');   // fetch 와 같은 Response
const CACHE = 'beauty-assets-v1';
let manifest = null;
const getManifest = () => (manifest ??= fetch('./asset-manifest.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

export async function assetFetch(path) {
  const key = path.replace(/^\.\//, '');
  const ver = (await getManifest())[key];
  if (!ver || typeof caches === 'undefined') return fetch(path);
  const url = new URL(`./${key}?v=${ver}`, location.href).href;
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
    const r = await fetch(path);
    if (r.ok) {
      await cache.put(url, r.clone());
      // 같은 파일의 예전 버전은 지운다
      for (const req of await cache.keys()) {
        const u = new URL(req.url);
        if (u.pathname === new URL(url).pathname && req.url !== url) cache.delete(req);
      }
    }
    return r;
  } catch (e) {
    console.warn('[assets] 캐시를 쓰지 못해 그냥 받아요', e);
    return fetch(path);
  }
}
