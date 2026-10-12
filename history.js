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
const store = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); return true; } catch { return false; } };
const fmt = (t) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

async function thumbOf(src) {
  try {
    let img = src;
    if (src instanceof Blob) { img = await createImageBitmap(src); }
    if (!img || !(img.width || img.naturalWidth)) return null;
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight, s = 160 / Math.max(w, h);
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close();
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}
export async function saveRecord({ kind, category, title, summary, lines = [], thumbSrc = null, extra = {} }) {
  const thumb = thumbSrc ? await thumbOf(thumbSrc) : null;
  const rec = { id: Date.now() + Math.random().toString(36).slice(2, 6), t: Date.now(), kind, category, title, summary, lines, thumb, ...extra };
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
        <div class="hist-body"><pre>${esc((r.lines || []).join('\n'))}</pre><div class="row"><button type="button" class="ghost small" data-act="copy">복사</button><button type="button" class="ghost small" data-act="del">이 기록 지우기</button></div></div>
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
    else if (act === 'del') { store(load().filter((x) => x.id !== id)); render(); }
    else if (act === 'clear') { if (confirm('기록을 모두 지울까요?')) { store([]); render(); } }
    else if (act === 'memo-clear') { try { localStorage.removeItem(MEMO_KEY); } catch {} render(); }
    else if (act === 'export') {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), records: load().map(({ thumb, ...r }) => r) }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finde-history-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(a); a.click(); a.remove();
    }
  });
  // 결과가 나올 때마다 저장
  window.addEventListener('beauty:style', (e) => {
    const r = e.detail?.result; if (!r || !r.is_beauty) return;
    const attrs = (r.attributes || []).filter((a) => a.score >= 0.3).map((a) => a.label);
    saveRecord({ kind: 'style', category: r.category, title: r.genre?.name || r.headline || '스타일', summary: r.headline || attrs.slice(0, 4).join(' · '),
      lines: [`장르: ${r.genre?.name || '-'}`, `특징: ${attrs.join(' · ')}`, ...(r.description ? [r.description] : []), ...(r.trends?.length ? [`트렌드: ${r.trends.map((t) => t.name || t).join(' · ')}`] : [])], thumbSrc: e.detail.blob || null });
  });
  window.addEventListener('beauty:face', async (e) => {
    const { report, face, purpose, gender } = e.detail || {}; if (!report || !face?.ok) return;
    await new Promise((r) => setTimeout(r, 500));   // 측정선까지 그려진 뒤에 썸네일을 뜬다
    const secs = (purpose === 'hair' ? report.hair : report.makeup) || [];
    const lines = [];
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
