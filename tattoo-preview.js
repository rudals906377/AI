// 타투 크기 미리 보기: 사진 속 도안을 뽑아 몸 실루엣 위에 원하는 cm 크기로 올려 본다 (참고용 · 실제 피부 · 체형마다 다르다)
//
//   mountTattooPreview(container, { photo: Blob, place: '팔안쪽' | …, size: '미니' | … })
//
// 도안 뽑기: 사진에서 피부색(밝은 쪽 픽셀의 중앙값)과 많이 다른 픽셀만 남긴다 — 배경이 많이 찍힌 사진이면 배경도 조금 섞일 수 있다.
// 실루엣은 성인 평균 치수(cm)로 그린 단순한 모양이라 '이 크기면 이 정도 자리'를 가늠하는 용도다. 사진은 브라우저 밖으로 나가지 않는다.

// 실루엣 (cm 좌표). parts: 칠할 다각형들, max: 슬라이더 최대 cm
const TPL = {
  arm: { name: '팔', max: 22, parts: [[[0, -4.6], [13, -4.2], [25, -3], [27, -3.1], [29, -3.8], [35, -4.2], [38, -3.2], [38.5, 2.8], [35, 3.8], [29, 3.4], [27, 3], [25, 3], [13, 4.3], [0, 4.8]]] },
  hand: { name: '손', max: 9, parts: [[[0, 0], [9, 0], [9.6, 10.5], [-0.4, 10.5]], [[0.2, 0.4], [0.3, -6.6], [2.1, -6.8], [2.2, 0.4]], [[2.5, 0.4], [2.5, -7.8], [4.5, -7.9], [4.6, 0.4]], [[4.9, 0.4], [5, -7.3], [6.9, -7.2], [6.9, 0.4]], [[7.2, 0.6], [7.4, -5.2], [9, -5], [8.9, 1]], [[-0.4, 8], [-4.5, 3.5], [-3.6, 2.4], [0.2, 5.4]]] },
  front: { name: '몸 앞', max: 40, parts: [[[-20, 0], [-8, -2], [8, -2], [20, 0], [19, 8], [15, 20], [14, 35], [16, 55], [-16, 55], [-14, 35], [-15, 20], [-19, 8]], [[-5.5, -2], [-5, -9], [5, -9], [5.5, -2]]] },
  back: { name: '등', max: 45, parts: [[[-20, 0], [-8, -2], [8, -2], [20, 0], [19, 8], [16, 22], [15, 38], [16, 55], [-16, 55], [-15, 38], [-16, 22], [-19, 8]], [[-5.5, -2], [-5, -9], [5, -9], [5.5, -2]]] },
  leg: { name: '다리', max: 30, parts: [[[-8, 0], [8, 0], [7, 30], [5, 45], [5.5, 60], [4, 78], [7, 82], [-3, 82], [-3, 78], [-5.5, 60], [-5, 45], [-7, 30]]] },
  neck: { name: '목', max: 12, parts: [[[-6, 0], [6, 0], [6.5, 13], [-6.5, 13]], 'head'] },
};
// 실루엣을 바꿨을 때 처음 놓을 자리
const TPL_AT = { arm: [13, 0], hand: [4.6, 4.5], front: [-8, 10], back: [0, 22], leg: [0, 15], neck: [0, 6] };
// 다각형 방향을 모두 같게 (겹치는 부분이 구멍으로 빠지지 않게)
for (const t of Object.values(TPL)) t.parts = t.parts.map((p) => { if (!Array.isArray(p)) return p; let a = 0; p.forEach(([x, y], i) => { const [u, v] = p[(i + 1) % p.length]; a += x * v - u * y; }); return a < 0 ? p.slice().reverse() : p; });
// 부위 이름 → 실루엣 · 처음 놓을 자리 (cm)
const PLACE_AT = {
  손목: ['arm', 26, 0], 팔안쪽: ['arm', 13, 0], 팔뚝: ['arm', 13, 0], '어깨·위팔': ['arm', 11, 0], '손·손가락': ['hand', 4.6, 4.5],
  쇄골: ['front', -9, 3], 가슴: ['front', -8, 10], 흉골: ['front', 0, 12], '배·복부': ['front', 0, 32], 옆구리: ['front', 12, 22], '허리·골반': ['front', -10, 46],
  등: ['back', 0, 22], 날개뼈: ['back', -9, 10], 척추: ['back', 0, 28],
  허벅지: ['leg', 0, 15], 종아리: ['leg', 0, 52], '발목·발등': ['leg', 0, 75], '무릎·팔꿈치': ['leg', 0, 38],
  '목·귀뒤': ['neck', 0, 6], '얼굴·두피': ['neck', 0, -12],
};
// 크기 이름 → 처음 cm
const SIZE_CM = { 미니: 2.5, 스몰: 6, 미디엄: 10, 대형: 20, 반팔: 22, 긴팔: 22, 등판: 40, 전신: 40 };
const SKIN = ['#f1d3bd', '#e2b594', '#c98f6a', '#8d5a3c'];

