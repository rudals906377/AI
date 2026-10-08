// 공유용 카드 이미지 (1080 × 1920, 인스타 스토리 비율) — 스타일 분석 결과 · 내 얼굴 분석 결과
// 브라우저 캔버스로만 그리고 서버로 보내지 않는다. 얼굴 카드에는 얼굴 사진을 넣지 않는다(얼굴형 그림으로 대신).
//
//   const blob = await styleCard({ photo, result, fit });   // photo: Blob · fit: styleFit 결과(없으면 null)
//   const blob = await faceCard({ report, ranked });         // ranked: rankStyles().ranked (url 포함)
//   await shareImage(blob, '파일이름.png', '제목');           // 휴대폰은 공유 창, PC 는 내려받기

const W = 1080, H = 1920, PAD = 72;
const C = { bg: '#f4efe8', bg2: '#ece4d9', card: '#fbf8f3', text: '#2e2622', muted: '#74665a', line: '#e5dccf', accent: '#8f6654', mocha: '#a47864', ok: '#6f8f6a', soft: '#efe4da' };
const FONT = '"Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const SITE = 'kyoungminoh-beauty-style-ai.static.hf.space';

function canvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bg); g.addColorStop(1, C.bg2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return [c, ctx];
}
const font = (ctx, size, weight = 500) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
// 글자 단위 줄바꿈 (한국어는 띄어쓰기 단위로 먼저, 넘치면 글자 단위) · 최대 줄 수를 넘으면 … 으로 줄인다
function wrap(ctx, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text).split(/(\s+)/);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur + w;
    if (ctx.measureText(t).width <= maxW || !cur.trim()) { cur = t; continue; }
    lines.push(cur.trimEnd()); cur = w.trimStart();
  }
  if (cur.trim()) lines.push(cur.trim());
  const out = [];
  for (let l of lines) { while (ctx.measureText(l).width > maxW) { let k = l.length - 1; while (k > 1 && ctx.measureText(l.slice(0, k)).width > maxW) k--; out.push(l.slice(0, k)); l = l.slice(k); } out.push(l); }
  const shown = out.slice(0, maxLines);
  if (out.length > maxLines) { let l = shown[maxLines - 1]; while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); shown[maxLines - 1] = l + '…'; }
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + shown.length * lh;
}
async function loadImg(src) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  const img = new Image(); img.src = url;
  await img.decode();
  return img;
}
// 사진을 상자에 꽉 채워(cover) 둥근 모서리로
function cover(ctx, img, x, y, w, h, r) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / s, sh = h / s;
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip();
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, Math.max(0, (img.naturalHeight - sh) * 0.35), sw, sh, x, y, w, h);
  ctx.restore();
}
function chip(ctx, text, x, y, { bg = C.soft, fg = C.accent, size = 34, padX = 22, h = 62 } = {}) {
  font(ctx, size, 700);
  const w = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = bg; rr(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + padX, y + h / 2 + 1); ctx.textBaseline = 'alphabetic';
  return w;
}
function chips(ctx, list, x, y, maxW, opt) {
  let cx = x, cy = y;
  for (const t of list) {
    font(ctx, opt?.size || 34, 700);
    const w = ctx.measureText(t).width + 44;
    if (cx + w > x + maxW && cx > x) { cx = x; cy += 76; }
    cx += chip(ctx, t, cx, cy, opt) + 14;
  }
  return cy + 62;
}
function scoreBar(ctx, x, y, w, score) {
  ctx.fillStyle = C.line; rr(ctx, x, y, w, 18, 9); ctx.fill();
  ctx.fillStyle = C.accent; rr(ctx, x, y, Math.max(18, (w * score) / 100), 18, 9); ctx.fill();
}
function footer(ctx) {
  ctx.fillStyle = C.muted; font(ctx, 30, 600); ctx.textAlign = 'center';
  ctx.fillText('뷰티 스타일 AI 분석', W / 2, H - 112);
  font(ctx, 26, 500); ctx.fillText(`${SITE} · AI 분석 결과라 참고용이에요`, W / 2, H - 68);
  ctx.textAlign = 'left';
}
const done = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
async function fontsReady() { try { await document.fonts?.ready; } catch {} }

