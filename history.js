// 내 기록 — 스타일 사진 분석 · 내 얼굴 분석 · 내 손톱 분석 결과를 이 기기(localStorage)에만 모아 보여 준다
//
//   initHistory({ onOpen })   // 'beauty:style' · 'beauty:face' · 'beauty:nail' 이벤트의 detail 을 받아 저장하고 #historyGrid 에 그린다
//
// 저장하는 것: 날짜 · 분야 · 한 줄 판정 · 요약 · 글로 옮긴 결과(결과 복사와 같은 내용) · 작은 썸네일(160px JPEG). 원본 사진은 저장하지 않는다.
// 최근 60개까지. 내보내기(JSON) · 하나 지우기 · 모두 지우기. 기억해 둔 얼굴형(beauty-face-memo-v1)도 함께 보여 준다.
const KEY = 'finde-history-v1', MEMO_KEY = 'beauty-face-memo-v1', MAX = 60;
const CAT = { hair: '헤어', nail: '네일아트', makeup: '메이크업', tattoo: '타투', face: '내 얼굴', nailshape: '내 손톱' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
// 저장 공간이 모자라면(브라우저 localStorage 는 보통 5MB) 오래된 기록의 480px 사진부터 비우고, 그래도 안 되면 오래된 기록을 지운다
const store = (list) => {
  let l = list.slice(-MAX);
  for (let tries = 0; tries < 80; tries++) {
    try { localStorage.setItem(KEY, JSON.stringify(l)); return true; } catch {}
    const k = l.findIndex((r) => r.img); if (k >= 0) l[k] = { ...l[k], img: null }; else if (l.length) l = l.slice(1); else return false;
  }
  return false;
};
const fmt = (t) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// src 를 긴 변 size 픽셀의 JPEG dataURL 로 (목록용 160px · 기록에서 이미지 다시 만들 때 쓰는 480px)
async function thumbOf(src, size = 160, q = 0.72) {
  try {
    let img = src;
    if (src instanceof Blob) { img = await createImageBitmap(src); }
    if (!img || !(img.width || img.naturalWidth)) return null;
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight, s = Math.min(1, size / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (img.close && src instanceof Blob) img.close();
    return c.toDataURL('image/jpeg', q);
  } catch { return null; }
}
export async function saveRecord({ kind, category, title, summary, lines = [], thumbSrc = null, extra = {} }) {
  const thumb = thumbSrc ? await thumbOf(thumbSrc) : null;
  const img = thumbSrc ? await thumbOf(thumbSrc, 480, 0.8) : null;   // 기록에서 '이미지로 저장'을 다시 눌렀을 때 쓸 사진 (원본은 저장하지 않는다)
  const rec = { id: Date.now() + Math.random().toString(36).slice(2, 6), t: Date.now(), kind, category, title, summary, lines, thumb, img, ...extra };
  const list = load().filter((x) => !(x.kind === rec.kind && x.title === rec.title && Date.now() - x.t < 15000)); // 같은 결과를 몇 초 안에 두 번 저장하지 않게
  store([...list, rec]);
  window.dispatchEvent(new CustomEvent('finde:history'));
  return rec;
}

export function initHistory({ onOpen = () => {} } = {}) {
  const grid = document.getElementById('historyGrid'); if (!grid) return;
  let filter = 'all', open = null;
  const memo = () => { try { return JSON.parse(localStorage.getItem(MEMO_KEY) || 'null'); } catch { return null; } };
  function render() {
    const list = load().slice().reverse();
    const counts = {}; for (const r of list) counts[r.category] = (counts[r.category] || 0) + 1;
    const shown = filter === 'all' ? list : list.filter((r) => r.category === filter);
    const m = memo();
    const memoHtml = m ? `<div class="hist-memo"><b>기억해 둔 내 얼굴형</b><span>${esc(m.shape?.probs?.[0]?.label || '')}${m.shape?.probs?.[0]?.p ? ` ${Math.round(m.shape.probs[0].p * 100)}%` : ''}${m.hist?.length ? ` · 분석 ${m.hist.length}번 합침` : ''}</span><small>사진 없이 측정값만 저장돼 있어요. 스타일만 분석해도 궁합이 바로 나와요.</small><button type="button" class="ghost small" data-act="memo-clear">지우기</button></div>`
      : `<div class="hist-memo muted"><b>기억해 둔 내 얼굴형</b><span>아직 없어요</span><small>내 얼굴 분석 결과 아래의 "이 기기에 내 얼굴형 기억하기"를 켜면 여기에 보여요.</small></div>`;
    const chips = ['all', 'hair', 'nail', 'makeup', 'tattoo', 'face', 'nailshape'].map((k) => `<button type="button" data-f="${k}" class="${filter === k ? 'active' : ''}">${k === 'all' ? '전체' : CAT[k]}${k === 'all' ? ` ${list.length}` : counts[k] ? ` ${counts[k]}` : ''}</button>`).join('');
    const items = shown.length ? shown.map((r) => `<article class="hist-item${open === r.id ? ' open' : ''}" data-id="${r.id}">
        <button type="button" class="hist-head" data-act="toggle">${r.thumb ? `<img src="${r.thumb}" alt="" />` : `<i class="hist-ph">${esc((CAT[r.category] || '')[0] || '·')}</i>`}
          <div><span class="hist-cat">${esc(CAT[r.category] || r.category)}</span><b>${esc(r.title)}</b><small>${esc(r.summary || '')}</small><time>${fmt(r.t)}</time></div></button>
        <div class="hist-body"><pre>${esc((r.lines || []).join('\n'))}</pre><div class="row"><button type="button" class="ghost small" data-act="copy">복사</button><button type="button" class="ghost small" data-act="img">이미지로 저장</button><button type="button" class="ghost small" data-act="del">이 기록 지우기</button></div></div>
      </article>`).join('') : `<p class="hist-empty">${filter === 'all' ? '아직 기록이 없어요. 사진을 분석하면 여기에 차곡차곡 쌓여요.' : `${CAT[filter]} 기록이 아직 없어요.`}</p>`;
    grid.innerHTML = `<section class="card hist-card"><h2>내 기록 <small>이 기기에만 저장 · 사진 원본은 저장하지 않아요</small></h2>
      ${memoHtml}
      <div class="seg hist-filter">${chips}</div>
      <div class="hist-list">${items}</div>
      <div class="row hist-actions"><button type="button" class="ghost small" data-act="export" ${list.length ? '' : 'disabled'}>JSON 내보내기</button><button type="button" class="ghost small" data-act="clear" ${list.length ? '' : 'disabled'}>모두 지우기</button></div>
      <p class="muted small">앱으로 옮길 때는 이 기록을 계정에 이어서 저장하고, 시술 뒤 "해 봤어요" 평가를 받아 추천을 더 정확하게 만들 계획이에요.</p></section>`;
  }
  grid.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; render(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, item = b.closest('.hist-item'), id = item?.dataset.id;
    if (act === 'toggle') { open = open === id ? null : id; render(); }
    else if (act === 'copy') { const r = load().find((x) => x.id === id); navigator.clipboard?.writeText([r.title, r.summary, '', ...(r.lines || [])].join('\n')).then(() => { b.textContent = '복사했어요'; }).catch(() => {}); }
    else if (act === 'img') {
      const r = load().find((x) => x.id === id); if (!r) return;
      b.disabled = true; const t0 = b.textContent; b.textContent = '만드는 중…';
      recordImage(r).then(async (blob) => {
        const name = `FINDE-기록-${(CAT[r.category] || r.category)}-${new Date(r.t).toISOString().slice(0, 10)}.png`;
        const file = new File([blob], name, { type: 'image/png' });
        if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: r.title }).catch(() => {}); return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        b.textContent = '저장했어요';
      }).catch((e) => { console.error(e); b.textContent = '만들지 못했어요'; }).finally(() => { b.disabled = false; setTimeout(() => { b.textContent = t0; }, 2000); });
    }
    else if (act === 'del') { store(load().filter((x) => x.id !== id)); render(); }
    else if (act === 'clear') { if (confirm('기록을 모두 지울까요?')) { store([]); render(); } }
    else if (act === 'memo-clear') { try { localStorage.removeItem(MEMO_KEY); } catch {} render(); }
    else if (act === 'export') {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), records: load().map(({ thumb, img, ...r }) => r) }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finde-history-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(a); a.click(); a.remove();
    }
  });
  // 결과가 나올 때마다 저장
  window.addEventListener('beauty:style', (e) => {
    const r = e.detail?.result; if (!r || !r.is_beauty) return;
    const attrs = (r.attributes || []).filter((a) => a.score >= 0.3).map((a) => a.label);
    saveRecord({ kind: 'style', category: r.category, title: r.genre?.name || r.headline || '스타일', summary: r.headline || attrs.slice(0, 4).join(' · '),
      lines: [`장르: ${r.genre?.name || '-'}`, `특징: ${attrs.join(' · ')}`, ...(r.description ? [r.description] : []), ...(r.trends?.length ? [`트렌드: ${r.trends.map((t) => t.name || t).join(' · ')}`] : []), ...(r.tattoo ? ['', ...r.tattoo.text.split('\n')] : [])], thumbSrc: e.detail.blob || null });
  });
  window.addEventListener('beauty:face', async (e) => {
    const { report, face, purpose, gender } = e.detail || {}; if (!report || !face?.ok) return;
    await new Promise((r) => setTimeout(r, 500));   // 측정선까지 그려진 뒤에 썸네일을 뜬다
    const secs = (purpose === 'hair' ? report.hair : report.makeup) || [];
    const lines = report.thirds ? [`${report.thirds.line} — ${report.thirds.note}`, ''] : [];
    for (const s of secs) { if (!s.title) continue; lines.push(`- ${s.title}${s.points?.length ? ` (가장 필요한 건 ${s.points.join(' · ')})` : ''}${s.text ? `: ${s.text}` : ''}`); for (const i of s.list || []) lines.push(`  · ${i.name}${i.fit != null ? ` ${i.fit}` : ''}${i.why ? ` — ${i.why}` : ''}`); }
    saveRecord({ kind: 'face', category: 'face', title: `${report.headline} · ${purpose === 'hair' ? '헤어' : gender === 'm' ? '그루밍' : '메이크업'}`, summary: (report.summary || []).join(' '), lines, thumbSrc: document.getElementById('faceCanvas'), extra: { purpose, gender: gender || null } });
  });
  window.addEventListener('beauty:nail', (e) => {
    const { result: r, report: rep } = e.detail || {}; if (!r || !rep) return;
    saveRecord({ kind: 'nail', category: 'nailshape', title: `${rep.card?.[0]?.replace(/^손톱: /, '') || '손톱형'}`, summary: `추천 쉐입: ${rep.top.map((x) => x.key).join(' · ')}`,
      lines: [...rep.card, '', ...rep.top.map((x, i) => `${i + 1}. ${x.key} ${x.score}점 — ${x.why[0]}`)], thumbSrc: document.getElementById('nailCanvas') });
  });
  window.addEventListener('finde:history', render);
  render();
  return { render };
}

