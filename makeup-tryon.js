// 가상 메이크업: 추천 립 · 블러셔 색을 내 셀카에 발라 본다 (참고용 — 조명 · 카메라에 따라 실제 발색은 다르다)
//
//   paintLips(ctx, outer, inner, hex, k)    // outer · inner: 캔버스 좌표 [[x, y], …] (입술 바깥선 · 안쪽선), k: 화면 배율
//   paintBlush(ctx, ellipses, hex)          // ellipses: [{ m: DOMMatrix }] — 단위 원을 볼 위 타원으로 옮기는 변환
//   shadesFor(seasonSub, gender)            // { lips: [...], blush: [...] } — 퍼스널 컬러에 맞는 색을 앞에, '추천' 표시
//
// 사진은 브라우저 밖으로 나가지 않는다. 원본 픽셀의 밝기 결(입술 주름 · 볼 질감)은 그대로 두고 색만 얹는다.

export const LIP_SHADES = [
  { key: 'coral', name: '코랄', hex: '#f2735b' },
  { key: 'peach', name: '피치', hex: '#f49a7e' },
  { key: 'apricotred', name: '애프리콧 레드', hex: '#e0523a' },
  { key: 'rosepink', name: '로즈 핑크', hex: '#e0708c' },
  { key: 'mauve', name: '모브', hex: '#b86b86' },
  { key: 'raspberry', name: '라즈베리', hex: '#c2305a' },
  { key: 'brick', name: '브릭', hex: '#a8442f' },
  { key: 'terracotta', name: '테라코타', hex: '#b85a3c' },
  { key: 'truered', name: '트루 레드', hex: '#c8102e' },
  { key: 'burgundy', name: '버건디', hex: '#7e1e34' },
  { key: 'mlbb', name: '누드 로즈', hex: '#c47a73' },
];
export const BLUSH_SHADES = [
  { key: 'peach', name: '피치', hex: '#f7a28a' },
  { key: 'coral', name: '코랄', hex: '#f48a78' },
  { key: 'babypink', name: '베이비 핑크', hex: '#f4a6b8' },
  { key: 'lavender', name: '라벤더 핑크', hex: '#e6a3c6' },
  { key: 'apricot', name: '애프리콧', hex: '#e8946a' },
  { key: 'rose', name: '로즈', hex: '#d9708a' },
  { key: 'berry', name: '베리', hex: '#c25478' },
];
// 퍼스널 컬러(계절)별 추천 — 앞에 올수록 더 잘 맞는 색
const PICK = {
  spring: { lips: ['coral', 'peach', 'apricotred'], blush: ['peach', 'coral'] },
  summer: { lips: ['rosepink', 'mauve', 'raspberry'], blush: ['babypink', 'lavender'] },
  autumn: { lips: ['brick', 'terracotta', 'apricotred'], blush: ['apricot', 'coral'] },
  winter: { lips: ['truered', 'burgundy', 'raspberry'], blush: ['rose', 'berry'] },
};
// 그루밍(남성 기준): 티 나지 않는 립밤 톤만
const GROOM_LIPS = [
  { key: 'balm', name: '투명 립밤', hex: '#d98c86' },
  { key: 'mlbb', name: '내 입술 톤', hex: '#c47a73' },
  { key: 'tint', name: '옅은 혈색', hex: '#d46a6a' },
];

export function shadesFor(seasonSub = null, gender = null) {
  if (gender === 'm') return { lips: GROOM_LIPS.map((s, i) => ({ ...s, rec: i === 0 })), blush: [] };
  const pick = PICK[(seasonSub || '').split('_')[0]] || { lips: ['mlbb', 'rosepink', 'coral'], blush: ['peach', 'babypink'] };
  const order = (list, keys) => [...keys.map((k) => list.find((s) => s.key === k)).filter(Boolean).map((s) => ({ ...s, rec: true })), ...list.filter((s) => !keys.includes(s.key)).map((s) => ({ ...s, rec: false }))];
  return { lips: order(LIP_SHADES, pick.lips), blush: order(BLUSH_SHADES, pick.blush) };
}

const work = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const poly = (ctx, pts) => { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

// 입술: 바깥선 안쪽에서 안쪽선(벌린 입 · 치아)을 뺀 자리에 색. 'color' 로 색만 바꾸고 'multiply' 로 깊이를 조금 더한다
export function paintLips(ctx, outer, inner, hex, k = 1, { strength = 1 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const [mc, m] = work(W, H);
  m.filter = `blur(${Math.max(1, 1.4 * k)}px)`;
  m.fillStyle = '#000'; m.beginPath(); poly(m, outer); if (inner?.length > 2) poly(m, inner); m.fill('evenodd');
  const [cc, c] = work(W, H);
  c.fillStyle = hex; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'destination-in'; c.drawImage(mc, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = 0.62 * strength; ctx.drawImage(cc, 0, 0);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.28 * strength; ctx.drawImage(cc, 0, 0);
  ctx.restore();
}

// 블러셔: 볼 위 둥근 자리에 가장자리가 흐려지는 색. 따로 그린 뒤 흐리게 해서 'multiply' 로 얹는다 (경계가 보이지 않게)
export function paintBlush(ctx, ellipses, hex, { strength = 1, k = 1 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [bc, bx] = work(W, H);
  for (const { m } of ellipses) {
    bx.save();
    // '메이크업 위치'의 블러셔 자리는 가로로 긴 띠라, 칠할 때는 세로로 넓혀 둥글게
    bx.setTransform(m.scale(1, 1.7));
    const grad = bx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(${r},${g},${b},${0.34 * strength})`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},${0.2 * strength})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    bx.fillStyle = grad; bx.beginPath(); bx.arc(0, 0, 1, 0, Math.PI * 2); bx.fill();
    bx.restore();
  }
  ctx.save();
  ctx.filter = `blur(${Math.round(9 * k)}px)`;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(bc, 0, 0);
  ctx.restore();
}
