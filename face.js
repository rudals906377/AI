// 내 얼굴 분석 — 셀카에서 얼굴 비율을 재고 얼굴형을 판단한다
//
//   const f = await analyzeFace(blob, { purpose: 'hair' });   // { ok, issues, shape, m, geo, ... }
//
// MediaPipe(브라우저 안에서 실행) 두 가지를 쓴다. 사진은 밖으로 보내지 않는다.
//   얼굴 랜드마크 478점 (face_landmarker) : 눈 · 코 · 입 · 눈썹 위치와 고개 각도
//   부위 분할 (selfie_multiclass)         : 얼굴 피부 · 머리카락 · 목 · 손 · 안경을 픽셀 단위로 나눔
//                                          → 실제 턱선 · 헤어라인, 머리카락 · 손이 얼굴을 가리는지
// 순서
//   1) 점검: 얼굴 개수 · 크기 · 화면 밖 · 고개 각도 · 입 벌림 · 웃음 · 밝기 · 머리카락/손/안경 가림
//   2) 측정: 얼굴을 정면 기준 좌표(가로 = 양쪽 광대 방향, 세로 = 턱끝 → 이마)로 옮긴 뒤
//            너비(이마 · 광대 · 턱 · 턱끝) · 길이 · 삼정 · 턱 각도 · 눈 · 코 · 입술
//   3) 얼굴형: 측정값을 6가지 얼굴형의 기준값과 비교해 가까운 정도(%)로 낸다
// 측정 부분(measureFace)은 DOM 없이 돌아가서 Node 에서 시험할 수 있다.

import { assetFetch } from './assets.js';
import { rgb2lab, lab2rgb } from './colors.js';

// ---- 랜드마크 번호 (MediaPipe Face Mesh) ------------------------------------------
// 얼굴 윤곽 (이마 위 10 에서 시작해 사진 기준 오른쪽으로 한 바퀴)
export const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const BROW_A = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];       // 사진 기준 왼쪽 눈썹 (위 바깥→안, 아래 안→바깥)
export const BROW_B = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const BROW_TOP = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300];
export const EYE_A = { out: 33, in: 133, top: 159, bot: 145, iris: 468, ring: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7] };
export const EYE_B = { out: 263, in: 362, top: 386, bot: 374, iris: 473, ring: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249] };
export const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const ALA = [[48, 278], [64, 294], [98, 327], [129, 358], [49, 279], [102, 331]]; // 콧볼 바깥쪽 후보 (가장 넓은 쌍)
// 머리카락 가림을 볼 얼굴선 구간 (사진 기준 왼쪽 a · 오른쪽 b)
const SIDE_ZONES = [
  { key: 'temple', label: '관자놀이', a: [21, 162], b: [251, 389] },
  { key: 'cheek', label: '볼 옆선', a: [127, 234, 93], b: [356, 454, 323] },
  { key: 'jaw', label: '턱선', a: [132, 58, 172, 136, 150], b: [361, 288, 397, 365, 379] },
];
export const SEG = { bg: 0, hair: 1, body: 2, face: 3, clothes: 4, other: 5 };

// ---- 작은 벡터 도구 -------------------------------------------------------------
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; } };
const deg = (r) => (r * 180) / Math.PI;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const angleAt = (g, a, b) => { const p = [a[0] - g[0], a[1] - g[1]], q = [b[0] - g[0], b[1] - g[1]]; return deg(Math.acos(Math.max(-1, Math.min(1, (p[0] * q[0] + p[1] * q[1]) / (Math.hypot(...p) * Math.hypot(...q)))))); };