// ---- 기록 → 이미지 (저장해 둔 480px 사진 + 제목 · 요약 · 글로 옮긴 결과) ----------------------------------------
// 원본 사진 · 측정값 전체를 저장하지 않으므로, 그때 화면의 결과 이미지와 똑같지는 않고 기록에 남긴 글을 결과지 모양으로 그린다
const FONT = '"Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const C = { bg: '#fbf8f3', card: '#ffffff', text: '#2e2622', muted: '#74665a', accent: '#8f6654', accentInk: '#6f4b3b', line: '#e5dccf', soft: '#f3ebe2' };
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
export async function recordImage(r) {
  try { await document.fonts?.ready; } catch {}
  const W = 1080, P = 64, INNER = W - P * 2;
  const img = r.img || r.thumb ? await loadImg(r.img || r.thumb).catch(() => null) : null;
  const maxW = r.img ? Math.min(INNER, 640) : 320;   // 480px 사진은 640 까지만 키우고, 160px 썸네일뿐이면 작게
  const s = img ? Math.min(maxW / img.width, 640 / img.height) : 0;
  const iw = img ? Math.round(img.width * s) : 0, ih = img ? Math.round(img.height * s) : 0;
  function wrap(ctx, str, max) {
    const out = []; let line = '';
    for (const ch of String(str ?? '')) { if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ch.trimStart(); } else line += ch; }
    if (line) out.push(line);
    return out;
  }
  function draw(ctx, paint) {
    let y = P;
    const text = (t, size, weight, color, x, maxW2, lh = 1.45, yy = null) => {
      ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'top';
      const lines = wrap(ctx, t, maxW2), base = yy ?? y;
      lines.forEach((l, i) => paint && ctx.fillText(l, x, base + i * size * lh));
      return lines.length * size * lh;
    };
    const rect = (x, yy, w, h, rad, fill, stroke) => { if (!paint) return; ctx.beginPath(); ctx.roundRect(x, yy, w, h, rad); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); } };
    y += text(`${CAT[r.category] || r.category} · 내 기록`, 24, 600, C.accentInk, P, INNER) + 6;
    y += text(r.title || '', 42, 700, C.text, P, INNER, 1.3) + 6;
    y += text(`FINDE · ${fmt(r.t)}`, 22, 400, C.muted, P, INNER) + 24;
    if (img) {
      if (paint) { ctx.save(); ctx.beginPath(); ctx.roundRect(P + (INNER - iw) / 2, y, iw, ih, 16); ctx.clip(); ctx.drawImage(img, P + (INNER - iw) / 2, y, iw, ih); ctx.restore(); }
      y += ih + 10;
      if (!r.img) y += text('(작은 썸네일만 남아 있어 사진이 흐릿해요)', 18, 400, C.muted, P, INNER) + 4;
      y += 18;
    }
    if (r.summary) { const top = y; const h = text(r.summary, 24, 500, C.text, P + 22, INNER - 44, 1.5, top + 16) + 32; rect(P, top, INNER, h, 14, C.soft, null); text(r.summary, 24, 500, C.text, P + 22, INNER - 44, 1.5, top + 16); y = top + h + 18; }
    // 글로 옮긴 결과: [제목] 은 머리글, '- ' 은 항목, '  · ' 은 하위 항목, 빈 줄은 간격
    let first = true;
    for (const raw of r.lines || []) {
      const line = String(raw ?? '');
      if (!line.trim()) { y += 10; continue; }
      if (/^\[.*\]$/.test(line.trim())) { y += first ? 0 : 14; y += text(line.trim().slice(1, -1), 26, 700, C.text, P, INNER) + 8; first = false; continue; }
      if (/^\s{2,}[·•]\s/.test(line)) { y += text(line.trim().replace(/^[·•]\s*/, '· '), 20, 400, C.muted, P + 36, INNER - 36, 1.5) + 4; continue; }
      if (/^-\s/.test(line)) { y += text(line.replace(/^-\s*/, '· '), 21, 500, C.text, P + 10, INNER - 10, 1.5) + 5; continue; }
      if (/^[^:\s][^:]{0,12}[^:\s]:\s/.test(line)) {   // '장르: 레이어드컷' 꼴 (비율 '상안부 : 중안부' 는 키가 공백으로 끝나므로 제외)
        const [k, ...rest] = line.split(': '); const top = y; const hk = text(k, 20, 500, C.muted, P, 150, 1.5, top); const hv = text(rest.join(': '), 21, 600, C.text, P + 160, INNER - 160, 1.5, top); y = top + Math.max(hk, hv) + 6; continue; }
      y += text(line, 21, 400, C.text, P, INNER, 1.5) + 5;
      first = false;
    }
    y += 22;
    if (paint) { ctx.fillStyle = C.line; ctx.fillRect(P, y, INNER, 2); }
    y += 20;
    y += text('이 기기의 내 기록에서 다시 만든 이미지예요. 사진 한 장을 AI 로 분석한 참고용 결과라 틀릴 수 있어요. (AI 생성 · FINDE)', 19, 400, C.muted, P, INNER);
    return y + P;
  }
  const probe = document.createElement('canvas').getContext('2d');
  const H = Math.ceil(draw(probe, false));
  const c = document.createElement('canvas'); c.width = W; c.height = Math.min(H, 16000);
  const ctx = c.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, c.height);
  draw(ctx, true);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}
