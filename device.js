// 기기 성격 · 안전 모드 · 사진 디코딩 — 휴대폰처럼 메모리가 빠듯한 기기에서 탭이 강제로 새로 열리는 일을 줄인다
//
//   LOW_MEM      iPhone · iPad · Android, 메모리 4GB 이하, 터치 작은 화면, 또는 안전 모드. ?lowmem=1 / ?lowmem=0 으로 강제
//   SAFE_LEVEL   0 보통 · 1 CPU(WASM) + 메모리 절약 · 2 거기에 사진을 더 작게. 분석(또는 사진 고르기) 중에 화면이 새로 열리면 한 단계씩 올라간다
//   CRASHED      이번에 열릴 때 "지난 분석이 끝나기 전에 화면이 새로 열렸다"고 판단했으면 그 정보, 아니면 null
//   guardStart(kind, info) / guardEnd()   분석 · 모델 받기 · 사진 고르기 앞뒤에 표시해 둔다
//   decodeScaled(blob, max)               JPEG · PNG 크기를 머리에서 읽어, 긴 변이 max 를 넘으면 줄여서 디코딩한다 (아이폰 48MP 사진을 통째로 풀지 않게)
const GUARD = 'finde-run-guard', SAFE = 'finde-safe';
const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJson = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function guardStart(kind, info = {}) { writeJson(GUARD, { kind, t: Date.now(), ...info }); }
export function guardEnd() { writeJson(GUARD, null); }
export function clearSafeMode() { writeJson(SAFE, null); writeJson(GUARD, null); }

export const CRASHED = (() => {
  const g = readJson(GUARD); writeJson(GUARD, null);
  if (!g || !g.t || Date.now() - g.t > 10 * 60 * 1000) return null;
  const prev = readJson(SAFE) || { level: 0, count: 0 };
  const next = { level: Math.min(2, (prev.level || 0) + 1), count: (prev.count || 0) + 1, lastKind: g.kind, lastDevice: g.device || null, t: Date.now() };
  writeJson(SAFE, next);
  return next;
})();
export const SAFE_LEVEL = (() => { const q = new URLSearchParams(location.search).get('safe'); if (q != null) return Math.max(0, Math.min(2, +q || 0)); return (readJson(SAFE)?.level) || 0; })();

export const LOW_MEM = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lowmem');
    if (q === '1') return true; if (q === '0') return false;
    if (SAFE_LEVEL >= 1) return true;
    const ua = navigator.userAgent || '';
    const mobileUA = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS 는 Mac 처럼 보인다
    const smallMem = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4;
    const touchSmall = matchMedia('(pointer: coarse)').matches && !matchMedia('(min-width: 1024px)').matches;
    return !!(mobileUA || smallMem || touchSmall);
  } catch { return false; }
})();
// iOS (Safari · 앱 속 브라우저 모두) — 메모리 한도가 가장 빡빡한 환경
export const IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// JPEG(SOF) · PNG(IHDR) 머리에서 가로 · 세로를 읽는다 (못 읽으면 null)
export async function imageDims(blob) {
  try {
    const buf = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (buf.byteLength > 24 && buf.getUint32(0) === 0x89504e47) return { w: buf.getUint32(16), h: buf.getUint32(20) };   // PNG
    if (buf.byteLength > 4 && buf.getUint16(0) === 0xffd8) {   // JPEG: 마커를 따라가며 SOFn 을 찾는다
      let p = 2;
      while (p + 9 < buf.byteLength) {
        if (buf.getUint8(p) !== 0xff) { p++; continue; }
        const m = buf.getUint8(p + 1);
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { p += 2; continue; }
        const len = buf.getUint16(p + 2);
        if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.getUint16(p + 5), w: buf.getUint16(p + 7) };
        p += 2 + len;
      }
    }
  } catch {}
  return null;
}
export async function decodeScaled(blob, max) {
  const d = await imageDims(blob);
  if (d && d.w > 0 && d.h > 0 && Math.max(d.w, d.h) > max) {
    const s = max / Math.max(d.w, d.h);
    try {
      const bmp = await createImageBitmap(blob, { resizeWidth: Math.round(d.w * s), resizeHeight: Math.round(d.h * s), resizeQuality: 'high' });
      if (bmp.width > 0 && bmp.height > 0) return bmp;
      bmp.close?.();
    } catch {}
  }
  return createImageBitmap(blob);
}

// MediaPipe 작업에 넘길 WebGL 캔버스 — OffscreenCanvas 의 WebGL 을 못 쓰는 브라우저(일부 WebKit · 구형)에서도 돌게 보통 캔버스를 쓴다
export const glCanvas = () => { try { return document.createElement('canvas'); } catch { return undefined; } };

// 캔버스 roundRect 가 없는 브라우저(Safari 15 이하 · Chrome 98 이하 · Firefox 111 이하)용 폴리필
(() => {
  try {
    const P = globalThis.CanvasRenderingContext2D?.prototype, O = globalThis.OffscreenCanvasRenderingContext2D?.prototype;
    const poly = function (x, y, w, h, r) {
      let [tl, tr, br, bl] = Array.isArray(r) ? (r.length === 1 ? [r[0], r[0], r[0], r[0]] : r.length === 2 ? [r[0], r[1], r[0], r[1]] : r.length === 3 ? [r[0], r[1], r[2], r[1]] : r) : [r, r, r, r];
      const m = Math.min(Math.abs(w) / 2, Math.abs(h) / 2); tl = Math.min(tl || 0, m); tr = Math.min(tr || 0, m); br = Math.min(br || 0, m); bl = Math.min(bl || 0, m);
      this.moveTo(x + tl, y); this.lineTo(x + w - tr, y); this.arcTo(x + w, y, x + w, y + tr, tr); this.lineTo(x + w, y + h - br); this.arcTo(x + w, y + h, x + w - br, y + h, br);
      this.lineTo(x + bl, y + h); this.arcTo(x, y + h, x, y + h - bl, bl); this.lineTo(x, y + tl); this.arcTo(x, y, x + tl, y, tl); this.closePath();
    };
    for (const proto of [P, O]) if (proto && typeof proto.roundRect !== 'function') proto.roundRect = poly;
  } catch {}
})();

// 네트워크가 흔들려도 몇 번 다시 시도하는 fetch (모델 · 사전 계산 파일용). 4xx 는 다시 시도하지 않는다
export async function fetchRetry(input, init, { tries = 3, base = 700 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(input, init);
      if (r.ok || (r.status >= 400 && r.status < 500)) return r;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, base * 2 ** i));
  }
  throw last;
}