// ---- 측정 · 점검 ------------------------------------------------------------------
// lm: [[x, y, z] 정규화 좌표 478개] · w/h: 사진 크기 · seg: 부위 분할 (sw × sh, SEG 번호)
// blend: 표정 점수 (jawOpen 등) · mat: 고개 각도 변환 행렬(4×4, 열 우선) · skinL: 얼굴 피부 평균 밝기(L*)
export function measureFace({ lm, w, h, seg = null, sw = 0, sh = 0, earSeg = null, blend = {}, mat = null, skinL = null, purpose = 'hair', others = [] }) {
  const P3 = lm.map(([x, y, z]) => [x * w, y * h, z * w]); // z 는 x 와 같은 척도
  const img = (i) => [P3[i][0], P3[i][1]];
  // 얼굴 좌표계: X = 왼쪽 광대 → 오른쪽 광대, Y = 턱끝 → 이마 위 (X 에 수직), Z = X × Y
  const X = v3.norm(v3.sub(P3[454], P3[234]));
  const up = v3.sub(P3[10], P3[152]);
  const Y = v3.norm(v3.sub(up, v3.scale(X, v3.dot(up, X))));
  const Z = v3.cross(X, Y);
  const O = v3.scale(v3.add(P3[234], P3[454]), 0.5);
  const U = (i) => { const d = v3.sub(P3[i], O); return [v3.dot(d, X), v3.dot(d, Y)]; }; // [가로, 세로(위가 +)]
  const toImg = (u, v, z = 0) => { const p = v3.add(v3.add(O, v3.scale(X, u)), v3.add(v3.scale(Y, v), v3.scale(Z, z))); return [p[0], p[1]]; };
  const pose = poseFrom(mat) || { yaw: deg(Math.atan2(X[2], X[0])), pitch: deg(Math.atan2(Y[2], -Y[1])) + 12, roll: deg(Math.atan2(X[1], X[0])) };

  const oval = OVAL.map(U);
  const V = (i) => U(i)[1];
  const vTop = V(10), vSub = V(2), vStom = (V(13) + V(14)) / 2, vMouth = (V(61) + V(291)) / 2;
  const vEye = mean([33, 133, 362, 263].map(V)), vNose = V(1);
  const vBrow = mean([...BROW_A, ...BROW_B].map(V));
  const vBrowTop = mean(BROW_TOP.map(V));
  const zTop = v3.dot(v3.sub(P3[10], O), Z);

  // 가로 단면: 높이 v 에서 메시 윤곽선과 만나는 왼쪽 · 오른쪽 점
  function slice(v) {
    const xs = [];
    for (let i = 0; i < oval.length; i++) {
      const [ua, va] = oval[i], [ub, vb] = oval[(i + 1) % oval.length];
      if ((va - v) * (vb - v) <= 0 && va !== vb) xs.push(ua + ((v - va) / (vb - va)) * (ub - ua));
    }
    if (xs.length < 2) return null;
    const l = Math.min(...xs), r = Math.max(...xs);
    return { v, l, r, w: r - l };
  }
  // 광대: 눈높이 위쪽 ~ 코끝 사이에서 메시 윤곽이 가장 넓은 곳 (귀가 얼굴 피부로 잡히는 높이라 메시를 쓴다)
  let cheek = null;
  for (let k = 0; k <= 24; k++) {
    const s = slice(vEye + (vEye - vNose) * 0.25 - ((vEye - vNose) * 1.25 * k) / 24);
    if (s && (!cheek || s.w > cheek.w)) cheek = s;
  }
  const CW = cheek.w;

  // 부위 분할 마스크 읽기
  const segAt = seg ? (x, y) => {
    const ix = Math.floor((x / w) * sw), iy = Math.floor((y / h) * sh);
    return ix < 0 || iy < 0 || ix >= sw || iy >= sh ? -1 : seg[iy * sw + ix];
  } : null;
  const segUV = (u, v, z = 0) => segAt(...toImg(u, v, z));

  // 얼굴 피부의 실제 가장자리: 메시 윤곽 근처에서 바깥으로 걸어가며 얼굴 피부가 끝나는 곳
  // (메시는 평균 얼굴 쪽으로 끌리는 경향이 있어, 턱선 · 턱끝 · 이마는 마스크 가장자리를 쓴다)
  function edge(v, side, z = 0) {
    const s = slice(v);
    if (!s || !segAt) return null;
    const um = side < 0 ? s.l : s.r;
    const n = 90;
    let last = null, miss = 0, beyond = null;
    for (let k = 0; k <= n; k++) {
      const u = um + side * CW * (-0.2 + (0.4 * k) / n);
      const c = segUV(u, v, z);
      if (c === SEG.face) { last = u; miss = 0; } else if (last != null && ++miss >= 3) { beyond = c; break; }
    }
    if (last == null) return { u: um, mesh: um, dev: 0, ok: false };
    return { u: last, mesh: um, dev: (side * (last - um)) / CW, beyond, ok: true };
  }
  // 마스크 가장자리가 메시에서 허용 범위(lo ~ hi, 광대 너비 기준) 안이면 마스크를 쓴다. 범위 끝 0.02 안쪽부터는 메시 쪽으로 섞어서,
  // 사진을 조금만 바꿔도(다시 저장 · 미세한 각도) 마스크 ↔ 메시가 갑자기 바뀌며 값이 튀는 일을 막는다
  const pick = (e, um, lo, hi) => {
    if (!e || !e.ok) return { u: um, src: 'mesh' };
    const t = Math.max(0, Math.min(1, Math.min(e.dev - lo, hi - e.dev) / 0.02));
    return t > 0 ? { u: um + (e.u - um) * t, src: 'mask' } : { u: um, src: 'mesh' };
  };

  // 턱끝: 입 가운데에서 아래로 내려가며 얼굴 피부가 끝나는 곳 (목 · 옷과의 경계)
  let vMenton = V(152), mentonSrc = 'mesh';
  if (segAt) {
    let last = null, miss = 0;
    for (let k = 0; k <= 80; k++) {
      const v = vStom - ((vStom - vMenton + CW * 0.25) * k) / 80;
      let f = 0; for (let j = -1; j <= 1; j++) f += segUV(j * CW * 0.03, v) === SEG.face;
      if (f >= 2) { last = v; miss = 0; } else if (last != null && ++miss >= 3) break;
    }
    if (last != null && Math.abs(last - vMenton) < CW * 0.08) { vMenton = last; mentonSrc = 'mask'; }
  }

  // 턱선: 광대 높이에서 턱끝까지 좌우 가장자리 (마스크 우선, 머리카락 · 귀 · 목 때문에 크게 벗어나면 메시)
  const K = 30;
  const jawL = [], jawR = [];
  let maskPts = 0;
  for (let k = 0; k <= K; k++) {
    const v = cheek.v + ((vMenton - cheek.v) * k) / K;
    const s = slice(v);
    if (!s) continue;
    for (const side of [-1, 1]) {
      const um = side < 0 ? s.l : s.r;
      const p = k === 0 ? { u: side < 0 ? cheek.l : cheek.r, src: 'mesh' } : k === K ? { u: 0, src: mentonSrc } : pick(edge(v, side), um, -0.08, 0.05);
      if (p.src === 'mask' && k > 0 && k < K) maskPts++;
      (side < 0 ? jawL : jawR).push([p.u, v]);
    }
  }
  const at = (pts, v) => { // 턱선 점들 사이를 이어 높이 v 의 가로 위치
    for (let i = 0; i < pts.length - 1; i++) {
      const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
      if ((va - v) * (vb - v) <= 0 && va !== vb) return ua + ((v - va) / (vb - va)) * (ub - ua);
    }
    return null;
  };
  const vChin = vMenton + (vStom - vMenton) * 0.3;
  // 턱선 점이 모자라면(가장자리를 못 찾은 높이) 메시 단면으로 대신한다
  const atOr = (pts, v, side) => at(pts, v) ?? (side < 0 ? slice(v)?.l : slice(v)?.r) ?? 0;
  const jawW = atOr(jawR, vMouth, 1) - atOr(jawL, vMouth, -1);
  // 턱끝 너비 · 각도는 턱끝 위 25 · 30 · 35% 세 높이에서 재서 평균 (한 높이만 쓰면 턱끝 위치가 2~3px 만 달라져도 값이 크게 흔들린다)
  const CHIN_AT = [0.25, 0.3, 0.35].map((t) => vMenton + (vStom - vMenton) * t);
  const chinW = mean(CHIN_AT.map((v) => atOr(jawR, v, 1) - atOr(jawL, v, -1)));
  // 턱 각도: 광대 점 → 턱끝을 잇는 직선에서 가장 바깥으로 나온 턱선 점 = 턱 모서리. 그 점에서의 사이각
  const M = [0, vMenton];
  function gonial(pts) {
    const C = pts[0];
    let best = null, bd = -1;
    for (const p of pts) {
      if (p[1] > cheek.v - CW * 0.08 || p[1] < vMenton + CW * 0.05) continue;
      const d = Math.abs((M[0] - C[0]) * (C[1] - p[1]) - (C[0] - p[0]) * (M[1] - C[1])) / Math.hypot(M[0] - C[0], M[1] - C[1]);
      if (d > bd) { bd = d; best = p; }
    }
    return { at: best, angle: angleAt(best, C, M), bulge: bd / CW };
  }
  const gA = gonial(jawL), gB = gonial(jawR);
  const chinAngle = mean(CHIN_AT.map((v) => angleAt(M, [atOr(jawL, v, -1), v], [atOr(jawR, v, 1), v])));

  // 이마 너비 (눈썹 위 ~ 이마 위 사이 40% 높이). 관자놀이 머리카락에 가리면 메시
  const vFore = vBrowTop + (vTop - vBrowTop) * 0.4;
  const fs = slice(vFore);
  // 관자놀이를 머리카락이 가리면 마스크 가장자리는 실제 이마보다 좁게 나오므로, 가린 비율만큼 메시 쪽으로 섞는다 (0.2 이하 → 마스크, 0.6 이상 → 메시)
  const templeHair = (ids) => {
    if (!segAt) return 0;
    let n = 0, hair = 0;
    for (const i of ids) { const [u, v] = U(i); const sg = Math.sign(u) || 1; for (const d of [0.03, 0.06, 0.09]) { n++; hair += segUV(u - sg * d * CW, v, 0) === SEG.hair; } }
    return hair / n;
  };
  const foreEdge = (side) => {
    const um = side < 0 ? fs.l : fs.r;
    const p = pick(edge(vFore, side, zTop * 0.5), um, -0.08, 0.04);
    if (p.src !== 'mask') return p;
    const zone = SIDE_ZONES[0], ids = Math.sign(U(zone.a[0])[0]) === side ? zone.a : zone.b;
    const t = Math.max(0, Math.min(1, (0.6 - templeHair(ids)) / 0.4));
    return { u: um + (p.u - um) * t, src: t > 0 ? 'mask' : 'mesh' };
  };
  const fl = foreEdge(-1), fr = foreEdge(1);
  const foreW = fr.u - fl.u;

  // 헤어라인: 이마 가운데를 따라 위로 올라가며 얼굴 피부가 끝나는 곳
  // 가르마 사이로 두피가 피부처럼 잡히는 경우를 막으려고, 이마 피부 폭이 절반 아래로 좁아지는 곳도 헤어라인으로 본다
  let hairline = null;
  if (segAt) {
    const start = vBrowTop + (vTop - vBrowTop) * 0.3, end = vTop + CW * 0.75, n = 90;
    let lastFace = null, miss = 0, beyondHair = 0;
    for (let k = 0; k <= n; k++) {
      const v = start + ((end - start) * k) / n;
      let face = 0, hairN = 0, wide = 0;
      for (let j = -2; j <= 2; j++) { const c = segUV((j / 2) * CW * 0.08, v, zTop); face += c === SEG.face; hairN += c === SEG.hair; }
      for (let j = -4; j <= 4; j++) wide += segUV((j / 4) * CW * 0.16, v, zTop) === SEG.face;
      const isFace = face >= 3 && (wide >= 5 || lastFace == null);
      if (isFace) { lastFace = v; miss = 0; beyondHair = 0; } else if (lastFace != null) { beyondHair += hairN; if (++miss >= 3) break; }
      else if (k > 3) break; // 처음부터 얼굴 피부가 아님 (앞머리 · 모자)
    }
    if (lastFace != null && miss >= 3) hairline = { v: lastFace, hair: beyondHair >= 6 };
  }
  // 헤어라인을 못 찾으면(앞머리 · 모자) 평균 비율로 어림한다
  const vHair = hairline ? Math.max(hairline.v, vBrowTop + CW * 0.12) : vTop + (vTop - vBrow) * HAIRLINE_EXTRA;
  const L = vHair - vMenton;
  const thirds = [vHair - vBrow, vBrow - vSub, vSub - vMenton];
  const tSum = thirds[0] + thirds[1] + thirds[2];

  // 눈 · 눈썹 · 코 · 입술
  const eye = (e) => {
    const o = U(e.out), i = U(e.in), t = U(e.top), b = U(e.bot);
    const width = Math.hypot(o[0] - i[0], o[1] - i[1]);
    return { width, height: t[1] - b[1], tilt: deg(Math.atan2(o[1] - i[1], Math.abs(o[0] - i[0]))) };
  };
  const eA = eye(EYE_A), eB = eye(EYE_B);
  const eyeW = (eA.width + eB.width) / 2;
  const icd = Math.abs(U(EYE_B.in)[0] - U(EYE_A.in)[0]);
  const ipd = Math.abs(U(EYE_B.iris)[0] - U(EYE_A.iris)[0]);
  const browGap = mean([[55, 159], [65, 159], [285, 386], [295, 386]].map(([a, b]) => V(a) - V(b)));
  // 눈썹 모양: 눈썹 앞머리(안쪽) → 가장 높은 곳 → 꼬리 높이 차이
  const brow = (ids) => {
    const top = ids.slice(0, 5).map(U); // 바깥 → 안쪽
    const head = top[4], tail = top[0], peak = top.reduce((a, b) => (b[1] > a[1] ? b : a));
    const len = Math.abs(head[0] - tail[0]);
    return { arch: (peak[1] - (head[1] + tail[1]) / 2) / len, tailDrop: (head[1] - tail[1]) / len };
  };
  const bA = brow(BROW_A), bB = brow(BROW_B);
  const alaW = Math.max(...ALA.map(([a, b]) => Math.abs(U(b)[0] - U(a)[0])));
  const mouthW = Math.abs(U(291)[0] - U(61)[0]);
  const upperLip = V(0) - V(13), lowerLip = V(14) - V(17);
  const cornerLift = ((V(61) + V(291)) / 2 - vStom) / mouthW; // + 면 입꼬리가 올라감

  const m = {
    ratio: L / CW,                         // 얼굴 길이(헤어라인 ~ 턱끝) / 광대 너비
    forehead: foreW / CW,                  // 이마 너비 / 광대 너비
    jaw: jawW / CW,                        // 턱 너비(입꼬리 높이) / 광대 너비
    chin: chinW / CW,                      // 턱끝 너비 / 광대 너비
    jawAngle: (gA.angle + gB.angle) / 2,   // 턱 모서리 각도 (작을수록 각짐)
    jawBulge: (gA.bulge + gB.bulge) / 2,   // 턱선이 바깥으로 나온 정도 (클수록 아래 얼굴이 넓고 둥긂)
    chinAngle,                             // 턱끝 각도 (작을수록 뾰족)
    thirds: thirds.map((t) => (t / tSum) * 3), // 상안부 : 중안부 : 하안부 (각 1 이 균형)
    philtrum: (vSub - vStom) / (vStom - vMenton), // 코 밑~입 : 입~턱끝 (0.5 가 균형)
    eyeSpacing: icd / eyeW,                // 미간 / 눈 가로
    eyeAspect: (eA.height / eA.width + eB.height / eB.width) / 2,
    eyeTilt: (eA.tilt + eB.tilt) / 2,      // + 면 눈꼬리가 올라감 (도)
    eyeToFace: eyeW / CW,
    browGap: browGap / eyeW,               // 눈썹 아래 ~ 눈 위 / 눈 가로
    browArch: (bA.arch + bB.arch) / 2,
    browTail: (bA.tailDrop + bB.tailDrop) / 2, // + 면 꼬리가 앞머리보다 낮음
    nose: alaW / icd,                      // 콧볼 너비 / 미간
    noseLen: (V(168) - vSub) / (vBrow - vSub),
    mouth: mouthW / alaW,                  // 입 너비 / 콧볼 너비
    mouthIpd: mouthW / ipd,                // 입 너비 / 눈동자 사이
    lips: lowerLip / Math.max(upperLip, 1e-6), // 아랫입술 / 윗입술 두께
    lipFull: (upperLip + lowerLip) / mouthW,   // 입술 두께 / 입 너비
    cornerLift,
    lipGap: (V(13) - V(14)) / mouthW,     // 입술 사이 벌어진 정도 (입 벌림 · 이 보임)
    asym: {
      brow: (mean(BROW_A.slice(0, 5).map(V)) - mean(BROW_B.slice(0, 5).map(V))) / eyeW,
      eye: (mean([33, 133, 159, 145].map(V)) - mean([263, 362, 386, 374].map(V))) / eyeW,
    },
  };

  // ---- 점검 (가림 · 자세 · 표정 · 크기 · 밝기) -----------------------------------
  const cover = {};
  if (segAt) {
    const count = (pts) => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const [u, v, z] of pts) c[segUV(u, v, z) + 1]++; return c; };
    const frac = (c, k) => c[k + 1] / Math.max(1, c.reduce((s, x) => s + x, 0));
    // 이마: 눈썹 위 ~ 이마 위 70% 높이 (머리카락이 시작되는 맨 위쪽은 뺀다)
    const fpts = [];
    for (let a = 0; a < 5; a++) for (let b = -3; b <= 3; b++) fpts.push([(b / 3) * CW * 0.27, vBrowTop + (vTop - vBrowTop) * (0.12 + 0.14 * a), zTop * 0.5]);
    const fc = count(fpts);
    cover.forehead = { hair: frac(fc, SEG.hair), other: frac(fc, SEG.other) };
    // 얼굴선 안쪽 띠
    for (const zz of SIDE_ZONES) {
      for (const [side, ids] of [['a', zz.a], ['b', zz.b]]) {
        const pts = [];
        for (const i of ids) { const [u, v] = U(i); const s = Math.sign(u) || 1; for (const d of [0.03, 0.06, 0.09]) pts.push([u - s * d * CW, v, 0]); }
        const c = count(pts);
        cover[`${zz.key}_${side}`] = { hair: frac(c, SEG.hair), body: frac(c, SEG.body), other: frac(c, SEG.other) };
      }
    }
    // 얼굴 안쪽: 손(몸 피부) · 안경 등(기타)
    const ipts = [];
    for (let a = 0; a <= 8; a++) {
      const v = vMenton + CW * 0.08 + ((vBrow - vMenton - CW * 0.08) * a) / 8;
      const s = slice(v); if (!s) continue;
      for (let b = -4; b <= 4; b++) ipts.push([(s.l + s.r) / 2 + (b / 4) * s.w * 0.36, v, 0]);
    }
    const ic = count(ipts);
    cover.inner = { body: frac(ic, SEG.body), other: frac(ic, SEG.other), hair: frac(ic, SEG.hair) };
    const epts = [];
    for (const e of [EYE_A, EYE_B]) {
      const o = U(e.out), i = U(e.in);
      for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) epts.push([i[0] + ((o[0] - i[0]) * (b - 0.5)) / 3, (o[1] + i[1]) / 2 - eyeW * 0.25 + (eyeW * 0.75 * a) / 4, 0]);
    }
    cover.eyes = { other: frac(count(epts), SEG.other) };
  }
  // 귀: 부위 분할에서 귀는 얼굴 피부로 잡힌다. 눈썹 ~ 코 밑 높이에서 메시 윤곽(귀 앞) 바깥으로 이어지는 피부 폭 = 귀가 보이는 폭,
  // 그 자리의 머리카락 비율 = 귀를 가린 정도. 고개를 돌리면 한쪽 귀가 더 보이므로 두 쪽을 따로 재고, 정면에 가까울 때만 돌출을 말한다
  // earSeg: 귀 둘레만 크게 잘라 다시 분할한 마스크(사진 픽셀 크기). 있으면 귀는 그것으로 잰다
  const earUV = earSeg ? (u, v) => { const [x, y] = toImg(u, v, 0); const ix = Math.floor((x / w) * sw), iy = Math.floor((y / h) * sh); return ix < 0 || iy < 0 || ix >= sw || iy >= sh ? -1 : earSeg[iy * sw + ix]; } : segUV;
  const ears = segAt ? [-1, 1].map((side) => {
    const rows = [];
    const N = 14, v0 = vBrow, v1 = vSub;
    for (let k = 0; k <= N; k++) {
      const v = v0 + ((v1 - v0) * k) / N;
      const s = slice(v); if (!s) continue;
      const um = side < 0 ? s.l : s.r;
      let out = 0, miss = 0, started = false, hair = 0, n = 0;
      for (let j = 0; j <= 60; j++) {
        const d = -0.02 + (0.42 * j) / 60, c = earUV(um + side * d * CW, v);
        if (d >= 0.02 && d <= 0.22) { n++; hair += c === SEG.hair; }
        const skin = c === SEG.face || c === SEG.body;
        if (skin) { if (d <= 0.06) started = true; if (started) { out = Math.max(out, d); miss = 0; } }
        else if (started && ++miss >= 2) break;
        if (!started && d > 0.06) break;
      }
      rows.push({ v, out: started ? out : 0, hair: n ? hair / n : 0 });
    }
    const vis = rows.filter((r) => r.out >= 0.05);
    const top = vis.length ? Math.max(...vis.map((r) => r.v)) : null, bot = vis.length ? Math.min(...vis.map((r) => r.v)) : null;
    const outs = vis.map((r) => r.out).sort((a, b) => a - b);
    return {
      side, shown: rows.length ? vis.length / rows.length : 0, hair: rows.length ? mean(rows.map((r) => r.hair)) : 0,
      out: outs.length ? outs[Math.floor(outs.length * 0.8)] : 0,          // 위쪽 귀바퀴가 가장 많이 튀어나온 폭 (광대 너비 대비)
      len: top != null ? (top - bot) / CW : 0, rows,
    };
  }) : null;
  // 머리 실루엣 (시술 전후 비교용): 얼굴 둘레의 머리카락이 어디까지 퍼지고 내려오는지 — 광대 너비 대비
  //   side: 광대 높이에서 얼굴선 밖으로 퍼진 머리 폭 · sideJaw: 입 높이 · top: 헤어라인 위 머리 높이 · below: 턱끝 아래로 내려온 기장 · fore: 이마를 덮은 비율
  if (segAt) {
    const outHair = (v, side) => {
      const s = slice(v); if (!s) return 0;
      const um = side < 0 ? s.l : s.r;
      let far = 0, miss = 0, seen = false;
      for (let j = 0; j <= 80; j++) {
        const d = (0.9 * j) / 80, c = segUV(um + side * d * CW, v);
        if (c === SEG.hair) { far = d; seen = true; miss = 0; } else if (seen && ++miss >= 4) break; else if (!seen && d > 0.35) break;
      }
      return far;
    };
    const both = (v) => (outHair(v, -1) + outHair(v, 1)) / 2;
    let top = 0;
    for (let j = 0, miss = 0, seen = false; j <= 80; j++) {
      const d = (0.9 * j) / 80, c = segUV(0, vHair + d * CW, zTop);
      if (c === SEG.hair) { top = d; seen = true; miss = 0; } else if (seen && ++miss >= 4) break;
    }
    let below = -0.6;
    for (let j = 0; j <= 100; j++) {
      const v = vMouth - ((vMouth - vMenton + CW * 1.6) * j) / 100;
      let hit = false;
      for (const u of [-0.75, -0.62, 0.62, 0.75]) if (segUV(u * CW, v) === SEG.hair) { hit = true; break; }
      if (hit) below = (vMenton - v) / CW;
    }
    // 이마 덮임: 헤어라인을 쓰면 앞머리가 생길 때 헤어라인도 함께 내려가 버리므로, 메시의 이마 위(vTop) ~ 눈썹 위 고정 구간에서 잰다
    let fh = 0, fn = 0;
    for (let a = 0; a <= 6; a++) for (let b = -4; b <= 4; b++) { fn++; fh += segUV((b / 4) * CW * 0.28, vBrowTop + CW * 0.04 + ((vTop - vBrowTop - CW * 0.04) * a) / 6, zTop * (a / 6)) === SEG.hair; }
    m.frame = { side: both(cheek.v), sideJaw: both(vMouth), top, below, fore: fh / fn };
  }
  m.ears = ears && { shown: Math.min(...ears.map((e) => e.shown)), hair: Math.max(...ears.map((e) => e.hair)), out: mean(ears.map((e) => e.out)), len: mean(ears.map((e) => e.len)), each: ears.map(({ shown, hair, out, len }) => ({ shown, hair, out, len })) };
  const issues = checkIssues({ m, pose, cover, blend, purpose, w, h, CW, oval: OVAL.map(img), skinL, hairline, others, maskPts, K });

  // 그리기용 좌표 (사진 픽셀)
  const P = (u, v) => toImg(u, v, 0);
  const geo = {
    oval: OVAL.map(img),
    jaw: [...jawL.map(([u, v]) => P(u, v)), ...jawR.slice().reverse().map(([u, v]) => P(u, v))],
    hairline: toImg(0, vHair, zTop), hairlineFound: !!hairline,
    thirds: [vHair, vBrow, vSub, vMenton].map((v, i) => { const half = CW * (i === 0 ? 0.32 : i === 3 ? 0.22 : 0.6); return [toImg(-half, v, i === 0 ? zTop : 0), toImg(half, v, i === 0 ? zTop : 0)]; }),
    widths: {
      forehead: [toImg(fl.u, vFore, zTop * 0.5), toImg(fr.u, vFore, zTop * 0.5)],
      cheek: [P(cheek.l, cheek.v), P(cheek.r, cheek.v)],
      jaw: [P(atOr(jawL, vMouth, -1), vMouth), P(atOr(jawR, vMouth, 1), vMouth)],
      chin: [P(atOr(jawL, vChin, -1), vChin), P(atOr(jawR, vChin, 1), vChin)],
    },
    gonion: [P(...gA.at), P(...gB.at)], menton: P(0, vMenton), cheekPts: [P(cheek.l, cheek.v), P(cheek.r, cheek.v)],
    // 메이크업 영역을 그릴 때 쓰는 얼굴 좌표 변환
    U, toImg, img, CW, eyeW, v: { top: vTop, hair: vHair, brow: vBrow, browTop: vBrowTop, eye: vEye, nose: vNose, sub: vSub, stom: vStom, mouth: vMouth, menton: vMenton, cheek: cheek.v, chin: vChin },
    cheekLR: [cheek.l, cheek.r], zTop,
    ears: ears && ears.map((e) => e.rows.filter((r) => r.out >= 0.05).map((r) => { const s = slice(r.v), um = e.side < 0 ? s.l : s.r; return [P(um, r.v), P(um + e.side * r.out * CW, r.v)]; })),
  };
  return { m, pose, geo, cover, issues, hairline: hairline ? (hairline.hair ? 'hair' : 'edge') : null, maskShare: maskPts / (2 * (K - 1)) };
}
// 이마 위 점(10) 위로 헤어라인까지의 평균 거리 (눈썹 ~ 10 거리 대비). 헤어라인이 보이는 예시 사진들의 평균
const HAIRLINE_EXTRA = 0.42;

