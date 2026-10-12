// 진단 결과지 PDF 한 장 (A4) — 브라우저 캔버스에 그린 뒤 JPEG 을 PDF 로 감싼다 (외부 라이브러리 · 서버 없음)
//
//   await reportPdf({ report, faceCanvas, spec, season, acc, cutEx, gender });   // 파일 내려받기 (휴대폰은 공유 창)
//
// 결과지 구성: 얼굴형 · 측정 요약 · 근거 → 추천 커트 TOP 3 + 앞머리 → 시술 지시서 · 피할 스타일 → 퍼스널 컬러 · 안경/귀걸이 → 안내문
const W = 1240, H = 1754, PAD = 56;   // A4 150dpi
const C = { bg: '#ffffff', ink: '#2e2622', muted: '#74665a', line: '#e5dccf', accent: '#8f6654', soft: '#f4efe8', card: '#fbf8f3', ok: '#6f8f6a' };
const FONT = '"Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const font = (ctx, size, weight = 500) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function wrap(ctx, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text || '').split(/(\s+)/); let line = '', n = 0;
  for (const w of words) {
    const t = line + w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line.trimEnd(), x, y); y += lh; line = w.trimStart(); if (++n >= maxLines - 1) { break; } } else line = t;
  }
  if (line) { let s = line.trimEnd(); while (ctx.measureText(s).width > maxW && s.length > 1) s = s.slice(0, -2) + '…'; ctx.fillText(s, x, y); y += lh; }
  return y;
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function cover(ctx, img, x, y, w, h, r) {
  const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip(); ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}
function head(ctx, text, x, y) { ctx.fillStyle = C.accent; font(ctx, 22, 800); ctx.fillText(text, x, y); ctx.fillStyle = C.line; ctx.fillRect(x, y + 10, 36, 3); return y + 36; }
function chipRow(ctx, items, x, y, maxW, { size = 17, h = 30, padX = 12, bg = C.soft, fg = C.ink } = {}) {
  let cx = x; font(ctx, size, 600);
  for (const t of items) {
    const w = ctx.measureText(t).width + padX * 2;
    if (cx + w > x + maxW) { cx = x; y += h + 8; }
    ctx.fillStyle = bg; rr(ctx, cx, y, w, h, h / 2); ctx.fill(); ctx.fillStyle = fg; ctx.fillText(t, cx + padX, y + h / 2 + size * 0.36); cx += w + 8;
  }
  return y + h + 10;
}

