// 퍼스널 컬러 (참고용) — 사진 속 피부 · 머리카락 · 눈썹 색으로 4계절 + 세부 톤을 어림한다
//
//   const cs = colorSeason({ skin, hair, brow });   // skin: {lab, hue, chroma} (face.js skinTone) · hair/brow: {lab} 또는 null
//   → { season, sub, label, conf, why: [], palette: [hex], avoid: [hex], drape: { good: [hex], bad: [hex] }, note }
//
// 사진 한 장의 색은 조명 · 보정 · 화이트밸런스에 크게 흔들리므로 '참고용'이고, 가상 드레이프(얼굴 옆에 색 대 보기)로 눈으로 확인하게 한다.
// 판정 축: ① 언더톤(웜/쿨) = 피부 b*(노란기) 대 a*(붉은기)의 각도 ② 명도 = 피부 L* ③ 대비 = 피부 L* − 머리/눈썹 L* ④ 채도 = 피부 chroma
const P = {
  spring_light: { label: '봄 라이트', palette: ['#F7D9C4', '#FBE7A1', '#B5E0C9', '#FFC4B0', '#D8E9A8', '#FFDFE6', '#C9E6F2', '#F2E2C4'], avoid: ['#1C1C1C', '#5B2C6F', '#4A4A4A', '#003366'] },
  spring_bright: { label: '봄 브라이트', palette: ['#FF6F3C', '#FFD23F', '#2BC48A', '#FF4F79', '#1FA2FF', '#FF9A3C', '#7AD236', '#FFB3C6'], avoid: ['#8C8C8C', '#A79B8E', '#6B5B53', '#4D4D4D'] },
  summer_light: { label: '여름 라이트', palette: ['#E6D7F2', '#CFE3F5', '#F5D6E0', '#DDEBD4', '#F2E9F7', '#BFD7EA', '#F8E1EC', '#E3E8F2'], avoid: ['#FF6F00', '#8B4513', '#000000', '#B8860B'] },
  summer_mute: { label: '여름 뮤트', palette: ['#9FB7C9', '#B59CB5', '#A8C3B1', '#D9A5B3', '#8FA3BF', '#C7B9A8', '#A3A3C2', '#B9CBD6'], avoid: ['#FF4500', '#FFD700', '#000000', '#00FF7F'] },
  autumn_mute: { label: '가을 뮤트', palette: ['#C8A882', '#A3A380', '#B5836D', '#D9B99B', '#8E9A5B', '#C58C6E', '#B49A7D', '#9C7A5B'], avoid: ['#FF1493', '#00BFFF', '#000000', '#E0E0E0'] },
  autumn_deep: { label: '가을 딥', palette: ['#7A3E1D', '#4F6228', '#B5651D', '#8B2E2E', '#3E5F3E', '#A0522D', '#5C4033', '#C97B2A'], avoid: ['#FFC0CB', '#E6E6FA', '#B0E0E6', '#F5F5F5'] },
  winter_bright: { label: '겨울 브라이트', palette: ['#E60026', '#0033A0', '#00A86B', '#FF00A8', '#FFFFFF', '#111111', '#7B2CBF', '#00C2FF'], avoid: ['#C8A882', '#D2B48C', '#BC8F8F', '#F5DEB3'] },
  winter_deep: { label: '겨울 딥', palette: ['#111111', '#4B0082', '#800020', '#003153', '#006400', '#FFFFFF', '#2F4F4F', '#8B008B'], avoid: ['#FFDAB9', '#F0E68C', '#E9967A', '#D2B48C'] },
};
const SEASON_KO = { spring: '봄 웜톤', summer: '여름 쿨톤', autumn: '가을 웜톤', winter: '겨울 쿨톤' };