// 변환 행렬(열 우선 4×4)의 회전 부분 → 고개 각도 (도)
function poseFrom(mat) {
  if (!mat || mat.length < 16) return null;
  const R = (r, c) => mat[c * 4 + r];
  return {
    yaw: deg(Math.atan2(-R(2, 0), Math.hypot(R(0, 0), R(1, 0)))),
    pitch: deg(Math.atan2(R(2, 1), R(2, 2))),
    roll: deg(Math.atan2(R(1, 0), R(0, 0))),
  };
}

// ---- 다시 찍어 주세요 / 참고해 주세요 --------------------------------------------
// level: 'block' (측정을 믿기 어려움 → 다시 찍기) · 'warn' (결과는 보여 주되 주의)
function checkIssues({ m, pose, cover, blend, purpose, w, h, CW, oval, skinL, hairline, others }) {
  const out = [];
  const add = (key, level, title, fix) => out.push({ key, level, title, fix });
  // 얼굴형은 헤어 · 메이크업 모두에서 쓰므로 이마 · 헤어라인 점검 기준이 같다
  // 화면 밖 · 크기
  const margin = 0.01 * Math.min(w, h);
  if (oval.some(([x, y]) => x < margin || y < margin || x > w - margin || y > h - margin)) add('frame', 'block', '얼굴 일부가 사진 밖으로 나갔어요', '이마 위부터 턱 아래까지 얼굴 전체가 들어오게 찍어 주세요.');
  if (CW < Math.min(w, h) * 0.16) add('small', 'block', '얼굴이 너무 작게 찍혔어요', '얼굴이 화면 가로의 1/3 이상 차도록 조금 더 가까이에서 찍어 주세요.');
  else if (CW > w * 0.85) add('close', 'warn', '카메라가 얼굴에 너무 가까워요', '가까이서 찍으면 렌즈 때문에 코와 얼굴 가운데가 커 보여요. 팔을 쭉 뻗은 거리(50cm 이상)에서 찍으면 더 정확해요.');
  if (others.length) add('many', 'warn', '얼굴이 여러 개 보여요', '가장 크게 나온 얼굴을 분석했어요. 한 사람만 나오게 찍으면 더 확실해요.');
  // 고개 각도
  const yaw = Math.abs(pose.yaw), pitch = Math.abs(pose.pitch), roll = Math.abs(pose.roll);
  if (yaw > 12) add('yaw', 'block', `고개가 옆으로 ${Math.round(yaw)}° 돌아갔어요`, '얼굴 너비와 턱선은 정면에서 재야 정확해요. 카메라를 정면으로 봐 주세요.');
  else if (yaw > 7) add('yaw', 'warn', `고개가 옆으로 조금(${Math.round(yaw)}°) 돌아갔어요`, '각도를 보정했지만 정면 사진이 가장 정확해요.');
  if (pitch > 20) add('pitch', 'block', `고개를 ${Math.round(pitch)}° 들거나 숙였어요`, '얼굴 길이와 삼정 비율이 달라져요. 턱을 들거나 당기지 말고 카메라를 눈높이에 맞춰 주세요.');
  else if (pitch > 12) add('pitch', 'warn', `고개가 위아래로 조금(${Math.round(pitch)}°) 기울었어요`, '카메라를 눈높이에 맞추면 얼굴 길이를 더 정확히 재요.');
  if (roll > 15) add('roll', 'warn', '고개가 옆으로 기울었어요', '기울기는 자동으로 바로잡았어요.');
  // 표정
  const bs = (k) => blend[k] || 0;
  if (bs('jawOpen') > 0.25 || m.lipGap > 0.15) add('mouth', 'block', '입이 벌어져 있어요', '입을 다물어야 턱 길이와 턱선을 정확히 재요.');
  else if (m.lipGap > 0.07) add('mouth', 'warn', '입술이 살짝 벌어져 있어요', '입을 가볍게 다물면 턱 길이를 더 정확히 재요.');
  // 웃음: 표정 점수 또는 입꼬리가 입 가운데보다 확실히 올라간 경우
  const smile = Math.max((bs('mouthSmileLeft') + bs('mouthSmileRight')) / 2, m.cornerLift > 0.05 ? 0.35 + (m.cornerLift - 0.05) * 4 : 0);
  if (smile > 0.5) add('smile', 'block', '활짝 웃고 있어요', '웃으면 볼이 올라가 얼굴 아래쪽이 넓고 짧아 보여요. 입을 다문 무표정으로 찍어 주세요.');
  else if (smile > 0.3) add('smile', 'warn', '살짝 웃고 있어요', '무표정일 때 턱선을 가장 정확히 재요.');
  if ((bs('eyeBlinkLeft') + bs('eyeBlinkRight')) / 2 > 0.5) add('blink', purpose === 'makeup' ? 'block' : 'warn', '눈을 감고 있어요', '눈을 뜬 사진이어야 눈매를 잴 수 있어요.');
  // 밝기
  if (skinL != null && skinL < 28) add('dark', 'warn', '사진이 어두워요', '밝은 곳에서 얼굴 정면에 빛이 오게 찍으면 경계를 더 정확히 찾아요.');
  // 가림
  if (cover.forehead) {
    const f = cover.forehead.hair;
    if (f > 0.2) add('bangs', 'block', `앞머리가 이마를 ${Math.round(f * 100)}% 가리고 있어요`, '앞머리를 위로 넘기거나 핀 · 헤어밴드로 고정해 이마와 헤어라인이 보이게 찍어 주세요. 이마 너비와 이마 높이를 재야 얼굴형을 정확히 알 수 있어요.');
    if (cover.forehead.other > 0.3) add('hat', 'block', '모자나 헤어밴드가 이마를 가려요', '모자를 벗고 이마가 보이게 찍어 주세요.');
  }
  const sides = [];
  for (const z of SIDE_ZONES) {
    for (const s of ['a', 'b']) {
      const c = cover[`${z.key}_${s}`];
      if (!c) continue;
      if (c.hair > (z.key === 'temple' ? 0.45 : 0.25)) sides.push({ zone: z, side: s, f: c.hair });
    }
  }
  const blockSides = sides.filter((x) => x.zone.key !== 'temple');
  if (blockSides.length) {
    const where = [...new Set(blockSides.map((x) => x.zone.label))].join(' · ');
    const lr = new Set(blockSides.map((x) => x.side)).size === 2 ? '양쪽' : blockSides[0].side === 'a' ? '사진 왼쪽' : '사진 오른쪽';
    add('sidehair', 'block', `옆머리가 ${lr} ${where}을 가리고 있어요`, '옆머리를 귀 뒤로 넘기거나 하나로 묶어 귀와 턱선이 보이게 찍어 주세요. 얼굴선을 가리면 얼굴 너비와 턱 모양을 잴 수 없어요.');
  } else if (sides.length) add('temple', 'warn', '관자놀이 쪽을 머리카락이 조금 가려요', '이마 양옆이 보이게 머리를 넘기면 이마 너비를 더 정확히 재요.');
  // 턱선 띠는 목 피부가 조금 섞여 잡히기 쉬워 기준을 높게 둔다
  const handSide = SIDE_ZONES.some((z) => ['a', 'b'].some((s) => (cover[`${z.key}_${s}`]?.body ?? 0) > (z.key === 'jaw' ? 0.55 : 0.2)));
  if (cover.inner?.body > 0.04 || handSide) add('hand', 'block', `손이 ${handSide && !(cover.inner?.body > 0.04) ? '얼굴선을' : '얼굴을'} 가리고 있어요`, '손을 얼굴에서 떼고 턱선까지 다 보이게 찍어 주세요.');
  if (cover.eyes?.other > 0.18) add('glasses', purpose === 'makeup' ? 'block' : 'warn', '안경을 쓰고 있어요', '안경테가 눈썹과 눈매를 가려요. 안경을 벗고 찍으면 더 정확해요.');
  if (cover.inner?.other > 0.15 && !(cover.eyes?.other > 0.18)) add('mask', 'block', '얼굴에 가린 물건이 있어요', '마스크나 소품을 치우고 찍어 주세요.');
  if (!hairline && !out.some((x) => x.key === 'bangs' || x.key === 'hat')) add('hairline', 'warn', '헤어라인을 찾지 못했어요', '이마 높이는 평균 비율로 어림했어요. 이마가 다 보이게 머리를 넘기면 더 정확해요.');
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1));
}

