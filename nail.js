// 내 손톱형 분석 — 손등 사진 → 손가락별 손톱 윤곽 → 비율 측정 → 손톱형
import { LOW_MEM, decodeScaled } from './device.js';
//
//   const r = await analyzeNails(blob);   // { ok, issues, fingers: [{ key, ko, m, outline }], summary, hand }
//
// 1) 손 찾기: MediaPipe 손 랜드마크(21점). 손가락마다 끝마디(DIP → TIP) 방향으로 돌려 자른다 (손끝이 위, 128×128)
// 2) 손톱 찾기: 손가락 크롭마다 작은 분할 모델(MobileNetV3 + U-Net, models/nail/nail_seg.onnx)로 손톱 영역
// 3) 재기 (crop 좌표, 위가 손끝): 손톱 바탕(분홍 부분) 길이 · 너비, 끝쪽 ↔ 뿌리쪽 너비 비(퍼짐), 큐티클 라인 깊이, 하얀 끝(프리엣지) 길이
// 미용 목적의 모양 분석이다. 손톱 건강 · 질환은 판단하지 않는다. 사진은 브라우저 안에서만 쓴다.
import { assetFetch } from './assets.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const SEG_MODEL = './models/nail/nail_seg.onnx';

// 손가락 (랜드마크 번호). 엄지는 손등 사진에서 옆으로 보여 모양을 재지 않고 참고로만 쓴다
export const FINGERS = [
  { key: 'thumb', ko: '엄지', tip: 4, dip: 3, pip: 2, mcp: 1 },
  { key: 'index', ko: '검지', tip: 8, dip: 7, pip: 6, mcp: 5 },
  { key: 'middle', ko: '중지', tip: 12, dip: 11, pip: 10, mcp: 9 },
  { key: 'ring', ko: '약지', tip: 16, dip: 15, pip: 14, mcp: 13 },
  { key: 'pinky', ko: '소지', tip: 20, dip: 19, pip: 18, mcp: 17 },
];
// 크롭 정의 (학습 · 측정 도구 tools/nail-*.py 와 같아야 한다): 크기 = 끝마디 길이 L 의 2.4배, 중심 = TIP 에서 DIP 쪽으로 0.15L
export const CROP = { size: 128, side: 2.4, cen: 0.15 };

// ---- 크롭 좌표 ---------------------------------------------------------------------------
// 크롭 픽셀 (x, y) → 원본 픽셀. u = 손끝 방향, v = 오른쪽
export function cropFrame(tip, dip) {
  const ax = [tip[0] - dip[0], tip[1] - dip[1]], L = Math.hypot(ax[0], ax[1]) || 1;
  const u = [ax[0] / L, ax[1] / L], v = [-u[1], u[0]];
  const c = [tip[0] - u[0] * CROP.cen * L, tip[1] - u[1] * CROP.cen * L], half = (CROP.side * L) / 2;
  const toSrc = (x, y) => {
    const a = ((x / CROP.size) - 0.5) * 2 * half, b = ((y / CROP.size) - 0.5) * 2 * half;
    return [c[0] + v[0] * a - u[0] * b, c[1] + v[1] * a - u[1] * b];
  };
  return { L, u, v, c, half, toSrc, pxPerCrop: (2 * half) / CROP.size };
}