export function colorSeason({ skin, hair = null, brow = null } = {}) {
  if (!skin?.lab) return null;
  const [L, a, b] = skin.lab;
  const hue = skin.hue ?? (Math.atan2(b, a) * 180) / Math.PI;
  const chroma = skin.chroma ?? Math.hypot(a, b);
  const dark = hair?.lab?.[0] ?? brow?.lab?.[0] ?? null;
  const contrast = dark == null ? null : L - dark;
  const why = [];
  // ① 언더톤: 각도 62° 이상 노란기(웜), 50° 이하 붉은기(쿨), 사이는 중립 → 머리카락 색으로 보조
  let warm = hue >= 62 ? 1 : hue <= 50 ? -1 : 0;
  const hairWarm = hair?.lab ? (Math.atan2(hair.lab[2], hair.lab[1]) * 180) / Math.PI : null;
  if (warm === 0 && hairWarm != null) warm = hairWarm >= 60 ? 0.5 : hairWarm <= 45 ? -0.5 : 0;
  why.push(warm > 0 ? `피부에 노란기가 살짝 도는 편이에요 (색 각도 ${Math.round(hue)}°)` : warm < 0 ? `피부에 붉은기가 살짝 도는 편이에요 (색 각도 ${Math.round(hue)}°)` : `노란기와 붉은기가 비슷한 중간 톤이에요 (색 각도 ${Math.round(hue)}°)`);
  // ② 명도 ③ 대비 ④ 채도
  const light = L >= 66, deepC = contrast != null && contrast >= 38, lowC = contrast != null && contrast < 24, bright = chroma >= 24, muted = chroma < 17;
  why.push(light ? `피부가 밝은 편이에요 (밝기 ${Math.round(L)})` : `피부가 중간에서 조금 어두운 편이에요 (밝기 ${Math.round(L)})`);
  if (contrast != null) why.push(deepC ? `피부와 머리색의 대비가 뚜렷한 편이에요 (${Math.round(contrast)})` : lowC ? `피부와 머리색의 대비가 부드러운 편이에요 (${Math.round(contrast)})` : `피부와 머리색의 대비는 보통이에요 (${Math.round(contrast)})`);
  why.push(bright ? '피부 색이 맑고 선명한 편이에요' : muted ? '피부 색이 차분하고 은은한(뮤트) 편이에요' : '피부 색의 선명함은 보통이에요');
  let key;
  if (warm >= 0) {   // 웜 (중립이면 웜 쪽을 먼저 보되 신뢰도 낮춤)
    if (light && !deepC) key = bright ? 'spring_bright' : 'spring_light';
    else if (deepC) key = 'autumn_deep';
    else key = muted ? 'autumn_mute' : light ? 'spring_bright' : 'autumn_mute';
    if (warm === 0 && !light) key = deepC ? 'winter_deep' : 'summer_mute';
  } else {
    if (deepC || bright) key = bright || !light ? (deepC ? 'winter_deep' : 'winter_bright') : 'winter_bright';
    else key = light ? 'summer_light' : 'summer_mute';
    if (muted && !deepC) key = 'summer_mute';
  }
  const season = key.split('_')[0];
  // 신뢰도: 경계(언더톤 중립 · 대비 모름 · 채도 중간)마다 깎는다
  let conf = 0.8;
  if (warm === 0 || Math.abs(warm) === 0.5) conf -= 0.25;
  if (contrast == null) conf -= 0.15;
  if (!bright && !muted) conf -= 0.1;
  if (Math.abs(hue - 56) < 6) conf -= 0.1;
  conf = Math.max(0.25, Math.round(conf * 100) / 100);
  const p = P[key];
  const opp = { spring: 'winter_deep', summer: 'autumn_deep', autumn: 'summer_light', winter: 'spring_light' }[season];
  return {
    season, sub: key, label: `${SEASON_KO[season]} · ${p.label}`, conf, why,
    palette: p.palette, avoid: p.avoid,
    drape: { good: p.palette.slice(0, 3), bad: P[opp].palette.slice(0, 3) },
    note: '사진 한 장의 색은 조명이나 보정, 카메라 설정에 따라 달라질 수 있어요. 참고용으로 봐 주시고, 위 드레이프에서 얼굴이 더 맑아 보이는 쪽이 내 톤에 가까워요. 정확한 진단은 자연광 아래 드레이핑 상담을 권해요.',
  };
}
// 마스크로 머리카락 · 눈썹 평균색 (Lab) — 분석 결과의 canvas · mask · lm 으로 UI 에서 계산
export function regionLab(canvas, mask, segId, pts = null, rad = 0) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, w, h).data, labs = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  if (pts) {
    for (const [cx, cy] of pts) for (let y = Math.round(cy - rad); y <= cy + rad; y += 1) for (let x = Math.round(cx - rad); x <= cx + rad; x += 1) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue; const j = (y * w + x) * 4; labs.push(rgb2lab([data[j], data[j + 1], data[j + 2]]));
    }
  } else for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    if (mask.data[Math.floor((y / h) * mask.h) * mask.w + Math.floor((x / w) * mask.w)] !== segId) continue;
    const j = (y * w + x) * 4; labs.push(rgb2lab([data[j], data[j + 1], data[j + 2]]));
  }
  if (labs.length < 30) return null;
  labs.sort((p, q) => p[0] - q[0]);
  const kept = labs.slice(Math.floor(labs.length * 0.2), Math.ceil(labs.length * 0.8));
  const lab = [0, 1, 2].map((i) => kept.reduce((s, v) => s + v[i], 0) / kept.length);
  return { lab, n: labs.length };
}
export function rgb2lab([r, g, b]) {
  const f = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  X = t(X); Y = t(Y); Z = t(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