// ---- 얼굴형 ----------------------------------------------------------------------
// 기준값은 정면 얼굴 사진들에서 잰 분포(평균 · 표준편차)를 바탕으로, 얼굴형별 특징 방향으로 옮겨 정했다
export const SHAPES = {
  oval: '계란형', round: '둥근형', long: '긴 얼굴형', square: '각진형', heart: '하트형(역삼각형)', diamond: '마름모형(다이아몬드)',
};
export function classifyShape(m) {
  const z = zscores(m);
  // 얼굴형마다 특징 방향 (+ 크다, - 작다). 값은 표준편차 단위
  const P = {
    oval:    { ratio: 0.3, forehead: 0, jaw: -0.2, chin: -0.2, jawAngle: 0.2, bulge: -0.2 },
    round:   { ratio: -1.4, forehead: 0, jaw: 0.6, chin: 0.8, jawAngle: 0.7, bulge: 0.6 },
    long:    { ratio: 1.6, forehead: 0, jaw: 0, chin: 0, jawAngle: 0, bulge: -0.3 },
    square:  { ratio: -0.6, forehead: 0.5, jaw: 1.3, chin: 0.9, jawAngle: -1.3, bulge: 1.2 },
    heart:   { ratio: 0.2, forehead: 1.3, jaw: -1.2, chin: -1.1, jawAngle: 0.7, bulge: -1.0 },
    diamond: { ratio: 0.3, forehead: -1.4, jaw: -1.0, chin: -0.8, jawAngle: 0.5, bulge: -0.6 },
  };
  const W = { ratio: 1.4, forehead: 1, jaw: 1.1, chin: 0.8, jawAngle: 0.8, bulge: 0.8 };
  const d = {};
  for (const [k, p] of Object.entries(P)) {
    let s = 0;
    for (const f of Object.keys(W)) s += W[f] * (z[f] - p[f]) ** 2;
    d[k] = s;
  }
  const T = 3; // 온도: 클수록 확률이 고르게 퍼진다 (사진 한 장의 측정 오차를 생각해 너무 단정하지 않게)
  const ex = Object.fromEntries(Object.entries(d).map(([k, s]) => [k, Math.exp(-s / T)]));
  const sum = Object.values(ex).reduce((a, b) => a + b, 0);
  const probs = Object.entries(ex).map(([k, e]) => ({ key: k, label: SHAPES[k], p: e / sum })).sort((a, b) => b.p - a.p);
  return { key: probs[0].key, label: probs[0].label, probs, z };
}
// 정면 얼굴 기준 분포 (tools 없이 예시 사진에서 잰 값 · README 참고)
export const NORM = {
  ratio: [1.36, 0.09], forehead: [0.83, 0.04], jaw: [0.84, 0.05], chin: [0.45, 0.055], jawAngle: [131.5, 4.5], bulge: [0.2, 0.015],
  thirds: [[0.93, 0.06], [1.07, 0.05], [1.0, 0.06]], philtrum: [0.53, 0.06],
  eyeSpacing: [1.34, 0.07], eyeAspect: [0.40, 0.03], eyeTilt: [7.2, 1.3], browGap: [0.48, 0.08], browArch: [0.158, 0.011], browTail: [0.20, 0.03],
  nose: [1.06, 0.05], mouth: [1.19, 0.08], lips: [1.37, 0.12], lipFull: [0.43, 0.07],
};
export function zscores(m) {
  const z = (k, x) => (x - NORM[k][0]) / NORM[k][1];
  return { ratio: z('ratio', m.ratio), forehead: z('forehead', m.forehead), jaw: z('jaw', m.jaw), chin: z('chin', m.chin), jawAngle: z('jawAngle', m.jawAngle), bulge: z('bulge', m.jawBulge) };
}

