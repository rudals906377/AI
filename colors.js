// 실제 색 견본 — 사진에서 머리카락 · 입술 · 아이섀도 · 손톱 부분만 골라 실제 색을 뽑는다
//
//   const colors = await extractColors(blob, 'hair');   // { hair: { hex, name, level, palette } }
//
// 부위 찾기는 MediaPipe(브라우저 안에서 실행)를 쓴다. 사진은 밖으로 보내지 않는다.
//   헤어     : 머리카락 분할 모델 (hair_segmenter, 0.8MB)
//   메이크업 : 얼굴 랜드마크 (face_landmarker, 3.7MB) → 입술 · 눈두덩
//   네일     : 손 랜드마크 (hand_landmarker, 7.8MB) → 손끝 (손을 못 찾으면 색을 내지 않는다)
// 모델은 필요한 카테고리에서 처음 한 번만 내려받는다. 조명에 따라 색이 달라지므로 화면에는 '사진 속 색'으로 표시한다.

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const MODEL_DIR = './models/mediapipe';
const MAX_SIDE = 768;

let libPromise = null;
const taskPromises = {};
function lib() {
  libPromise ??= import(`${MP}/vision_bundle.mjs`).then(async (m) => ({ m, fileset: await m.FilesetResolver.forVisionTasks(`${MP}/wasm`) }));
  return libPromise;
}
async function modelBytes(file) {
  const r = await fetch(`${MODEL_DIR}/${file}`);
  if (!r.ok) throw new Error(`${file} 을(를) 받지 못했어요 (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
function task(kind) {
  taskPromises[kind] ??= (async () => {
    const { m, fileset } = await lib();
    if (kind === 'hair') {
      return m.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: await modelBytes('hair_segmenter.tflite'), delegate: 'CPU' },
        runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
      });
    }
    if (kind === 'face') {
      return m.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: await modelBytes('face_landmarker.task'), delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 1,
      });
    }
    return m.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: await modelBytes('hand_landmarker.task'), delegate: 'CPU' },
      runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3,
    });
  })().catch((e) => { delete taskPromises[kind]; throw e; });
  return taskPromises[kind];
}

// 어떤 카테고리가 색 견본을 지원하는지
export const COLOR_TARGETS = { hair: ['hair'], makeup: ['lip', 'eye'], nail: ['nail'] };

export async function extractColors(blob, category) {
  if (!COLOR_TARGETS[category]) return {};
  const img = await toCanvas(blob);
  if (category === 'hair') return { hair: await hairColor(img) };
  if (category === 'makeup') return await makeupColors(img);
  return { nail: await nailColor(img) };
}

// ---- 부위별 -------------------------------------------------------------------
async function hairColor(img) {
  const seg = await task('hair');
  const res = seg.segment(img.canvas);
  const mask = res.categoryMask;
  const m = mask.getAsUint8Array();
  const mw = mask.width, mh = mask.height;
  res.close?.();
  const px = [];
  const step = stepFor(img.w * img.h);
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      const v = m[Math.floor((y * mh) / img.h) * mw + Math.floor((x * mw) / img.w)];
      if (v > 0) px.push(labAt(img, x, y));
    }
  }
  if (px.length < 150) return null; // 머리카락이 거의 안 보임
  const kept = trimL(px, 0.08, 0.92);
  const pal = palette(kept, 3, HAIR_NAMES);
  if (!pal.length) return null;
  // 대표색은 머리카락 전체 평균 (가장 큰 묶음은 보통 그늘진 부분이라 실제보다 어둡다)
  const main = swatch(meanLab(kept), HAIR_NAMES);
  return { ...main, level: hairLevel(main.lab), palette: pal };
}

// 입술: 바깥 입술선 안쪽에서 안쪽 입술선(입 벌린 부분 · 치아)을 뺀 영역
const LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIP_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
// 눈두덩: 윗눈꺼풀선과 눈썹 아랫선 (사진 기준 왼쪽 눈, 오른쪽 눈)
const EYES = [
  { lid: [33, 246, 161, 160, 159, 158, 157, 173, 133], brow: [46, 53, 52, 65, 55] },
  { lid: [362, 398, 384, 385, 386, 387, 388, 466, 263], brow: [285, 295, 282, 283, 276] },
];
const CHEEKS = [50, 280, 101, 330]; // 볼 가운데 (피부색 기준)

async function makeupColors(img) {
  const face = await task('face');
  const res = face.detect(img.canvas);
  const lm = res.faceLandmarks?.[0];
  if (!lm) return {};
  const P = (i) => [lm[i].x * img.w, lm[i].y * img.h];
  const faceW = Math.hypot(...sub(P(234), P(454)));
  if (faceW < 60) return {}; // 얼굴이 너무 작으면 색을 믿기 어렵다

  // 피부 기준색: 볼 가운데 작은 원
  const skinPx = [];
  for (const i of CHEEKS) collectCircle(img, P(i), faceW * 0.04, skinPx);
  const skin = skinPx.length ? meanLab(trimL(skinPx, 0.15, 0.85)) : null;

  // 입술
  const lipPx = collectPolygon(img, [LIP_OUTER.map(P), LIP_INNER.map(P)]);
  const lipLab = lipPx.length > 40 ? meanLab(trimL(lipPx, 0.12, 0.85)) : null;
  const lip = lipLab ? swatch(lipLab, LIP_NAMES) : null;

  // 아이섀도: 윗눈꺼풀에서 눈썹 쪽으로 45% 올라간 띠. 피부와 다른 색의 픽셀만 모은다
  let eye = null;
  if (skin) {
    const eyePx = [];
    for (const e of EYES) {
      const lid = e.lid.map(P);
      const browY = e.brow.map(P).reduce((s, p) => s + p[1], 0) / e.brow.length;
      const lidY = lid.reduce((s, p) => s + p[1], 0) / lid.length;
      const up = (lidY - browY) * 0.45;
      if (up <= 2) continue;
      const band = [...lid, ...lid.slice().reverse().map(([x, y]) => [x, y - up])];
      eyePx.push(...collectPolygon(img, [band]));
    }
    const colored = eyePx.filter((p) => p[0] > 22 && de2000(p, skin) > 9);
    if (eyePx.length > 60 && colored.length / eyePx.length > 0.4) eye = swatch(meanLab(trimL(colored, 0.1, 0.9)), EYE_NAMES);
  }
  return { lip, eye, skin: skin ? swatch(skin, null) : null };
}

const FINGERS = [[3, 4], [7, 8], [11, 12], [15, 16], [19, 20]];
async function nailColor(img) {
  const hands = await task('hand');
  const res = hands.detect(img.canvas);
  const all = res.landmarks || [];
  const nailPx = [];
  let skinPx = [];
  for (const lm of all) {
    const P = (i) => [lm[i].x * img.w, lm[i].y * img.h];
    for (const [a, b] of FINGERS) {
      const d = P(a), t = P(b);
      const v = sub(t, d);
      const len = Math.hypot(...v);
      if (len < 6) continue;
      const u = [v[0] / len, v[1] / len], n = [-u[1], u[0]];
      const from = add(d, mul(v, 0.3)), to = add(t, mul(v, 0.25)), hw = len * 0.3;
      nailPx.push(...collectPolygon(img, [[add(from, mul(n, hw)), add(to, mul(n, hw)), add(to, mul(n, -hw)), add(from, mul(n, -hw))]]));
      // 손가락 중간 마디 (손톱 아래 피부)
      collectCircle(img, add(d, mul(v, -0.45)), len * 0.18, skinPx);
    }
  }
  if (nailPx.length > 80 && skinPx.length > 20) {
    const skin = meanLab(trimL(skinPx, 0.2, 0.8));
    const kept = nailPx.filter((p) => de2000(p, skin) > 9);
    if (kept.length / nailPx.length > 0.12) {
      const pal = palette(trimL(kept, 0.03, 0.97), 3, NAIL_NAMES);
      if (pal.length) return { ...pal[0], palette: pal, source: 'hand' };
    }
  }
  // 손을 못 찾으면 색을 내지 않는다 (사진 전체로 어림하면 배경 · 피부 색이 섞여 틀리기 쉽다)
  return null;
}

// ---- 색 이름표 (가장 가까운 색 이름. 이름은 '~ 계열'로만 쓴다) -----------------------
const HAIR_NAMES = named({
  흑발: '#1c1917', 블루블랙: '#1d2230', 다크브라운: '#33241d', 초코브라운: '#4b3427', 애쉬브라운: '#5f5249', 카키브라운: '#5e5640',
  밀크브라운: '#8a6c55', 골드브라운: '#87603b', 오렌지브라운: '#93552f', 핑크브라운: '#86584f', 레드와인: '#5a2330', 애쉬베이지: '#a29483',
  다크애쉬: '#5d5a57', 애쉬블론드: '#bdb3a0', 골드블론드: '#cfae78', 애쉬그레이: '#949492', 핑크: '#d395a5', 라벤더: '#ad9cc4', 블루: '#3e5888',
  퍼플: '#5a3e78', 민트: '#88c2b0', 그린: '#3e664c', 레드: '#9e2a2e',
});
const LIP_NAMES = named({
  레드: '#b3202d', 체리레드: '#8c1c2b', 코랄: '#de6f5a', 로즈핑크: '#c76779', 핑크: '#e08a9e', MLBB: '#ad6a62', 말린장미: '#9d5258',
  버건디: '#6a1f2e', 플럼: '#5c2a44', 오렌지: '#dd5f38', 브라운: '#87493a', 누드베이지: '#c08a77', 퍼플: '#6c396c', 블랙: '#2a1f22',
});
const EYE_NAMES = named({
  브라운: '#77584a', 베이지: '#c6a48b', 코랄: '#d48a72', 핑크: '#d4949e', 레드: '#a6433f', 버건디: '#6c2f37', 골드: '#bf9e5f',
  블루: '#4a6898', 퍼플: '#785989', 그린: '#698859', 블랙: '#2b2625', 오렌지: '#cd7a4a',
});
const NAIL_NAMES = named({
  '누드·베이지': '#d8b9a1', 밀키화이트: '#efe7df', 화이트: '#f6f6f4', 연핑크: '#f0c3cb', 핫핑크: '#de467c', '코랄·피치': '#ee8a73',
  레드: '#bd1a2b', 버건디: '#6a1b2b', 블랙: '#1f1d1e', 그레이: '#8c8c8c', 실버: '#bfc0c3', 골드: '#c6a14c', '네이비·블루': '#28406f',
  하늘색: '#9cc7e6', '민트·그린': '#8ed0b4', '올리브·카키': '#6f7946', '라벤더·퍼플': '#a78fc7', 버터옐로: '#f3e0a1', 오렌지: '#ed7a2c',
  네온: '#d2fb3d', '브라운·모카': '#7a5341',
});
function named(o) { return Object.entries(o).map(([name, hex]) => ({ name, hex })); }
function nearest(lab, names) {
  let best = null, bd = Infinity;
  for (const n of names) { n.lab ??= rgb2lab(hexRgb(n.hex)); const d = de2000(lab, n.lab); if (d < bd) { bd = d; best = n; } }
  return best ? best.name : null;
}
function swatch(lab, names) {
  return { hex: rgbHex(lab2rgb(lab)), lab: lab.map((v) => Math.round(v * 10) / 10), name: names ? nearest(lab, names) : null };
}
// 헤어 레벨(1 흑발 ~ 10 아주 밝은 금발): 머리카락 평균 밝기(L*)로 어림한다.
// 예시 사진 32장으로 맞춤: 흑발 L*≈11 → 1, 다크브라운 ≈19 → 3, 초코브라운 ≈28 → 4, 밀크브라운 ≈45 → 7, 탈색모 ≈60 → 10
// 채도가 높은 비비드 컬러는 레벨로 말하지 않는다
function hairLevel([L, a, b]) {
  if (Math.hypot(a, b) > 32) return null;
  return Math.max(1, Math.min(10, Math.round(1 + (L - 10) / 5.5)));
}
// ---- 색 묶기 -------------------------------------------------------------------
function palette(px, k, names) {
  if (px.length < 30) return [];
  const cl = mergeClose(kmeans(px, k)).filter((c) => c.share >= 0.12);
  return cl.map((c) => ({ ...swatch(c.lab, names), share: Math.round(c.share * 100) / 100 }));
}
function mergeClose(cl) {
  const out = [];
  for (const c of cl.slice().sort((a, b) => b.share - a.share)) {
    const near = out.find((o) => de2000(o.lab, c.lab) < 9);
    if (near) {
      const s = near.share + c.share;
      near.lab = near.lab.map((v, i) => (v * near.share + c.lab[i] * c.share) / s);
      near.share = s;
    } else out.push({ lab: c.lab.slice(), share: c.share });
  }
  return out.sort((a, b) => b.share - a.share);
}
function kmeans(px, k, iters = 12) {
  if (!px.length) return [];
  k = Math.min(k, px.length);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // k-means++ 초기값 (같은 사진은 항상 같은 결과)
  const C = [px[Math.floor(rnd() * px.length)].slice()];
  const d2 = new Float64Array(px.length);
  while (C.length < k) {
    let sum = 0;
    for (let i = 0; i < px.length; i++) { d2[i] = Math.min(...C.map((c) => dist2(px[i], c))); sum += d2[i]; }
    if (!sum) break;
    let r = rnd() * sum, j = 0;
    while (r > d2[j] && j < px.length - 1) r -= d2[j++];
    C.push(px[j].slice());
  }
  const asg = new Int32Array(px.length);
  for (let it = 0; it < iters; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < C.length; c++) { const d = dist2(px[i], C[c]); if (d < bd) { bd = d; bi = c; } }
      asg[i] = bi; const s = S[bi]; s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++;
    }
    for (let c = 0; c < C.length; c++) if (S[c][3]) C[c] = [S[c][0] / S[c][3], S[c][1] / S[c][3], S[c][2] / S[c][3]];
  }
  const cnt = C.map(() => 0);
  for (let i = 0; i < px.length; i++) cnt[asg[i]]++;
  return C.map((lab, c) => ({ lab, share: cnt[c] / px.length })).filter((c) => c.share > 0).sort((a, b) => b.share - a.share);
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
// 밝기 위아래 끝(반사광 · 그림자)을 뺀다
function trimL(px, lo, hi) {
  if (px.length < 20) return px;
  const Ls = px.map((p) => p[0]).sort((a, b) => a - b);
  const a = Ls[Math.floor(Ls.length * lo)], b = Ls[Math.min(Ls.length - 1, Math.floor(Ls.length * hi))];
  return px.filter((p) => p[0] >= a && p[0] <= b);
}
function meanLab(px) {
  const s = [0, 0, 0];
  for (const p of px) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
  return s.map((v) => v / Math.max(1, px.length));
}

// ---- 픽셀 모으기 ---------------------------------------------------------------
async function toCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { canvas, w, h, data: ctx.getImageData(0, 0, w, h).data };
}
const stepFor = (n, target = 6000) => Math.max(1, Math.floor(Math.sqrt(n / target)));
function labAt(img, x, y) {
  const i = (Math.floor(y) * img.w + Math.floor(x)) * 4;
  return rgb2lab([img.data[i], img.data[i + 1], img.data[i + 2]]);
}
function collectCircle(img, [cx, cy], r, out) {
  r = Math.max(2, r);
  for (let y = Math.max(0, cy - r); y < Math.min(img.h, cy + r); y++)
    for (let x = Math.max(0, cx - r); x < Math.min(img.w, cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out.push(labAt(img, x, y));
  return out;
}
// 여러 다각형 (짝수-홀수 규칙: 두 번째 다각형은 구멍)
function collectPolygon(img, polys) {
  const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(img.w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(img.h - 1, Math.ceil(Math.max(...ys)));
  const out = [];
  const step = stepFor((x1 - x0 + 1) * (y1 - y0 + 1), 4000);
  for (let y = y0; y <= y1; y += step)
    for (let x = x0; x <= x1; x += step) {
      let inside = false;
      for (const poly of polys) if (inPoly(poly, x + 0.5, y + 0.5)) inside = !inside;
      if (inside) out.push(labAt(img, x, y));
    }
  return out;
}
function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];

// ---- 색 공간 (sRGB ↔ CIE Lab, D65) · 색 차이 CIEDE2000 -------------------------------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
const LAB_CACHE = new Map();
export function rgb2lab([r, g, b]) {
  const key = (r << 16) | (g << 8) | b;
  const hit = LAB_CACHE.get(key);
  if (hit) return hit;
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  const lab = [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  if (LAB_CACHE.size < 200000) LAB_CACHE.set(key, lab);
  return lab;
}
export function lab2rgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  return [gam(3.2406 * X - 1.5372 * Y - 0.4986 * Z), gam(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), gam(0.0557 * X - 0.204 * Y + 1.057 * Z)];
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export function de2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (!a && !b) return 0; const t = Math.atan2(b, a) / rad; return t < 0 ? t + 360 : t; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lmp = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hmp += h1p + h2p < 360 ? 360 : -360; hmp /= 2; }
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hmp - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