// ---- 측정 (순수 함수: 브라우저 · node 공통) -----------------------------------------------
// prob: 크롭 크기의 손톱 확률(0~1), rgb: 같은 크기의 RGBA (하얀 끝 찾기용, 없으면 프리엣지를 찾지 않음)
export function measureNail(prob, rgb, size = CROP.size) {
  const N = size * size, on = new Uint8Array(N);
  for (let i = 0; i < N; i++) on[i] = prob[i] > 0.5 ? 1 : 0;
  // 연결 성분 중 '이 손가락의 손톱' 자리(가운데, 손끝 아래)와 가장 많이 겹치는 것
  const lab = new Int32Array(N); let nlab = 0; const comps = [];
  for (let i = 0; i < N; i++) {
    if (!on[i] || lab[i]) continue;
    nlab++; let area = 0, hit = 0; const st = [i]; lab[i] = nlab;
    while (st.length) {
      const k = st.pop(), x = k % size, y = (k / size) | 0; area++;
      if (x >= size * 0.36 && x <= size * 0.64 && y >= size * 0.3 && y <= size * 0.78) hit++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
        const j = Y * size + X; if (on[j] && !lab[j]) { lab[j] = nlab; st.push(j); }
      }
    }
    comps.push({ id: nlab, area, hit });
  }
  const best = comps.filter((c) => c.hit > 0 && c.area >= size * size * 0.008).sort((a, b) => b.hit - a.hit)[0];
  if (!best) return null;
  const inC = (x, y) => lab[y * size + x] === best.id;
  // 행마다 왼쪽 · 오른쪽 끝
  const rows = [];
  for (let y = 0; y < size; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < size; x++) if (inC(x, y)) { if (l < 0) l = x; r = x; }
    if (l >= 0) rows.push({ y, l, r, w: r - l + 1 });
  }
  if (rows.length < 6) return null;
  const yTop = rows[0].y, yBot = rows[rows.length - 1].y, len = yBot - yTop + 1;
  // 하얀 끝(프리엣지): 위에서부터, 손톱 바탕보다 확실히 밝고 덜 붉은 줄
  let yFe = yTop;
  if (rgb) {
    const stat = (r0) => { let v = 0, s = 0, n = 0; for (let x = r0.l; x <= r0.r; x++) { const k = (r0.y * size + x) * 4, R = rgb[k], G = rgb[k + 1], B = rgb[k + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B); v += (R + G + B) / 3; s += mx ? (mx - mn) / mx : 0; n++; } return { v: v / n, s: s / n }; };
    const st = rows.map(stat);
    // 바탕 기준은 뿌리 쪽(아래 25%)에서 잡는다 — 하얀 끝이 긴 손톱(롱네일 · 연장)에서도 기준이 하얗게 되지 않게
    const bed = st.slice(Math.floor(rows.length * 0.7), Math.floor(rows.length * 0.95));
    const med = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a[a.length >> 1]; };
    const vb = med(bed.map((x) => x.v)), sb = med(bed.map((x) => x.s));
    let k = 0, miss = 0, last = -1;
    while (k < rows.length * 0.85) {
      const white = st[k].v > vb + 14 && st[k].s < sb * 0.8;
      if (white) { last = k; miss = 0; } else if (++miss > 1) break;
      k++;
    }
    if (last >= 0 && last + 1 >= len * 0.06) yFe = rows[last + 1]?.y ?? yTop;
  }
  const bedRows = rows.filter((r0) => r0.y >= yFe);
  const Lb = yBot - yFe + 1;
  const pct = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  const W = pct(bedRows.map((r0) => r0.w), 0.9);
  const band = (a, b) => { const ws = bedRows.filter((r0) => r0.y >= yFe + a * Lb && r0.y <= yFe + b * Lb).map((r0) => r0.w); return ws.length ? pct(ws, 0.5) : null; };
  const wTip = band(0.08, 0.3), wBase = band(0.55, 0.75);
  // 큐티클 라인: 가운데 열의 아래 끝이 양옆(너비 15~25% 안쪽)보다 얼마나 더 내려가는지 ÷ 너비
  const widest = bedRows.reduce((a, b) => (b.w > a.w ? b : a));
  const bottomAt = (x) => { for (let y = size - 1; y >= 0; y--) if (inC(x, y)) return y; return null; };
  const xs = (f0, f1) => { const out = []; for (let x = Math.round(widest.l + f0 * widest.w); x <= Math.round(widest.l + f1 * widest.w); x++) { const b = bottomAt(x); if (b != null) out.push(b); } return out; };
  const mid = xs(0.4, 0.6), side = [...xs(0.15, 0.25), ...xs(0.75, 0.85)];
  // 손톱이 너무 좁게 찍히면(10px 미만) 가운데 · 양옆 열이 겹쳐 의미가 없으므로 재지 않는다
  const cuticle = widest.w >= 10 && mid.length && side.length ? (pct(mid, 0.5) - pct(side, 0.5)) / W : null;
  let pSum = 0, pN = 0; for (let i = 0; i < N; i++) if (lab[i] === best.id) { pSum += prob[i]; pN++; }
  return {
    // 가로세로는 눈에 보이는 손톱 전체(하얀 끝 포함) 길이로 잰다 — 보조 판정 118개와의 일치율이 바탕 길이로 잴 때보다 높았다
    // (사진 단위 교차 검증 66.9 → 76.3%, 하얀 끝이 잡힌 손톱에서 차이). 바탕만의 비율은 bedRatio 로 남긴다
    W, Lb, len, ratio: W / len, bedRatio: W / Lb,      // 손톱 너비 ÷ 길이 (클수록 가로로 넓은 손톱)
    taper: wTip && wBase ? wTip / wBase : null,         // 끝쪽 너비 ÷ 뿌리쪽 너비 (1보다 크면 끝이 퍼짐)
    cuticle,                                            // 큐티클 라인 깊이 ÷ 너비 (클수록 둥근 U자)
    free: (yFe - yTop) / Lb,                            // 하얀 끝 길이 ÷ 바탕 길이
    size: W / (CROP.size / CROP.side),                  // 손톱 너비 ÷ 끝마디 길이
    conf: pN ? pSum / pN : 0, area: best.area,
    box: { yTop, yFe, yBot, l: widest.l, r: widest.r },
    contour: rows.map((r0) => [r0.l, r0.y, r0.r]),
  };
}