// ---- 브라우저: 사진 → 분석 ---------------------------------------------------------
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const MODEL_DIR = './models/mediapipe';
let tasks = null;
function loadTasks() {
  tasks ??= (async () => {
    const m = await import(`${MP}/vision_bundle.mjs`);
    const fileset = await m.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const bytes = async (f) => { const r = await assetFetch(`${MODEL_DIR}/${f}`); if (!r.ok) throw new Error(`${f} 을(를) 받지 못했어요 (${r.status})`); return new Uint8Array(await r.arrayBuffer()); };
    const [face, seg] = await Promise.all([
      bytes('face_landmarker.task').then((b) => m.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: b, delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 3, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true })),
      bytes('selfie_multiclass_256x256.tflite').then((b) => m.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: b, delegate: 'CPU' },
        runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false })),
    ]);
    return { face, seg };
  })().catch((e) => { tasks = null; throw e; });
  return tasks;
}
export const preloadFace = () => loadTasks();

// ---- 촬영 도우미: 카메라 화면 한 프레임에서 얼굴 위치 · 크기 · 고개 각도 · 표정만 빠르게 본다 (부위 분할 없이) ----
// source: <video> 또는 <canvas> (거울 처리 전 원래 화면). 좌표는 0~1 비율
export async function liveCheck(source) {
  const { face } = await loadTasks();
  const res = face.detect(source);
  const all = res.faceLandmarks || [];
  if (!all.length) return { faces: 0 };
  const area = (lm) => { let x0 = 1, y0 = 1, x1 = 0, y1 = 0; for (const p of lm) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); } return (x1 - x0) * (y1 - y0); };
  let k = 0;
  all.forEach((lm, i) => { if (area(lm) > area(all[k])) k = i; });
  const big = all.filter((lm) => area(lm) > area(all[k]) * 0.25).length; // 뒤쪽에 작게 나온 사람은 세지 않는다
  const blend = Object.fromEntries((res.faceBlendshapes?.[k]?.categories || []).map((c) => [c.categoryName, c.score]));
  return { faces: big, lm: all[k], blend, pose: poseFrom(res.facialTransformationMatrixes?.[k]?.data) };
}

