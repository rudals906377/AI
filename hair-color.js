// 헤어 컬러 가상 착용 — 부위 분할 마스크의 머리카락 픽셀에 목표 색을 입힌다 (밝기 결은 원본 그대로, 색상만 바꿈)
//
//   recolorHair(ctx, srcCanvas, mask, '#6b4a3a', { strength: 0.85, crop });   // crop: {x, y, w, h, scale} (face-ui prep 와 같은 좌표)
//
// 원리: 머리카락 픽셀의 밝기(Y)를 유지하고, 목표 색의 색상 · 채도를 입힌다. 밝은 색(블론드 · 애쉬)은 밝기를 끌어올리고 어두운 색은 내린다.
// 마스크 경계는 3×3 평균으로 부드럽게. 브라우저 캔버스로만 처리하고 사진은 보내지 않는다.
export const HAIR_COLORS = [
  ['흑발', '#1a1614', 0], ['다크브라운', '#3a2a22', 0], ['초코브라운', '#4e3528', 0.03], ['애쉬브라운', '#5a4d45', 0.08], ['밀크브라운', '#7a5a46', 0.12],
  ['카라멜브라운', '#8a5a3a', 0.14], ['애쉬베이지', '#9a8872', 0.22], ['애쉬그레이', '#8d8a88', 0.26], ['애쉬블론드', '#b9a98f', 0.32], ['골드블론드', '#c99a5a', 0.3],
  ['레드브라운', '#7a3a2e', 0.06], ['와인', '#5a2432', 0.02], ['핑크', '#c77a93', 0.2], ['라벤더', '#9a86b8', 0.2], ['블루블랙', '#1b2030', -0.02],
].map(([name, hex, lift]) => ({ name, hex, lift }));

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function recolorHair(ctx, src, mask, hex, { strength = 0.85, lift = 0, crop = null, segHair = 1 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const [tr, tg, tb] = hex2rgb(hex);
  const tY = 0.299 * tr + 0.587 * tg + 0.114 * tb;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  // 화면 캔버스 좌표 → 원본 사진 좌표 → 마스크 좌표
  const c = crop || { x: 0, y: 0, w: src.width, h: src.height, scale: W / src.width };
  const mx = mask.w / src.width, my = mask.h / src.height;
  const isHair = (x, y) => {
    const sx = c.x + x / c.scale, sy = c.y + y / c.scale;
    const ix = Math.floor(sx * mx), iy = Math.floor(sy * my);
    return ix >= 0 && iy >= 0 && ix < mask.w && iy < mask.h && mask.data[iy * mask.w + ix] === segHair ? 1 : 0;
  };
  // 경계 부드럽게: 3×3 평균 (한 번만 계산)
  const soft = new Float32Array(W * H);
  const raw = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[y * W + x] = isHair(x, y);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += raw[yy * W + xx]; n++; } }
    soft[y * W + x] = s / n;
  }
  for (let i = 0; i < W * H; i++) {
    const a = soft[i] * strength; if (a <= 0) continue;
    const j = i * 4, r = d[j], g = d[j + 1], b = d[j + 2];
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    // 밝기 보정: 원본 머리카락이 어두우면(검정) 밝은 색은 lift 로 끌어올리고, 결(하이라이트)은 유지
    const yN = Math.min(1, Y / 255 + lift);
    const k = yN / Math.max(0.2, tY / 255);   // 목표 색을 원본 밝기 결에 맞춰 늘리기
    const nr = Math.min(255, tr * k), ng = Math.min(255, tg * k), nb = Math.min(255, tb * k);
    d[j] = r + (nr - r) * a; d[j + 1] = g + (ng - g) * a; d[j + 2] = b + (nb - b) * a;
  }
  ctx.putImageData(img, 0, 0);
}