const CAT = { hair: '헤어', nail: '네일', makeup: '메이크업', tattoo: '타투' };

// 줄 수만 세는 wrap (그리지 않음)
function countLines(ctx, text, maxW, maxLines) {
  const off = document.createElement('canvas').getContext('2d'); off.font = ctx.font;
  let n = 0; const fake = { measureText: (t) => off.measureText(t), fillText: () => { n++; } };
  wrap(fake, text, 0, 0, maxW, 0, maxLines);
  return n;
}
function chipRows(ctx, list, maxW, size = 34) {
  let cx = 0, rows = list.length ? 1 : 0;
  for (const t of list) { font(ctx, size, 700); const w = ctx.measureText(t).width + 44; if (cx + w > maxW && cx > 0) { rows++; cx = 0; } cx += w + 14; }
  return rows;
}
function quipBox(ctx, text, y, maxLines) {
  font(ctx, 36, 500);
  const n = countLines(ctx, text, W - PAD * 2 - 72, maxLines), h = 100 + n * 50 + 22;
  ctx.fillStyle = C.card; rr(ctx, PAD, y, W - PAD * 2, h, 28); ctx.fill();
  ctx.fillStyle = C.accent; font(ctx, 30, 800); ctx.fillText('에디터 한마디', PAD + 36, y + 58);
  ctx.fillStyle = C.text; font(ctx, 36, 500);
  wrap(ctx, text, PAD + 36, y + 112, W - PAD * 2 - 72, 50, maxLines);
  return y + h;
}
const BOTTOM = H - 170; // 아래 출처 줄 위까지

export async function styleCard({ photo, result: r, fit = null }) {
  await fontsReady();
  const [c, ctx] = canvas();
  const img = await loadImg(photo);
  const title = r.genre?.name || r.headline;
  const tags = [...new Set([...(r.trends || []).map((t) => '#' + t.name.replace(/[\s·()]/g, '')), ...r.attributes.filter((a) => a.score >= 0.5 && a.label !== title).map((a) => a.label)])].slice(0, 5);
  // 글 부분의 높이를 먼저 재고, 남는 높이를 사진에 준다
  font(ctx, 76, 800); const tl = countLines(ctx, title, W - PAD * 2, 2);
  font(ctx, 36, 500); const ql = r.quip ? countLines(ctx, r.quip, W - PAD * 2 - 72, 3) : 0;
  const rows = chipRows(ctx, tags, W - PAD * 2);
  const textH = 60 + 34 + 30 + tl * 90 + (rows ? 20 + rows * 76 : 0) + (r.quip ? 30 + 122 + ql * 50 : 0) + (fit?.score != null ? 30 + 176 : 0);
  const ph = Math.max(520, Math.min(1000, BOTTOM - PAD - textH));
  cover(ctx, img, PAD, PAD, W - PAD * 2, ph, 40);
  let y = PAD + ph + 60 + 34;
  ctx.fillStyle = C.muted; font(ctx, 34, 600);
  ctx.fillText(`${CAT[r.category] || ''} 스타일 분석`, PAD, y);
  y += 30 + 76; ctx.fillStyle = C.text; font(ctx, 76, 800);
  y = wrap(ctx, title, PAD, y, W - PAD * 2, 90, 2) - 90 + 14;
  if (rows) y = chips(ctx, tags, PAD, y + 20, W - PAD * 2);
  if (r.quip) y = quipBox(ctx, r.quip, y + 30, 3);
  if (fit?.score != null) {
    const fy = y + 30;
    ctx.fillStyle = C.card; rr(ctx, PAD, fy, W - PAD * 2, 176, 28); ctx.fill();
    ctx.fillStyle = C.muted; font(ctx, 30, 600); ctx.fillText(`내 얼굴형과의 궁합 · ${fit.title.split(' × ')[1] || ''}`, PAD + 36, fy + 54);
    ctx.fillStyle = C.text; font(ctx, 42, 800); ctx.fillText(fit.verdict, PAD + 36, fy + 110);
    ctx.fillStyle = C.accent; font(ctx, 44, 800); ctx.textAlign = 'right'; ctx.fillText(`${fit.score}점`, W - PAD - 36, fy + 110); ctx.textAlign = 'left';
    scoreBar(ctx, PAD + 36, fy + 134, W - PAD * 2 - 72, fit.score);
  }
  footer(ctx);
  return done(c);
}