// format: 'pdf'(내려받기 · 공유) 또는 'png'(같은 결과지를 PNG Blob 으로 돌려준다 — 이미지로 저장 · 공유용)
export async function reportPdf({ report, faceCanvas, spec, season, acc, cutEx = null, gender = null, title = '얼굴형 진단 결과지', format = 'pdf' }) {
  try { await document.fonts?.ready; } catch {}
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
  // 머리띠
  ctx.fillStyle = C.soft; ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = C.ink; font(ctx, 30, 800); ctx.fillText(`FINDE 실험실 · ${title}`, PAD, 58);
  ctx.fillStyle = C.muted; font(ctx, 16, 500); ctx.textAlign = 'right';
  ctx.fillText(`${new Date().toLocaleDateString('ko-KR')} · 추천 기준 ${gender === 'f' ? '여성' : gender === 'm' ? '남성' : '선택 안 함'} · 사진 1장 측정`, W - PAD, 58); ctx.textAlign = 'left';
  // 1행: 사진 | 얼굴형 · 요약 · 근거
  let y = 124;
  const photoW = 400, photoH = 440;
  if (faceCanvas) cover(ctx, faceCanvas, PAD, y, photoW, photoH, 18);
  let rx = PAD + photoW + 36, ry = y, rw = W - PAD - rx;
  ry = head(ctx, '내 얼굴형', rx, ry + 20);
  ctx.fillStyle = C.ink; font(ctx, 34, 800); ry = wrap(ctx, report.headline, rx, ry + 26, rw, 40, 1);
  ctx.fillStyle = C.muted; font(ctx, 17, 500); ry = wrap(ctx, (report.summary || []).join(' '), rx, ry + 6, rw, 24, 3);
  if (report.thirds) { ctx.fillStyle = C.ink; font(ctx, 16, 700); ry = wrap(ctx, report.thirds.line, rx, ry + 8, rw, 22, 2); ctx.fillStyle = C.muted; font(ctx, 15, 500); ry = wrap(ctx, report.thirds.note, rx, ry + 2, rw, 20, 2); }
  const probs = (report.shape && report.probsAll) || [];
  ry += 6;
  for (const p of probs.slice(0, 4)) {
    ctx.fillStyle = C.ink; font(ctx, 16, 600); ctx.fillText(p.label.replace(/\(.*\)/, ''), rx, ry + 14);
    ctx.fillStyle = C.line; rr(ctx, rx + 150, ry, rw - 220, 14, 7); ctx.fill();
    ctx.fillStyle = C.accent; rr(ctx, rx + 150, ry, Math.max(14, (rw - 220) * p.p), 14, 7); ctx.fill();
    ctx.fillStyle = C.muted; font(ctx, 15, 700); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(p.p * 100)}%`, rx + rw, ry + 13); ctx.textAlign = 'left';
    ry += 26;
  }
  // 측정 요약 (평균과 다른 항목)
  const notable = (report.measures || []).filter((m) => Math.abs(m.z) >= 0.8 && m.note).slice(0, 5);
  if (notable.length) {
    ry = head(ctx, '측정 요약 (평균과 다른 점)', rx, ry + 22);
    for (const m of notable) { ctx.fillStyle = C.ink; font(ctx, 16, 700); ctx.fillText(m.label, rx, ry + 16); ctx.fillStyle = C.muted; font(ctx, 16, 500); ctx.fillText(`${m.value}  ·  ${m.note}`, rx + 190, ry + 16); ry += 26; }
  }
  const basis = (report.hair || []).find((s) => s.key === 'basis')?.basis || [];
  if (basis.length) { ry = head(ctx, '추천 근거 (필요한 효과)', rx, ry + 18); ry = chipRow(ctx, basis.map((b) => b.label), rx, ry, rw); }
  y = Math.max(y + photoH, ry) + 30;
  // 2행: 추천 커트 TOP 3 · 앞머리
  const secs = (report.hair || []).filter((s) => ['cuts', 'short'].includes(s.key) && s.list);
  const cuts = [...(secs[0]?.list || []).slice(0, 2), ...(secs[1]?.list || []).slice(0, 1)];   // 화면 순서대로: 첫 칸 1·2위 + 다음 칸 1위
  const bangs = ((report.hair || []).find((s) => s.key === 'bangs')?.list || []).slice(0, 2);
  y = head(ctx, '추천 커트 TOP 3', PAD, y);
  const cw = (W - PAD * 2 - 24) / 3, ch = 170;
  for (let i = 0; i < cuts.length; i++) {
    const it = cuts[i], x = PAD + i * (cw + 12);
    ctx.fillStyle = C.card; rr(ctx, x, y, cw, ch, 14); ctx.fill(); ctx.strokeStyle = i ? C.line : C.accent; ctx.lineWidth = i ? 1 : 2.5; rr(ctx, x, y, cw, ch, 14); ctx.stroke();
    const ex = cutEx?.[it.name]?.filter((e) => !gender || !e.g || e.g === gender)[0];
    let tx = x + 16;
    if (ex) { try { cover(ctx, await loadImg(ex.img), x + 14, y + 14, 110, 142, 10); tx = x + 140; } catch {} }
    ctx.fillStyle = C.accent; font(ctx, 15, 800); ctx.fillText(`${i + 1}위`, tx, y + 32);
    ctx.fillStyle = C.ink; font(ctx, 21, 800); ctx.fillText(it.name, tx + 40, y + 32);
    if (it.fit != null) { ctx.fillStyle = C.line; rr(ctx, tx, y + 44, cw - (tx - x) - 16, 8, 4); ctx.fill(); ctx.fillStyle = C.accent; rr(ctx, tx, y + 44, (cw - (tx - x) - 16) * it.fit / 100, 8, 4); ctx.fill(); }
    ctx.fillStyle = C.muted; font(ctx, 14, 500); wrap(ctx, it.why || '', tx, y + 76, cw - (tx - x) - 16, 20, 4);
  }
  y += ch + 18;
  if (bangs.length) { ctx.fillStyle = C.ink; font(ctx, 16, 700); ctx.fillText('추천 앞머리', PAD, y + 14); y = chipRow(ctx, bangs.map((b) => b.name), PAD + 110, y - 6, W - PAD * 2 - 110, { bg: C.soft }); }
  y += 14;
  // 3행: 시술 지시서 | 피할 스타일
  const colW = (W - PAD * 2 - 30) / 2;
  let ly = head(ctx, `미용실 시술 지시서 · ${spec?.title || ''}`, PAD, y);
  for (const r of spec?.rows || []) {
    ctx.fillStyle = C.ink; font(ctx, 15, 700); ctx.fillText(r.k, PAD, ly + 15);
    ctx.fillStyle = C.muted; font(ctx, 15, 500); ly = wrap(ctx, r.v, PAD + 100, ly + 15, colW - 100, 21, r.k === '이 얼굴 조정' ? 5 : 2) + 6;
  }
  const avoid = ((report.hair || []).find((s) => s.key === 'avoid')?.list || []).slice(0, 6);
  let ay = head(ctx, '피하면 좋은 스타일', PAD + colW + 30, y);
  ctx.fillStyle = C.muted; font(ctx, 15, 500);
  for (const a of avoid) ay = wrap(ctx, `· ${a.name}`, PAD + colW + 30, ay + 15, colW, 21, 2) + 2;
  y = Math.max(ly, ay) + 22;
  // 4행: 퍼스널 컬러 | 안경 · 귀걸이
  let sy = head(ctx, '퍼스널 컬러 (참고)', PAD, y);
  if (season) {
    ctx.fillStyle = C.ink; font(ctx, 20, 800); ctx.fillText(season.label, PAD, sy + 18);
    const lw = ctx.measureText(season.label).width;
    ctx.fillStyle = C.muted; font(ctx, 14, 500); ctx.fillText(`신뢰도 ${season.conf >= 0.65 ? '높음' : season.conf >= 0.45 ? '보통' : '낮음'} · 사진 조명에 따라 달라질 수 있어요`, PAD + lw + 16, sy + 18);
    sy += 34;
    season.palette.forEach((hx, i) => { ctx.fillStyle = hx; rr(ctx, PAD + i * 46, sy, 40, 40, 8); ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 1; rr(ctx, PAD + i * 46, sy, 40, 40, 8); ctx.stroke(); });
    ctx.fillStyle = C.muted; font(ctx, 13, 500); ctx.fillText('잘 맞는 색', PAD, sy + 58);
    season.avoid.forEach((hx, i) => { ctx.fillStyle = hx; rr(ctx, PAD + 400 + i * 46, sy, 40, 40, 8); ctx.fill(); ctx.strokeStyle = C.line; rr(ctx, PAD + 400 + i * 46, sy, 40, 40, 8); ctx.stroke(); });
    ctx.fillText('피할 색', PAD + 400, sy + 58); sy += 70;
  } else { ctx.fillStyle = C.muted; font(ctx, 15, 500); ctx.fillText('피부색을 재지 못해 생략', PAD, sy + 15); sy += 30; }
  let gy = head(ctx, '안경 · 귀걸이', PAD + colW + 30, y);
  if (acc) {
    ctx.fillStyle = C.ink; font(ctx, 15, 700); ctx.fillText('안경', PAD + colW + 30, gy + 15);
    gy = chipRow(ctx, acc.glasses.good.map((g) => g.name), PAD + colW + 90, gy - 6, colW - 60);
    ctx.fillStyle = C.ink; font(ctx, 15, 700); ctx.fillText('귀걸이', PAD + colW + 30, gy + 15);
    gy = chipRow(ctx, acc.earrings.good.map((g) => g.name), PAD + colW + 90, gy - 6, colW - 60);
    ctx.fillStyle = C.muted; font(ctx, 13, 500); gy = wrap(ctx, acc.glasses.tip, PAD + colW + 30, gy + 8, colW, 18, 3);
  }
  // 바닥 안내
  ctx.fillStyle = C.soft; ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = C.muted; font(ctx, 13, 500);
  wrap(ctx, '사진 한 장으로 잰 비율을 근거로 한 참고용 결과예요. 얼굴형에는 정답이 없고 카메라 거리 · 각도 · 표정에 따라 달라질 수 있어요. 의학적 진단이 아니며, 실제 시술은 디자이너와 상담해 정해 주세요. 사진은 브라우저 밖으로 보내지 않았어요. · FINDE 실험실', PAD, H - 42, W - PAD * 2, 18, 2);
  if (format === 'png') return await new Promise((r) => c.toBlob(r, 'image/png'));
  // JPEG → PDF
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const pdf = jpegPdf(jpeg, 595.28, 841.89, W, H);
  const name = `FINDE-결과지-${new Date().toISOString().slice(0, 10)}.pdf`;
  const file = new File([pdf], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { try { await navigator.share({ files: [file], title }); return; } catch {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// 최소 PDF: 페이지 하나에 JPEG 이미지(DCTDecode) 하나
function jpegPdf(jpeg, wPt, hPt, pw, ph) {
  const enc = new TextEncoder(), parts = [], off = []; let pos = 0;
  const push = (s) => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); pos += b.length; };
  const obj = (n, body) => { off[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`);
  const content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im1 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  off[5] = pos; push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); push(jpeg); push('\nendstream\nendobj\n');
  const xref = pos;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(off[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