// 촬영 도우미 기준 (정면 얼굴 101장에서 잰 값). 화면에서 이마 위 점(10)과 턱끝(152)이 이 높이에 오도록 안내한다
export const FRAME = {
  top: 0.27, chin: 0.67,          // 화면 높이 비율 (얼굴 길이 = 화면 높이의 40%)
  widthRatio: 0.82,               // 얼굴 너비(234–454) ÷ 얼굴 길이(10–152)
  jawRatio: 0.56, jawY: 0.84,     // 턱 너비 ÷ 얼굴 길이, 턱 각 높이 (이마 위 점 → 턱끝 비율)
  pitch0: 6,                      // 카메라를 눈높이에 둔 정면 얼굴의 고개 위아래 각도 중앙값 (+ 는 숙임)
};

// 부위 분할을 얼굴 둘레만 잘라서 돌린다. 분할 모델은 입력을 256×256 으로 줄여 보므로, 프레임 안에서 얼굴이 작으면(웹캠 · 상반신 사진)
// 마스크가 거칠어져 턱선 · 턱끝 · 이마 측정이 흔들린다. 얼굴 너비의 0.8배(옆) · 높이의 0.9배(위, 머리카락) · 0.55배(아래, 목) 여유를 두고
// 잘라 넣으면 얼굴이 사진의 어디에 어떤 크기로 있든 마스크 해상도가 비슷해진다. 결과는 사진 픽셀 크기의 마스크 (자른 밖은 배경 0)
function segmentAround(seg, canvas, lm) {
  const w = canvas.width, h = canvas.height;
  const xs = OVAL.map((i) => lm[i][0] * w), ys = OVAL.map((i) => lm[i][1] * h);
  const fx0 = Math.min(...xs), fx1 = Math.max(...xs), fy0 = Math.min(...ys), fy1 = Math.max(...ys);
  const fw = fx1 - fx0, fh = fy1 - fy0;
  const x0 = Math.max(0, Math.floor(fx0 - fw * 0.8)), x1 = Math.min(w, Math.ceil(fx1 + fw * 0.8));
  const y0 = Math.max(0, Math.floor(fy0 - fh * 0.9)), y1 = Math.min(h, Math.ceil(fy1 + fh * 0.55));
  const cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
  const run = (src) => { const s = seg.segment(src); const cm = s.categoryMask; const m = { data: new Uint8Array(cm.getAsUint8Array()), w: cm.width, h: cm.height }; s.close?.(); return m; };
  const whole = cw * ch >= w * h * 0.9;
  let src = canvas;
  if (!whole) { src = document.createElement('canvas'); src.width = cw; src.height = ch; src.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch); }
  const m = run(src);
  const [ox, oy, ow, oh] = whole ? [0, 0, w, h] : [x0, y0, cw, ch];
  if (whole && m.w === w && m.h === h) return m.data;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < oh; y++) {
    const my = Math.floor((y / oh) * m.h) * m.w, row = (oy + y) * w + ox;
    for (let x = 0; x < ow; x++) out[row + x] = m.data[my + Math.floor((x / ow) * m.w)];
  }
  return out;
}