// 얼굴형을 단순한 윤곽으로 (사진 대신)
const OUTLINE = { oval: [0.74, 0.62, 0.5], round: [0.86, 0.82, 0.62], long: [0.66, 0.6, 0.46], square: [0.82, 0.84, 0.66], heart: [0.84, 0.62, 0.34], diamond: [0.7, 0.66, 0.42] };
function faceOutline(ctx, key, cx, cy, h) {
  const [fw, jw, cw] = OUTLINE[key] || OUTLINE.oval, w = h * 0.72;
  const top = cy - h / 2, bot = cy + h / 2;
  const P = (u, v) => [cx + u * w / 2, top + v * h];
  ctx.beginPath();
  ctx.moveTo(...P(0, 0));
  ctx.bezierCurveTo(...P(fw * 0.9, 0), ...P(fw, 0.12), ...P(fw, 0.3));
  ctx.bezierCurveTo(...P(1, 0.45), ...P(jw, 0.62), ...P(jw * 0.95, 0.72));
  ctx.bezierCurveTo(...P(jw * 0.85, 0.86), ...P(cw * 0.7, 0.98), ...P(0, 1));
  ctx.bezierCurveTo(...P(-cw * 0.7, 0.98), ...P(-jw * 0.85, 0.86), ...P(-jw * 0.95, 0.72));
  ctx.bezierCurveTo(...P(-jw, 0.62), ...P(-1, 0.45), ...P(-fw, 0.3));
  ctx.bezierCurveTo(...P(-fw, 0.12), ...P(-fw * 0.9, 0), ...P(0, 0));
  ctx.closePath();
  ctx.fillStyle = C.card; ctx.fill();
  ctx.lineWidth = 8; ctx.strokeStyle = C.mocha; ctx.setLineDash([]); ctx.stroke();
  // 눈 · 코 · 입 (아주 단순하게)
  ctx.lineWidth = 6; ctx.strokeStyle = C.line; ctx.lineCap = 'round';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(...P(s * 0.22, 0.44)); ctx.lineTo(...P(s * 0.42, 0.44)); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(...P(0, 0.5)); ctx.lineTo(...P(0.04, 0.62)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(...P(-0.14, 0.76)); ctx.quadraticCurveTo(...P(0, 0.8), ...P(0.14, 0.76)); ctx.stroke();
}

export async function faceCard({ report, ranked = [] }) {
  await fontsReady();
  const [c, ctx] = canvas();
  const key = report.shape.key;
  faceOutline(ctx, key, W / 2, 290, 400);
  let y = 580;
  ctx.textAlign = 'center';
  ctx.fillStyle = C.muted; font(ctx, 34, 600); ctx.fillText('내 얼굴형 분석', W / 2, y);
  ctx.fillStyle = C.text; font(ctx, 72, 800);
  y = wrap(ctx, report.headline, W / 2, y + 90, W - PAD * 2, 86, 2);
  ctx.textAlign = 'left';
  // 얼굴형 확률 막대 (상위 3개)
  const probs = (report.probs || []).slice(0, 3);
  y += 20;
  for (const p of probs) {
    ctx.fillStyle = C.text; font(ctx, 32, 600); ctx.fillText(p.label.replace(/\(.*\)/, ''), PAD, y + 28);
    ctx.fillStyle = C.line; rr(ctx, PAD + 230, y + 8, W - PAD * 2 - 340, 24, 12); ctx.fill();
    ctx.fillStyle = C.accent; rr(ctx, PAD + 230, y + 8, Math.max(24, (W - PAD * 2 - 340) * p.p), 24, 12); ctx.fill();
    ctx.fillStyle = C.muted; font(ctx, 30, 700); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(p.p * 100)}%`, W - PAD, y + 30); ctx.textAlign = 'left';
    y += 58;
  }
  if (report.quip) y = quipBox(ctx, report.quip, y + 24, 2);
  // 베스트 스타일 순위 (있으면) — 없으면 추천 커트
  y += 60;
  if (ranked.length) {
    ctx.fillStyle = C.text; font(ctx, 40, 800); ctx.fillText('내 얼굴에 맞는 베스트 스타일', PAD, y);
    y += 30;
    const n = Math.min(3, ranked.length), gap = 24, bw = (W - PAD * 2 - gap * 2) / 3;
    const bh = Math.min(bw * 1.2, BOTTOM - y - 150);
    const medal = ['1위', '2위', '3위'];
    for (let i = 0; i < n; i++) {
      const r = ranked[i], x = PAD + i * (bw + gap);
      try { cover(ctx, await loadImg(r.url), x, y, bw, bh, 24); } catch {}
      chip(ctx, medal[i], x + 14, y + 14, { bg: i ? 'rgba(46,38,34,.72)' : C.accent, fg: '#fff', size: 28, h: 52, padX: 18 });
      ctx.fillStyle = C.text; font(ctx, 30, 700);
      const ny = wrap(ctx, r.name, x, y + bh + 46, bw, 38, 2);
      ctx.fillStyle = C.accent; font(ctx, 30, 800); ctx.fillText(`궁합 ${r.score}점`, x, ny + 6);
    }
  } else {
    const cuts = (report.hair || []).filter((s) => s.key === 'cuts' || s.key === 'short').flatMap((s) => s.list.map((i) => i.name)).slice(0, 5);
    if (cuts.length) {
      ctx.fillStyle = C.text; font(ctx, 40, 800); ctx.fillText('잘 어울리는 커트', PAD, y);
      chips(ctx, cuts, PAD, y + 34, W - PAD * 2);
    }
  }
  footer(ctx);
  return done(c);
}

export async function coupleCard({ chem }) {
  await fontsReady();
  const [c, ctx] = canvas();
  faceOutline(ctx, chem.keys[0], W / 2 - 220, 360, 380);
  faceOutline(ctx, chem.keys[1], W / 2 + 220, 360, 380);
  ctx.fillStyle = C.accent; font(ctx, 90, 800); ctx.textAlign = 'center'; ctx.fillText('×', W / 2, 390);
  ctx.fillStyle = C.text; font(ctx, 38, 700);
  ctx.fillText(chem.shapes[0], W / 2 - 220, 620); ctx.fillText(chem.shapes[1], W / 2 + 220, 620);
  ctx.fillStyle = C.muted; font(ctx, 34, 600); ctx.fillText('우리 얼굴형 케미', W / 2, 740);
  ctx.fillStyle = C.text; font(ctx, 84, 800); ctx.fillText(chem.title, W / 2, 850);
  ctx.fillStyle = C.accent; font(ctx, 120, 800); ctx.fillText(`${chem.score}점`, W / 2, 1000);
  ctx.textAlign = 'left';
  let y = 1070;
  const boxH = 150 + (chem.both.length ? 150 : 0) + (chem.tone ? 170 : 0);
  ctx.fillStyle = C.card; rr(ctx, PAD, y, W - PAD * 2, boxH, 28); ctx.fill();
  ctx.fillStyle = C.text; font(ctx, 36, 500);
  y = wrap(ctx, chem.line, PAD + 36, y + 70, W - PAD * 2 - 72, 50, 3) + 20;
  if (chem.both.length) { ctx.fillStyle = C.accent; font(ctx, 30, 800); ctx.fillText('둘 다 잘 어울리는 커트', PAD + 36, y); y = chips(ctx, chem.both, PAD + 36, y + 20, W - PAD * 2 - 72, { size: 30, h: 56 }) + 30; }
  if (chem.tone) { ctx.fillStyle = C.accent; font(ctx, 30, 800); ctx.fillText('커플 컬러', PAD + 36, y + 10); ctx.fillStyle = C.text; font(ctx, 32, 500); wrap(ctx, chem.tone, PAD + 36, y + 60, W - PAD * 2 - 72, 46, 2); }
  ctx.fillStyle = C.muted; font(ctx, 26, 500); ctx.textAlign = 'center'; ctx.fillText('재미로 보는 케미 점수예요', W / 2, 1690); ctx.textAlign = 'left';
  footer(ctx);
  return done(c);
}

export async function shareImage(blob, name, title) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
