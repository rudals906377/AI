// 스타일 분석 결과 이미지 — 사진 · 한 줄 판정 · 장르 · 설명 · 트렌드 · 속성별 판단 · 어울리는 분 · 내 얼굴형과의 궁합 · 시술 요청서 요약을 세로로 긴 PNG 한 장으로
//
//   const blob = await resultImage({ photo, result, fit, order, catLabel });   // photo: Blob · fit: styleFit 결과(없으면 null) · order: buildOrder 결과(없으면 null)
//
// 공유 이미지(share-card.js)가 SNS 용 요약이라면, 이건 화면에 보이는 분석 결과를 그대로 옮긴 '결과지'다. 헤어 · 네일 · 메이크업 · 타투 공통.
const FONT = '"Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const C = { bg: '#fbf8f3', card: '#ffffff', text: '#2e2622', muted: '#74665a', accent: '#8f6654', accentInk: '#6f4b3b', line: '#e5dccf', soft: '#f3ebe2', bar: '#eadfd3', ok: '#6f8f6a' };

export async function resultImage({ photo, result: r, fit = null, order = null, catLabel = '스타일' }) {
  try { await document.fonts?.ready; } catch {}
  const W = 1080, P = 64, INNER = W - P * 2, GAP = 16;
  const bmp = photo ? await createImageBitmap(photo) : null;
  const s = bmp ? Math.min(INNER / bmp.width, 760 / bmp.height) : 0;
  const iw = bmp ? Math.round(bmp.width * s) : 0, ih = bmp ? Math.round(bmp.height * s) : 0;
  const date = new Date().toLocaleDateString('ko-KR');
  const pct = (x) => `${Math.round(x * 100)}%`;
  function wrap(ctx, str, max) {
    const out = []; let line = '';
    for (const ch of String(str ?? '')) { if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ch.trimStart(); } else line += ch; }
    if (line) out.push(line);
    return out;
  }
  function draw(ctx, paint) {
    let y = P;
    const text = (t, size, weight, color, x, maxW, lh = 1.45, yy = null, maxLines = 99) => {
      ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'top';
      const lines = wrap(ctx, t, maxW).slice(0, maxLines), base = yy ?? y;
      lines.forEach((l, i) => paint && ctx.fillText(l, x, base + i * size * lh));
      return lines.length * size * lh;
    };
    const rect = (x, yy, w, h, rad, fill, stroke, lw = 2) => { if (!paint) return; ctx.beginPath(); ctx.roundRect(x, yy, w, h, rad); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
    const headline = (t) => { y += 18; y += text(t, 27, 700, C.text, P, INNER) + 10; };
    const chips = (items, x0, maxW, { size = 20, bg = C.soft, fg = C.accentInk } = {}) => {
      ctx.font = `600 ${size}px ${FONT}`;
      let x = x0, row = 0; const h = size + 16;
      for (const it of items) {
        const w = ctx.measureText(it).width + 24;
        if (x + w > x0 + maxW && x > x0) { x = x0; row++; }
        rect(x, y + row * (h + 8), w, h, h / 2, bg, null);
        if (paint) { ctx.fillStyle = fg; ctx.textBaseline = 'top'; ctx.fillText(it, x + 12, y + row * (h + 8) + 8); }
        x += w + 8;
      }
      y += (row + 1) * (h + 8) + 2;
    };
    // 머리
    y += text(`${catLabel} 분석 결과`, 46, 700, C.text, P, INNER) + 4;
    y += text(`FINDE · ${date} · 사진 1장 AI 분석`, 24, 400, C.muted, P, INNER) + 26;
    if (bmp) {
      if (paint) { ctx.save(); ctx.beginPath(); ctx.roundRect(P + (INNER - iw) / 2, y, iw, ih, 16); ctx.clip(); ctx.drawImage(bmp, P + (INNER - iw) / 2, y, iw, ih); ctx.restore(); }
      y += ih + 28;
    }
    // 한 줄 판정 · 장르
    y += text(r.headline || '', 34, 700, C.text, P, INNER, 1.35) + 10;
    const g = r.genre;
    if (g?.name) {
      const top = y;
      rect(P, top, INNER, 0, 16, null, null);
      const body = (on) => {
        let yy = top + 20;
        const t = (str, sz, w, col, gap, maxLines = 99) => { ctx.font = `${w} ${sz}px ${FONT}`; ctx.fillStyle = col; ctx.textBaseline = 'top'; const ls = wrap(ctx, str, INNER - 48).slice(0, maxLines); if (on && paint) ls.forEach((l, i) => ctx.fillText(l, P + 24, yy + i * sz * 1.4)); yy += ls.length * sz * 1.4 + gap; };
        t(`${catLabel} 장르 · ${g.group || ''} ${g.score != null ? pct(g.score) : ''}`.trim(), 20, 600, C.accentInk, 4);
        t(g.name, 38, 700, C.text, 6);
        const sub = [g.second ? `${g.second} 요소도 보임` : '', g.sub, g.info].filter(Boolean).join(' · ');
        if (sub) t(sub, 21, 400, C.muted, 4, 2);
        return yy - top + 20;
      };
      const h = body(false);
      rect(P, top, INNER, h, 16, C.card, C.line);
      body(true);
      y = top + h + 12;
    }
    if (r.trends?.length) chips(r.trends.map((t) => `#${t.name.replace(/[\s·()]/g, '')}`), P, INNER);
    // 설명
    const paras = r.paragraphs || (r.sentences ? [r.sentences] : []);
    if (paras.length) { y += 6; for (const p of paras) y += text(p.join(' '), 22, 400, C.text, P, INNER, 1.55, null, 5) + 10; }
    if (r.quip) { const top = y + 6; const h = text(`에디터 한마디 — ${r.quip}`, 21, 500, C.accentInk, P + 20, INNER - 40, 1.5, top + 14) + 28; rect(P, top, INNER, h, 14, C.soft, null); text(`에디터 한마디 — ${r.quip}`, 21, 500, C.accentInk, P + 20, INNER - 40, 1.5, top + 14); y = top + h + 6; }
    // 속성별 판단
    const attrs = (r.attributes || []).filter((a) => !a.all?.[0]?.hidden);
    if (attrs.length) {
      headline('속성별 판단');
      const colW = (INNER - GAP) / 2, rowH = 64;
      attrs.forEach((a, i) => {
        const x = P + (i % 2) * (colW + GAP), yy = y + Math.floor(i / 2) * rowH;
        text(a.group_label, 19, 500, C.muted, x, colW, 1.3, yy);
        const lab = `${a.label}${a.level === 'low' ? ' (후보)' : ''}`;
        text(lab, 23, 700, C.text, x, colW - 70, 1.3, yy + 24, 1);
        ctx.font = `700 19px ${FONT}`;
        if (paint) { ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(pct(a.score), x + colW, yy + 26); ctx.textAlign = 'left'; }
        rect(x, yy + 54, colW, 6, 3, C.bar, null); rect(x, yy + 54, Math.max(6, colW * a.score), 6, 3, a.level === 'low' ? '#cbb8ab' : C.accent, null);
      });
      y += Math.ceil(attrs.length / 2) * rowH + 6;
    }
    // 이런 분께
    if (r.suits?.length) {
      headline('이런 분께 잘 어울려요');
      for (const su of r.suits.slice(0, 4)) { const h1 = text(su.label, 22, 700, C.text, P, 220, 1.4); const h2 = text(su.text, 20, 400, C.muted, P + 236, INNER - 236, 1.45, null, 3); y += Math.max(h1, h2) + 10; }
      y += text('사진 속 스타일의 특징에 일반적인 스타일링 기준을 적용한 추천이에요.', 18, 400, C.muted, P, INNER) + 4;
    }
    // 내 얼굴형과의 궁합
    if (fit?.score != null) {
      const top = y + 18;
      const body = (on) => {
        let yy = top + 22;
        const t = (str, sz, w, col, gap, maxLines = 99) => { ctx.font = `${w} ${sz}px ${FONT}`; ctx.fillStyle = col; ctx.textBaseline = 'top'; const ls = wrap(ctx, str, INNER - 48).slice(0, maxLines); if (on && paint) ls.forEach((l, i) => ctx.fillText(l, P + 24, yy + i * sz * 1.45)); yy += ls.length * sz * 1.45 + gap; };
        t('내 얼굴형과의 궁합', 20, 600, C.accentInk, 4);
        t(`${fit.title} — 궁합 ${fit.score}점 · ${fit.verdict}`, 26, 700, C.text, 10, 2);
        for (const x of (fit.reasons || []).slice(0, 4)) t(`${x.pts > 0 ? '✓' : '△'} ${x.text}`, 20, 400, C.text, 4, 2);
        if (fit.tip) t(fit.tip, 19, 400, C.muted, 2, 2);
        return yy - top + 22;
      };
      const h = body(false); rect(P, top, INNER, h, 16, C.soft, null); body(true); y = top + h + 6;
    }
    // 시술 요청서 요약
    if (order?.rows?.length) {
      headline(`시술 요청서 요약 · ${order.to}에게`);
      for (const x of order.rows) {
        if (paint) { ctx.fillStyle = C.line; ctx.fillRect(P, y, INNER, 1); }
        y += 10;
        const top = y;
        text(x.label, 20, 500, C.muted, P, 150, 1.4, top);
        let v = x.value + (x.extra ? ` (${x.extra})` : '') + (x.alt ? ` / ${x.alt}일 수도 있음` : '');
        const h = text(v, 22, 600, C.text, P + 160, INNER - 160 - (x.swatch ? 40 : 0), 1.4, top, 2);
        if (x.swatch && paint) { ctx.fillStyle = x.swatch.hex; ctx.beginPath(); ctx.roundRect(P + INNER - 32, top, 28, 28, 7); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.stroke(); }
        y = top + Math.max(h, 30) + 8;
      }
      if (order.checks?.length) { y += 6; y += text(`상담 때 정할 것: ${order.checks.join(' / ')}`, 19, 400, C.muted, P, INNER, 1.45, null, 3) + 4; }
    }
    y += 22;
    if (paint) { ctx.fillStyle = C.line; ctx.fillRect(P, y, INNER, 2); }
    y += 20;
    y += text('사진 한 장을 AI 로 분석한 참고용 결과라 틀릴 수 있어요. 실제 시술은 상담 후 정해 주세요. 사진은 브라우저 밖으로 보내지 않았어요. (AI 생성 · FINDE)', 20, 400, C.muted, P, INNER);
    return y + P;
  }
  const probe = document.createElement('canvas').getContext('2d');
  const H = Math.ceil(draw(probe, false));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  draw(ctx, true);
  bmp?.close?.();
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}