// 귀는 얼굴 둘레 마스크에서 몇 픽셀밖에 안 되므로(256px 로 줄여 봄), 귀 둘레(광대 너비의 0.8 × 1.0)만 따로 잘라 한 번 더 분할한다.
// 얼굴 옆선 · 머리카락이 함께 들어가게 잘라야 분할 모델이 귀를 얼굴 피부로 알아본다. 얼굴 마스크에서 이미 얼굴 피부인 곳은 그대로 두고
// (귀만 잘라 넣으면 귀를 놓치는 사진이 있어서), 나머지를 고해상도 결과로 덮어쓴 사본
function segmentEars(seg, canvas, lm, mask) {
  const w = canvas.width, h = canvas.height;
  const L = [lm[234][0] * w, lm[234][1] * h], R = [lm[454][0] * w, lm[454][1] * h];
  const cw = Math.hypot(R[0] - L[0], R[1] - L[1]);
  if (cw < 40) return null;
  const out = mask.slice();
  for (const [p, s] of [[L, -1], [R, 1]]) {
    const bw = cw * 1.0, bh = cw * 1.1, cx = p[0] + s * cw * 0.08, cy = p[1] + cw * 0.08;
    const x0 = Math.max(0, Math.floor(cx - bw / 2)), x1 = Math.min(w, Math.ceil(cx + bw / 2));
    const y0 = Math.max(0, Math.floor(cy - bh / 2)), y1 = Math.min(h, Math.ceil(cy + bh / 2));
    if (x1 - x0 < 16 || y1 - y0 < 16) continue;
    const src = document.createElement('canvas'); src.width = x1 - x0; src.height = y1 - y0;
    src.getContext('2d').drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    const r = seg.segment(src); const cm = r.categoryMask; const m = new Uint8Array(cm.getAsUint8Array()), mw = cm.width, mh = cm.height; r.close?.();
    for (let y = y0; y < y1; y++) {
      const my = Math.floor(((y - y0) / (y1 - y0)) * mh) * mw;
      for (let x = x0; x < x1; x++) { const i = y * w + x, c = m[my + Math.floor(((x - x0) / (x1 - x0)) * mw)]; if (out[i] !== SEG.face || c === SEG.face) out[i] = c === SEG.body && out[i] === SEG.face ? SEG.face : c; }
    }
  }
  return out;
}