// 손 랜드마크(픽셀) → 손가락 길이 · 손바닥 너비
export function handMetrics(P) {
  const d = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
  const palmW = d(5, 17);
  const fl = (f) => d(f.mcp, f.pip) + d(f.pip, f.dip) + d(f.dip, f.tip);
  const [, index, middle, ring, pinky] = FINGERS;
  return { palmW, finger: (fl(index) + fl(middle) + fl(ring)) / 3 / palmW, middle: fl(middle) / palmW, pinky: fl(pinky) / palmW };
}

// ---- 손톱형 판단 -----------------------------------------------------------------------
// 기준(중앙값 · 표준편차): 자유 라이선스 손 사진에서 윤곽 검수(2회)를 통과한 맨손톱 851개(검지~소지) · 손 286개로 잰 값.
// 사진 각도에 따라 손톱이 짧아 보이는 등 흔들림이 섞여 있어 폭이 넓다. 검지 · 중지 · 약지의 중앙값으로 판단한다
export const NAIL_NORM = { ratio: [0.80, 0.2], taper: [0.931, 0.129], cuticle: [0.057, 0.074], finger: [1.44, 0.3], free: [0, 0.12] };
const zN = (k, x) => (x - NAIL_NORM[k][0]) / NAIL_NORM[k][1];
export function nailType(fingers, hand) {
  const use = fingers.filter((f) => f.m && ['index', 'middle', 'ring'].includes(f.key));
  if (use.length < 2) return null;
  const med = (k) => { const a = use.map((f) => f.m[k]).filter((x) => x != null).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : null; };
  const m = { ratio: med('ratio'), taper: med('taper'), cuticle: med('cuticle'), free: med('free'), size: med('size') };
  const z = { ratio: zN('ratio', m.ratio), taper: m.taper != null ? zN('taper', m.taper) : 0, cuticle: m.cuticle != null ? zN('cuticle', m.cuticle) : 0, finger: hand ? zN('finger', hand.finger) : 0 };
  // 경계값: 두 검수자가 같은 판정을 한 맨손톱(가로세로 118개 · 옆선 149개 · 큐티클 136개)과 가장 잘 맞도록 정했다.
  // 가로세로는 판정 일치 70%(검수자끼리 79%). 옆선 · 큐티클은 검수자 판정이 거의 모두 '곧음' · '둥긂'이라, 아주 뚜렷할 때만 다르게 말한다
  const width = m.ratio > 1.03 ? 'wide' : m.ratio < 0.63 ? 'long' : 'mid';                                  // 가로형 · 세로형 · 보통
  const spread = m.taper == null ? 'straight' : m.taper > 1.15 ? 'fan' : m.taper < 0.76 ? 'narrow' : 'straight'; // 끝이 퍼짐 · 끝이 좁아짐 · 일자
  const base = m.cuticle == null ? 'round' : m.cuticle < -0.04 ? 'flat' : m.cuticle > 0.14 ? 'u' : 'round';  // 큐티클 라인: 일자 · 라운드 · U자
  const fingerT = z.finger <= -0.8 ? 'short' : z.finger >= 0.8 ? 'long' : 'mid';                           // 손가락: 짧은 편 · 긴 편 · 보통
  const length = m.free == null ? null : m.free < 0.08 ? 'short' : m.free < 0.35 ? 'mid' : 'long';             // 지금 길이
  return { m, z, width, spread, base, finger: fingerT, length, n: use.length };
}
export const TYPE_KO = {
  width: { wide: '가로로 넓은 손톱', long: '세로로 긴 손톱', mid: '가로세로 균형 잡힌 손톱' },
  spread: { fan: '끝으로 갈수록 퍼지는 부채꼴', narrow: '끝으로 갈수록 좁아지는 모양', straight: '옆선이 곧은 일자' },
  base: { flat: '큐티클 라인이 평평한 스퀘어형', round: '큐티클 라인이 둥근 라운드형', u: '큐티클 라인이 깊게 둥근 U-라운드형' },
  finger: { short: '손가락이 짧은 편', long: '손가락이 긴 편', mid: '손가락 길이 보통' },
  length: { short: '짧게 정리된 길이', mid: '하얀 끝이 조금 있는 길이', long: '하얀 끝이 긴 편' },
};