// 도안 뽑기 → 투명 배경 캔버스
export async function extractInk(photo, max = 320) {
  const bmp = await createImageBitmap(photo);
  const cw = bmp.width * 0.84, ch = bmp.height * 0.84, cx = (bmp.width - cw) / 2, cy = (bmp.height - ch) / 2;
  const s = Math.min(1, max / Math.max(cw, ch)), W = Math.max(1, Math.round(cw * s)), H = Math.max(1, Math.round(ch * s));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, cx, cy, cw, ch, 0, 0, W, H); bmp.close?.();
  const img = g.getImageData(0, 0, W, H), d = img.data;
  // 피부 추정: 가운데 60% 안에서 밝기 상위 60% 픽셀의 채널별 중앙값 (가장자리 배경의 영향을 줄인다)
  const lum = [];
  for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  const inMid = (j) => { const x = j % W, y = (j / W) | 0; return x > W * 0.2 && x < W * 0.8 && y > H * 0.2 && y < H * 0.8; };
  const midL = lum.filter((_, j) => inMid(j)).sort((a, b) => a - b);
  const cut = midL[Math.floor(midL.length * 0.4)] ?? 0;
  const ch3 = [[], [], []];
  for (let i = 0, j = 0; i < d.length; i += 4, j++) if (lum[j] >= cut && inMid(j)) { ch3[0].push(d[i]); ch3[1].push(d[i + 1]); ch3[2].push(d[i + 2]); }
  const med = ch3.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1] ?? 200; });
  const skinL = 0.299 * med[0] + 0.587 * med[1] + 0.114 * med[2];
  for (let y = 0, j = 0; y < H; y++) for (let x = 0; x < W; x++, j++) {
    const i = j * 4;
    const dist = Math.hypot(d[i] - med[0], d[i + 1] - med[1], d[i + 2] - med[2]);
    const dark = Math.max(0, skinL - lum[j]);
    let a = Math.min(1, Math.max(0, (dist - 28) / 70) + Math.max(0, (dark - 20) / 90));
    // 피부보다 밝고 색이 옅은 픽셀(흰 벽 · 회색 배경)은 잉크가 아니다
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    if (lum[j] > skinL + 12 && mx - mn < 40) a = 0;
    // 가장자리는 서서히 사라지게 (잘린 네모가 보이지 않게)
    const e = Math.min(x, y, W - 1 - x, H - 1 - y) / (Math.min(W, H) * 0.18);
    a *= Math.min(1, e);
    d[i + 3] = Math.round(a * 235);
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function mountTattooPreview(box, { photo, place = null, size = null }) {
  if (!box || !photo) return;
  // '팔 계열'처럼 묶음 이름이면 낱말로 실루엣을 고른다
  const fuzzy = (n) => { if (!n) return null; for (const [re, k] of [[/손/, '손·손가락'], [/팔|손목/, '팔안쪽'], [/다리|허벅|종아리|발/, '허벅지'], [/등|척추|날개/, '등'], [/목|귀|얼굴/, '목·귀뒤'], [/가슴|쇄골|배|옆구리|허리|골반|몸통/, '가슴']]) if (re.test(n)) return PLACE_AT[k]; return null; };
  const at = PLACE_AT[place] || fuzzy(place) || PLACE_AT.팔안쪽;
  const st = { tpl: at[0], x: at[1], y: at[2], cm: Math.min(TPL[at[0]].max, SIZE_CM[size] || 6), skin: SKIN[0] };
  box.innerHTML = `<div class="tp-head"><b>크기 미리 보기</b><small>사진 속 도안을 몸 위에 올려 봤어요 · 끌어서 옮길 수 있어요</small></div>
    <canvas class="tp-canvas" aria-label="몸 실루엣 위에 도안을 올린 그림"></canvas>
    <div class="tp-ctrl">
      <div class="seg seg-sm tp-tpl">${Object.entries(TPL).map(([k, t]) => `<button type="button" data-tpl="${k}">${t.name}</button>`).join('')}</div>
      <label class="tp-size">크기 <input type="range" min="1" step="0.5" /> <output></output></label>
      <div class="tp-skin" role="group" aria-label="피부 톤">${SKIN.map((c) => `<button type="button" data-skin="${c}" style="background:${c}" aria-label="피부 톤"></button>`).join('')}</div>
    </div>
    <p class="muted small">성인 평균 치수로 그린 실루엣이라 실제 몸과 다를 수 있어요. 도안 크기는 상담 때 cm 로 정해 주세요.</p>`;
  const cv = box.querySelector('canvas'), range = box.querySelector('input[type=range]'), out = box.querySelector('output');
  let ink = null;
  try { ink = await extractInk(photo); } catch (e) { console.warn('[tattoo] 도안을 뽑지 못했어요', e); }
  const bounds = (t) => { const pts = t.parts.filter(Array.isArray).flat(); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); if (t.parts.includes('head')) ys.push(-23); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  let view = null;
  function draw() {
    const t = TPL[st.tpl], [x0, y0, x1, y1] = bounds(t);
    const cssW = Math.min(520, box.clientWidth || 360), W = Math.round(cssW * 2), H = Math.round(W * 0.62);
    cv.width = W; cv.height = H;
    const pad = 26, sc = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2 - 30) / (y1 - y0));
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = pad - y0 * sc;
    view = { sc, ox, oy };
    const P = ([x, y]) => [ox + x * sc, oy + y * sc];
    const g = cv.getContext('2d');
    g.fillStyle = getComputedStyle(cv).getPropertyValue('--tp-bg') || '#f3ebe2'; g.fillRect(0, 0, W, H);
    const shape = new Path2D();
    for (const part of t.parts) {
      if (part === 'head') { const [hx, hy] = P([0, -11]); shape.ellipse(hx, hy, 9 * sc, 11.5 * sc, 0, 0, Math.PI * 2); continue; }
      part.forEach((p, i) => { const [x, y] = P(p); i ? shape.lineTo(x, y) : shape.moveTo(x, y); }); shape.closePath();
    }
    g.fillStyle = st.skin; g.fill(shape, 'nonzero');
    g.strokeStyle = 'rgba(80,50,35,.25)'; g.lineWidth = 2; g.stroke(shape);
    // 도안: 실루엣 안에서만, 피부 결을 살리게 multiply
    if (ink) {
      const w = st.cm * sc, h = w * (ink.height / ink.width);
      // 도안이 실루엣 밖으로 크게 나가지 않게 가운데를 몸 안쪽으로 당긴다
      const half = st.cm / 2, halfH = half * (ink.height / ink.width);
      if (x1 - x0 > st.cm) st.x = Math.max(x0 + half, Math.min(x1 - half, st.x));
      if (y1 - y0 > st.cm * (ink.height / ink.width)) st.y = Math.max(y0 + halfH, Math.min(y1 - halfH, st.y));
      const [cx, cy] = P([st.x, st.y]);
      g.save(); g.clip(shape, 'nonzero'); g.globalCompositeOperation = 'multiply'; g.drawImage(ink, cx - w / 2, cy - h / 2, w, h); g.restore();
      g.save(); g.setLineDash([6, 5]); g.strokeStyle = 'rgba(143,102,84,.75)'; g.lineWidth = 2; g.strokeRect(cx - w / 2, cy - h / 2, w, h); g.restore();
    }
    // 자: 5cm (실루엣이 크면 10cm)
    const unit = t.max >= 30 ? 10 : 5, uw = unit * sc;
    g.fillStyle = '#5b4336'; g.fillRect(pad, H - 22, uw, 4); g.fillRect(pad, H - 28, 2, 16); g.fillRect(pad + uw - 2, H - 28, 2, 16);
    g.font = '600 22px "Pretendard Variable", Pretendard, system-ui, sans-serif'; g.fillText(`${unit}cm`, pad + uw + 10, H - 12);
    out.textContent = `약 ${st.cm}cm`;
  }
  const syncCtrl = () => {
    box.querySelectorAll('[data-tpl]').forEach((b) => b.classList.toggle('active', b.dataset.tpl === st.tpl));
    box.querySelectorAll('[data-skin]').forEach((b) => b.classList.toggle('active', b.dataset.skin === st.skin));
    range.max = TPL[st.tpl].max; range.value = st.cm;
  };
  box.querySelector('.tp-tpl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]'); if (!b) return;
    st.tpl = b.dataset.tpl;
    [st.x, st.y] = TPL_AT[st.tpl];
    st.cm = Math.min(st.cm, TPL[st.tpl].max); syncCtrl(); draw();
  });
  box.querySelector('.tp-skin').addEventListener('click', (e) => { const b = e.target.closest('[data-skin]'); if (!b) return; st.skin = b.dataset.skin; syncCtrl(); draw(); });
  range.addEventListener('input', () => { st.cm = +range.value; draw(); });
  // 끌어서 옮기기 (마우스 · 터치)
  let drag = null;
  const toCm = (e) => { const r = cv.getBoundingClientRect(), k = cv.width / r.width; return [((e.clientX - r.left) * k - view.ox) / view.sc, ((e.clientY - r.top) * k - view.oy) / view.sc]; };
  cv.addEventListener('pointerdown', (e) => { const [x, y] = toCm(e); drag = [x - st.x, y - st.y]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const [x, y] = toCm(e); st.x = x - drag[0]; st.y = y - drag[1]; draw(); });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('pointercancel', () => { drag = null; });
  syncCtrl(); draw();
  return { redraw: draw };
}