export async function analyzeFace(blob, { purpose = 'hair' } = {}) {
  const { face, seg } = await loadTasks();
  const focal35 = await readFocal35(blob).catch(() => null); // 사진 정보(EXIF)의 35mm 환산 초점거리 — 카메라 거리 어림용
  const bmp = await createImageBitmap(blob);
  const origW = bmp.width, origH = bmp.height;
  const sc = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * sc); canvas.height = Math.round(bmp.height * sc);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const w = canvas.width, h = canvas.height;

  const r = face.detect(canvas);
  if (!r.faceLandmarks?.length) {
    return { ok: false, w, h, canvas, issues: [{ key: 'noface', level: 'block', title: '얼굴을 찾지 못했어요', fix: '얼굴 전체가 화면에 들어오게, 밝은 곳에서 정면으로 찍어 주세요.' }] };
  }
  // 가장 크게 나온 얼굴
  const size = (lm) => { const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
  const order = r.faceLandmarks.map((lm, i) => ({ i, s: size(lm) })).sort((a, b) => b.s - a.s);
  const k = order[0].i;
  const others = order.slice(1).filter((o) => o.s > order[0].s * 0.25);
  const lm = r.faceLandmarks[k].map((p) => [p.x, p.y, p.z]);
  const blend = Object.fromEntries((r.faceBlendshapes?.[k]?.categories || []).map((c) => [c.categoryName, c.score]));
  const mat = r.facialTransformationMatrixes?.[k]?.data ? Array.from(r.facialTransformationMatrixes[k].data) : null;

  // 부위 분할은 얼굴 둘레(머리카락 · 목까지 여유)를 잘라서 돌린다 → 사진 픽셀 크기의 마스크
  const mask = segmentAround(seg, canvas, lm);
  const sw = w, sh = h;

  // 얼굴 피부 평균색 (볼 가운데) — 밝기 점검 · 피부 톤 참고용
  const data = ctx.getImageData(0, 0, w, h).data;
  const skinPx = [];
  for (const i of [50, 280, 101, 330, 205, 425]) {
    const cx = lm[i][0] * w, cy = lm[i][1] * h, rad = Math.max(3, w * 0.012);
    for (let y = Math.round(cy - rad); y <= cy + rad; y++) for (let x = Math.round(cx - rad); x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h || (x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
      if (mask[Math.floor((y / h) * sh) * sw + Math.floor((x / w) * sw)] !== SEG.face) continue;
      const j = (y * w + x) * 4; skinPx.push([data[j], data[j + 1], data[j + 2]]);
    }
  }
  const skin = skinPx.length > 20 ? skinTone(skinPx) : null;

  const earSeg = segmentEars(seg, canvas, lm, mask);
  const res = measureFace({ lm, w, h, seg: mask, sw, sh, earSeg, blend, mat, skinL: skin?.lab[0], purpose, others });
  // 카메라 거리: 초점거리(픽셀) × 눈동자 간격(평균 6.3cm) ÷ 사진 속 눈동자 간격(픽셀). 35mm 환산 초점거리는 대각선 43.3mm 기준
  let distance = null;
  if (focal35 && focal35 > 5 && focal35 < 400) {
    const ipdPx = Math.hypot((lm[473][0] - lm[468][0]) * origW, (lm[473][1] - lm[468][1]) * origH);
    const focalPx = (focal35 * Math.hypot(origW, origH)) / 43.27;
    if (ipdPx > 8) distance = (focalPx * 6.3) / ipdPx;
  }
  if (distance != null) {
    res.issues = res.issues.filter((x) => x.key !== 'close');
    if (distance < 35) res.issues.unshift({ key: 'close', level: 'warn', title: `카메라가 얼굴에 가까워요 (약 ${Math.round(distance)}cm)`,
      fix: '가까이서 찍으면 렌즈 때문에 코와 얼굴 가운데가 커 보여요. 팔을 쭉 뻗은 거리(50cm 이상)에서 찍으면 더 정확해요.' });
  }
  const shape = classifyShape(res.m);
  const blocked = res.issues.some((x) => x.level === 'block');
  return { ok: !blocked, purpose, w, h, canvas, lm, blend, skin, mask: { data: mask, w: sw, h: sh }, ...res, shape, distance, focal35 };
}

// ---- 여러 장 합치기 (웹캠 연속 촬영) ----------------------------------------------------
// 같은 사람을 몇 장 찍어 각각 잰 뒤, 점검을 통과한 장들의 측정값 중앙값을 쓴다 → 한 장의 흔들림(표정 · 미세한 각도)이 줄어든다.
// 그림 · 사진은 중앙값에 가장 가까운 장을 쓴다. 통과한 장이 없으면 막힌 이유가 가장 적은 장을 돌려준다 (다시 찍기 안내)
const MEDIAN_KEYS = ['ratio', 'forehead', 'jaw', 'chin', 'jawAngle', 'jawBulge', 'chinAngle', 'philtrum', 'eyeSpacing', 'eyeAspect', 'eyeTilt', 'eyeToFace',
  'browGap', 'browArch', 'browTail', 'nose', 'noseLen', 'mouth', 'mouthIpd', 'lips', 'lipFull', 'cornerLift', 'lipGap'];
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
export function combineFaces(results) {
  const valid = results.filter((r) => r && r.geo);
  if (!valid.length) return results[0];
  const ok = valid.filter((r) => r.ok);
  if (!ok.length) return valid.slice().sort((a, b) => a.issues.filter((x) => x.level === 'block').length - b.issues.filter((x) => x.level === 'block').length)[0];
  if (ok.length === 1) return { ...ok[0], frames: { used: 1, total: results.length } };
  const m = {};
  for (const k of MEDIAN_KEYS) m[k] = median(ok.map((r) => r.m[k]));
  m.thirds = [0, 1, 2].map((i) => median(ok.map((r) => r.m.thirds[i])));
  m.asym = { brow: median(ok.map((r) => r.m.asym.brow)), eye: median(ok.map((r) => r.m.asym.eye)) };
  const ears = ok.map((r) => r.m.ears).filter(Boolean);
  if (ears.length) m.ears = { ...ears[0], ...Object.fromEntries(['shown', 'hair', 'out', 'len'].map((k) => [k, median(ears.map((e) => e[k]))])) };
  // 중앙값에 가장 가까운 장 (얼굴형에 쓰는 값 기준, 표준편차 단위)
  const z = zscores(m);
  const dist = (r) => { const zr = zscores(r.m); return Object.keys(z).reduce((s, k) => s + (zr[k] - z[k]) ** 2, 0); };
  const base = ok.slice().sort((a, b) => dist(a) - dist(b))[0];
  return { ...base, m, shape: classifyShape(m), frames: { used: ok.length, total: results.length } };
}

// JPEG 의 EXIF 에서 35mm 환산 초점거리(FocalLengthIn35mmFilm)를 읽는다. 없으면 null
async function readFocal35(blob) {
  if (!/jpe?g/i.test(blob.type || '')) return null;
  const buf = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
  if (buf.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= buf.byteLength) {
    if (buf.getUint8(p) !== 0xff) return null;
    const marker = buf.getUint8(p + 1), len = buf.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= buf.byteLength && buf.getUint32(p + 4) === 0x45786966) { // 'Exif'
      const t = p + 10; // TIFF 헤더
      const le = buf.getUint16(t) === 0x4949;
      const u16 = (o) => buf.getUint16(t + o, le), u32 = (o) => buf.getUint32(t + o, le);
      if (u16(2) !== 0x2a) return null;
      const readIfd = (off, want) => {
        const n = u16(off); let found = null;
        for (let i = 0; i < n; i++) {
          const e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2);
          if (tag === want) found = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : null;
        }
        return found;
      };
      const exifIfd = readIfd(u32(4), 0x8769);
      return exifIfd ? readIfd(exifIfd, 0xa405) : null;
    }
    if (marker === 0xda) return null; // 이미지 데이터 시작
    p += 2 + len;
  }
  return null;
}

// 볼 피부색: 밝기 위아래 끝을 빼고 평균 → Lab
function skinTone(px) {
  const labs = px.map(rgb2lab).sort((a, b) => a[0] - b[0]);
  const kept = labs.slice(Math.floor(labs.length * 0.15), Math.ceil(labs.length * 0.85));
  const lab = [0, 1, 2].map((i) => kept.reduce((s, p) => s + p[i], 0) / kept.length);
  const hex = '#' + lab2rgb(lab).map((v) => v.toString(16).padStart(2, '0')).join('');
  return { lab: lab.map((v) => Math.round(v * 10) / 10), hex, hue: deg(Math.atan2(lab[2], lab[1])), chroma: Math.hypot(lab[1], lab[2]) };
}