// ---- 브라우저: 사진 → 분석 ---------------------------------------------------------------
let tasksP = null;
function loadTasks() {
  tasksP ??= (async () => {
    const [mp, ort, segBytes] = await Promise.all([
      import(`${MP}/vision_bundle.mjs`),
      import(`${ORT}ort.wasm.min.mjs`),
      assetFetch(SEG_MODEL).then((r) => { if (!r.ok) throw new Error(`손톱 모델을 받지 못했어요 (${r.status})`); return r.arrayBuffer(); }),
    ]);
    const fileset = await mp.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const hb = await assetFetch('./models/mediapipe/hand_landmarker.task').then((r) => { if (!r.ok) throw new Error(`손 모델을 받지 못했어요 (${r.status})`); return r.arrayBuffer(); });
    const hand = await mp.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(hb), delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3,
    });
    ort.env.wasm.wasmPaths = ORT; ort.env.wasm.numThreads = 1;
    const seg = await ort.InferenceSession.create(new Uint8Array(segBytes), { executionProviders: ['wasm'] });
    ready = true;
    return { hand, seg, ort };
  })().catch((e) => { tasksP = null; throw e; });
  return tasksP;
}
export const preloadNails = () => loadTasks();
let ready = false;
export const modelsReady = () => ready;

export async function analyzeNails(blob) {
  const { hand, seg, ort } = await loadTasks();
  const bmp = await decodeScaled(blob, LOW_MEM ? 1280 : 1600);   // 큰 사진은 줄여서 디코딩
  const sc = Math.min(1, (LOW_MEM ? 1280 : 1600) / Math.max(bmp.width, bmp.height));   // 휴대폰은 조금 작게 (메모리)
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * sc); canvas.height = Math.round(bmp.height * sc);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close?.();
  const w = canvas.width, h = canvas.height;
  const res = hand.detect(canvas);
  if (!res.landmarks?.length) return { ok: false, canvas, issues: [{ key: 'nohand', level: 'block', title: '손을 찾지 못했어요', fix: '손등이 위로 오게 손 전체(손목까지)를 화면 가운데에 두고, 손가락을 살짝 벌려 찍어 주세요.' }] };
  // 가장 크게 나온 손
  const size = (lm) => { const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
  const k = res.landmarks.map((lm, i) => [size(lm), i]).sort((a, b) => b[0] - a[0])[0][1];
  const P = res.landmarks[k].map((p) => [p.x * w, p.y * h]);
  const side = res.handedness?.[k]?.[0]?.categoryName || null;
  const issues = [];
  if (res.landmarks.length > 1) issues.push({ key: 'many', level: 'warn', title: '손이 여러 개 보여요', fix: '가장 크게 나온 손을 쟀어요. 한 손만 나오게 찍으면 더 확실해요.' });
  // 손가락마다 크롭 → 한 번에 분할
  const S = CROP.size, crops = [], frames = [];
  const cc = document.createElement('canvas'); cc.width = S; cc.height = S;
  const g = cc.getContext('2d', { willReadFrequently: true });
  const input = new Float32Array(FINGERS.length * 3 * S * S);
  FINGERS.forEach((f, i) => {
    const fr = cropFrame(P[f.tip], P[f.dip]); frames.push(fr);
    // 크롭 → 원본: src = p0 + a·x + b·y. 캔버스에는 원본 → 크롭 변환을 걸고 원본을 그린다
    const p0 = fr.toSrc(0, 0), px = fr.toSrc(1, 0), py = fr.toSrc(0, 1);
    const a = [px[0] - p0[0], px[1] - p0[1]], b = [py[0] - p0[0], py[1] - p0[1]];
    const det = a[0] * b[1] - a[1] * b[0];
    const inv = [b[1] / det, -a[1] / det, -b[0] / det, a[0] / det];
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); // 학습 크롭(PIL)과 같이 바깥은 검정
    g.setTransform(inv[0], inv[1], inv[2], inv[3], -(inv[0] * p0[0] + inv[2] * p0[1]), -(inv[1] * p0[0] + inv[3] * p0[1]));
    g.drawImage(canvas, 0, 0);
    const px4 = g.getImageData(0, 0, S, S).data; crops.push(px4);
    for (let j = 0; j < S * S; j++) for (let c = 0; c < 3; c++) input[i * 3 * S * S + c * S * S + j] = px4[j * 4 + c] / 255;
  });
  const out = await seg.run({ image: new ort.Tensor('float32', input, [FINGERS.length, 3, S, S]) });
  const logit = out.logit.data;
  const fingers = FINGERS.map((f, i) => {
    const prob = new Float32Array(S * S);
    for (let j = 0; j < S * S; j++) prob[j] = 1 / (1 + Math.exp(-logit[i * S * S + j]));
    const m = measureNail(prob, crops[i]);
    const fr = frames[i];
    // 윤곽을 원본 좌표로 (그리기용)
    const outline = m ? [...m.contour.map(([l, y]) => fr.toSrc(l, y)), ...m.contour.slice().reverse().map(([, y, r]) => fr.toSrc(r + 1, y))] : null;
    const fe = m && m.box.yFe > m.box.yTop ? [fr.toSrc(m.box.l, m.box.yFe), fr.toSrc(m.box.r + 1, m.box.yFe)] : null;
    // 크롭 좌표 → 원본 좌표 변환 (가상 쉐입 그리기용): src = p0 + a·x + b·y
    const q0 = fr.toSrc(0, 0), qx = fr.toSrc(1, 0), qy = fr.toSrc(0, 1);
    return { ...f, m, outline, freeLine: fe, L: fr.L, frame: { p0: q0, a: [qx[0] - q0[0], qx[1] - q0[1]], b: [qy[0] - q0[0], qy[1] - q0[1]] } };
  });
  const hm = handMetrics(P);
  const found = fingers.filter((f) => f.m && f.key !== 'thumb');
  // 손가락 끝마디 길이(검지 · 중지 · 약지 중앙값, 픽셀)로 손 크기를 본다. 20 미만이면 손톱 윤곽을 잴 수 없고, 40 미만이면 결과가 흔들리기 쉽다
  const segL = frames.slice(1, 4).map((fr) => fr.L).sort((a, b) => a - b)[1];
  if (segL < 20) issues.push({ key: 'small', level: 'block', title: '손이 너무 작게 찍혔어요', fix: '손이 화면의 절반 이상을 차지하도록 가까이에서 찍어 주세요.' });
  else if (segL < 40) issues.push({ key: 'small', level: 'warn', title: '손이 조금 작게 찍혔어요', fix: '손을 화면 가득 가까이 찍으면 손톱 윤곽을 더 정확히 재요.' });
  if (found.length < 2) issues.push({ key: 'nonail', level: 'block', title: '손톱을 충분히 찾지 못했어요', fix: '손등이 위로 오게(손바닥이 아래로) 평평하게 두고, 위에서 내려다보며 손톱이 다 보이게 찍어 주세요.' });
  // 매니큐어 · 젤: 손톱이 피부보다 확실히 진하거나 색이 강하면 자연 손톱 모양이 가려져 있다
  const polish = found.length >= 2 && found.filter((f) => polished(crops[FINGERS.indexOf(FINGERS.find((x) => x.key === f.key))], f.m)).length >= Math.ceil(found.length / 2);
  if (polish) issues.push({ key: 'polish', level: 'warn', title: '매니큐어나 젤이 칠해져 있는 것 같아요', fix: '칠한 모양이 아니라 자연 손톱 모양을 재야 정확해요. 지운 맨손톱으로 찍으면 더 정확해요.' });
  const type = nailType(fingers, hm);
  if (!type && !issues.some((x) => x.level === 'block')) issues.push({ key: 'nonail', level: 'block', title: '검지 · 중지 · 약지 손톱이 충분히 보이지 않아요', fix: '손등이 위로 오게 손가락을 살짝 벌리고, 검지 · 중지 · 약지 손톱이 다 보이게 찍어 주세요.' });
  return { ok: !issues.some((x) => x.level === 'block') && !!type, canvas, w, h, P, side, fingers, hand: hm, type, issues, polish };
}
// 손톱 부분 평균 채도가 높거나(색 매니큐어) 하얀 · 검은 계열로 균일하면 칠한 손톱으로 본다
function polished(px, m) {
  if (!px || !m) return false;
  const S = CROP.size; let n = 0, sat = 0, v = 0;
  for (const [l, y, r] of m.contour) for (let x = l; x <= r; x++) { const k = (y * S + x) * 4, R = px[k], G = px[k + 1], B = px[k + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B); sat += mx ? (mx - mn) / mx : 0; v += mx; n++; }
  sat /= n; v /= n;
  return sat > 0.42 || v < 70;
}
