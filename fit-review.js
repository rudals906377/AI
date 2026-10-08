// 얼굴형 · 추천 검수 — 디자이너가 AI 답을 보기 전에 얼굴형을 고르고(블라인드), AI 추천 커트에 동의하는지 표시한다.
// 결과: 얼굴형 일치율(1위 · 2위 안), 추천 커트 동의율, 귀 판단 일치율 + 고객 평가(fit-feedback) 분석
import { analyzeFace } from './face.js';
import { faceReport } from './face-advice.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(['status', 'statusText', 'statusBar', 'reviewer', 'add', 'addDir', 'files', 'dir', 'list', 'count', 'main', 'stats',
  'exportCsv', 'exportJson', 'clear', 'loadVotes', 'votes', 'voteStats'].map((k) => [k, $(k)]));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const SHAPES = [['oval', '계란형'], ['round', '둥근형'], ['long', '긴 얼굴형'], ['square', '각진형'], ['heart', '하트형'], ['diamond', '마름모형']];
const EARS = [['hidden', '가려서 안 보임'], ['normal', '두드러지지 않음'], ['slight', '약간 보임'], ['out', '옆으로 잘 보임']];
const STORE = 'beauty-fit-review-v1';

let state = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || { reviewer: '', items: [] }; } catch { return { reviewer: '', items: [] }; } })();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };
els.reviewer.value = state.reviewer;
els.reviewer.addEventListener('input', () => { state.reviewer = els.reviewer.value.trim(); save(); });
const photos = new Map(); // key → url (메모리에만)
let cur = 0;
const setStatus = (t, p = 0, cls = '') => { els.statusText.textContent = t; els.statusBar.style.width = `${p}%`; els.status.className = `status ${cls}`; };
const keyOf = (f) => `${f.name}|${f.size}|${f.lastModified}`;

// ---- 사진 추가 · 측정 ------------------------------------------------------------------
els.add.addEventListener('click', () => els.files.click());
els.addDir.addEventListener('click', () => els.dir.click());
els.files.addEventListener('change', () => { addFiles([...els.files.files]); els.files.value = ''; });
els.dir.addEventListener('change', () => { addFiles([...els.dir.files].filter((f) => f.type.startsWith('image/'))); els.dir.value = ''; });
const queue = [];
let working = false;
function addFiles(files) {
  for (const f of files) {
    const key = keyOf(f);
    if (!photos.has(key)) photos.set(key, URL.createObjectURL(f));
    if (!state.items.some((x) => x.key === key)) { state.items.push({ key, file: f.name, pending: true }); queue.push([key, f]); }
    else if (state.items.find((x) => x.key === key).pending) queue.push([key, f]);
  }
  save(); renderList(); run();
}
async function run() {
  if (working) return; working = true;
  try {
    while (queue.length) {
      const [key, f] = queue.shift();
      const it = state.items.find((x) => x.key === key); if (!it) continue;
      const done = state.items.filter((x) => !x.pending).length;
      setStatus(`얼굴을 재는 중 ${done + 1}/${state.items.length}`, ((done + 1) / state.items.length) * 100);
      try {
        const r = await analyzeFace(f, { purpose: 'hair' });
        if (!r.ok) { Object.assign(it, { pending: false, skipped: (r.issues || []).find((x) => x.level === 'block')?.title || '측정 실패' }); }
        else {
          const rep = faceReport(r, null, {});
          const cuts = rep.hair.filter((x) => x.key === 'cuts' || x.key === 'short').flatMap((x) => x.list.map((i) => i.name)).slice(0, 4);
          Object.assign(it, { pending: false, ai: { probs: r.shape.probs.slice(0, 3).map((p) => ({ key: p.key, p: Math.round(p.p * 1000) / 1000 })), ears: rep.traits.ears || null,
            cuts, m: { ratio: r.m.ratio, forehead: r.m.forehead, jaw: r.m.jaw, chin: r.m.chin, jawAngle: r.m.jawAngle } }, judge: { shape: null, ears: null, cuts: {} } });
        }
      } catch (e) { console.error(e); Object.assign(it, { pending: false, skipped: '분석 오류' }); }
      save(); renderList(); renderStats();
      if (state.items[cur] === it || !els.main.querySelector('.fr-q')) show(state.items.indexOf(it));
    }
  } finally { working = false; }
  setStatus(`측정 완료 · ${state.items.length}장 (재지 못한 사진 ${state.items.filter((x) => x.skipped).length}장)`, 100, 'ready');
}

// ---- 화면 ------------------------------------------------------------------------------
const isDone = (it) => it.skipped || (it.judge?.shape && it.ai.cuts.every((c) => it.judge.cuts[c] != null));
function renderList() {
  els.list.innerHTML = state.items.map((it, i) => `<button type="button" data-i="${i}" class="${i === cur ? 'cur' : ''} ${isDone(it) ? 'done' : ''}" title="${esc(it.file)}${it.skipped ? ` — ${esc(it.skipped)}` : ''}">${photos.has(it.key) ? `<img src="${photos.get(it.key)}" alt="" />` : '사진 없음'}</button>`).join('');
  const usable = state.items.filter((x) => !x.skipped && !x.pending);
  els.count.textContent = state.items.length ? `${usable.filter(isDone).length}/${usable.length} 완료` : '';
}
els.list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); });

function show(i) {
  if (!state.items.length) return;
  cur = Math.max(0, Math.min(state.items.length - 1, i));
  const it = state.items[cur];
  const photo = photos.has(it.key) ? `<img class="fr-photo" src="${photos.get(it.key)}" alt="${esc(it.file)}" />` : `<p class="note">이 사진(${esc(it.file)})을 다시 추가하면 화면에 보여요. 검수 기록은 남아 있어요.</p>`;
  const head = `<h2>검수 <small>${cur + 1}/${state.items.length} · ${esc(it.file)}</small></h2>${photo}`;
  if (it.pending) { els.main.innerHTML = `${head}<p class="note">얼굴을 재는 중…</p>`; renderList(); return; }
  if (it.skipped) { els.main.innerHTML = `${head}<p class="note">측정 기준을 통과하지 못해 검수에서 뺐어요: ${esc(it.skipped)}</p><div class="row"><button class="ghost small" id="next" type="button">다음</button></div>`; $('next').onclick = () => show(cur + 1); renderList(); return; }
  const j = it.judge, ai = it.ai;
  const opt = (name, list, val) => `<div class="fr-opts" data-q="${name}">${list.map(([k, l], n) => `<button type="button" data-k="${k}" class="${val === k ? 'on' : ''}">${name === 'shape' && n < 6 ? `${n + 1} ` : ''}${l}</button>`).join('')}</div>`;
  const name = (k) => SHAPES.find((x) => x[0] === k)?.[1] || '판단 어려움';
  let reveal = '';
  if (j.shape) {
    const agree1 = j.shape === ai.probs[0].key, agree2 = ai.probs.slice(0, 2).some((p) => p.key === j.shape);
    reveal = `<div class="fr-ai ${agree2 ? 'agree' : 'disagree'}">AI 판단: <b>${ai.probs.map((p) => `${name(p.key)} ${pct(p.p)}`).join(' · ')}</b><br>
      <b class="res">${j.shape === 'unsure' ? '판단 어려움으로 표시했어요 (일치율 계산에서 빼요)' : agree1 ? '1위가 일치해요' : agree2 ? 'AI 2위와 일치해요' : '일치하지 않아요'}</b>${ai.ears ? ` · AI 귀 판단: ${esc(EARS.find((e) => e[0] === ai.ears)?.[1] || ai.ears)}` : ''}</div>
      <div class="fr-q"><b>AI가 이 얼굴에 추천한 커트 — 디자이너로서 추천하시겠어요?</b>${ai.cuts.map((c) => `<div class="fr-cut"><span>${esc(c)}</span><span class="fr-opts" data-q="cut" data-c="${esc(c)}">${[['yes', '추천'], ['no', '비추천']].map(([k, l]) => `<button type="button" data-k="${k}" class="${j.cuts[c] === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="fr-q"><b>귀 (선택)</b>${opt('ears', EARS, j.ears)}</div>`;
  }
  els.main.innerHTML = `${head}<div class="fr-q"><b>디자이너가 보기에 이 얼굴형은? <small>(AI 답은 고른 뒤에 보여요)</small></b>${opt('shape', [...SHAPES, ['unsure', '0 판단 어려움']], j.shape)}</div>${reveal}
    <div class="row"><button class="ghost small" id="prev" type="button">이전</button><button class="ghost small" id="next" type="button">다음</button></div>`;
  $('prev').onclick = () => show(cur - 1); $('next').onclick = () => show(nextTodo());
  renderList();
}
const nextTodo = () => { const n = state.items.findIndex((x, i) => i > cur && !x.pending && !isDone(x)); return n >= 0 ? n : cur + 1; };
els.main.addEventListener('click', (e) => {
  const b = e.target.closest('.fr-opts button'); if (!b) return;
  const it = state.items[cur], box = b.closest('.fr-opts'), q = box.dataset.q, k = b.dataset.k;
  if (q === 'shape') it.judge.shape = k; else if (q === 'ears') it.judge.ears = it.judge.ears === k ? null : k; else if (q === 'cut') it.judge.cuts[box.dataset.c] = k;
  it.judge.ts = new Date().toISOString(); it.judge.reviewer = state.reviewer;
  save(); show(cur); renderStats();
});
document.addEventListener('keydown', (e) => {
  if (document.activeElement?.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;   // 이름 입력 · 브라우저 단축키(Ctrl+N 등)는 그대로
  const it = state.items[cur]; if (!it || it.pending || it.skipped) { if (e.key === 'ArrowRight') show(cur + 1); return; }
  if (/^[1-6]$/.test(e.key)) { it.judge.shape = SHAPES[+e.key - 1][0]; }
  else if (e.key === '0') it.judge.shape = 'unsure';
  // 한글 입력 상태(ㅛ · ㅜ)나 대문자에서도 동작하게 키 위치(e.code)로 본다
  else if ((e.code === 'KeyY' || e.code === 'KeyN') && it.judge.shape) { const c = it.ai.cuts.find((x) => it.judge.cuts[x] == null); if (c) it.judge.cuts[c] = e.code === 'KeyY' ? 'yes' : 'no'; }
  else if (e.key === 'ArrowRight') return show(isDone(it) ? nextTodo() : cur + 1);
  else if (e.key === 'ArrowLeft') return show(cur - 1);
  else return;
  save(); show(cur); renderStats();
});

// ---- 일치율 ----------------------------------------------------------------------------
function tally() {
  const xs = state.items.filter((x) => x.judge?.shape && x.judge.shape !== 'unsure');
  const top1 = xs.filter((x) => x.judge.shape === x.ai.probs[0].key).length;
  const top2 = xs.filter((x) => x.ai.probs.slice(0, 2).some((p) => p.key === x.judge.shape)).length;
  const cutVotes = state.items.flatMap((x) => Object.values(x.judge?.cuts || {}));
  const ears = state.items.filter((x) => x.judge?.ears && x.ai?.ears && x.judge.ears !== 'hidden' && x.ai.ears !== 'hidden');
  const conf = {}; for (const x of xs) { const k = `${x.judge.shape}|${x.ai.probs[0].key}`; conf[k] = (conf[k] || 0) + 1; }
  return { n: xs.length, top1, top2, cutN: cutVotes.length, cutYes: cutVotes.filter((v) => v === 'yes').length,
    earN: ears.length, earOk: ears.filter((x) => x.judge.ears === x.ai.ears || (x.judge.ears !== 'normal') === (x.ai.ears !== 'normal')).length, conf };
}
function renderStats() {
  const t = tally();
  if (!t.n && !t.cutN) { els.stats.innerHTML = '<p class="note">아직 검수한 얼굴이 없어요.</p>'; return; }
  const name = (k) => SHAPES.find((x) => x[0] === k)?.[1] || k;
  const rows = SHAPES.map(([k, l]) => `<tr><td>${l}</td>${SHAPES.map(([a]) => `<td>${t.conf[`${k}|${a}`] || ''}</td>`).join('')}</tr>`).join('');
  els.stats.innerHTML = `<p><span class="big">${t.n ? pct(t.top1 / t.n) : '-'}</span> 얼굴형 1위 일치 <small>(${t.top1}/${t.n})</small><br>
    2위 안 일치 <b>${t.n ? pct(t.top2 / t.n) : '-'}</b> · 추천 커트 동의 <b>${t.cutN ? pct(t.cutYes / t.cutN) : '-'}</b> <small>(${t.cutYes}/${t.cutN})</small>${t.earN ? ` · 귀 판단 일치 <b>${pct(t.earOk / t.earN)}</b>` : ''}</p>
    <p class="fr-help">아래 표: 줄 = 디자이너 판단, 칸 = AI 1위 (${SHAPES.map(([, l]) => l[0]).join(' · ')})</p>
    <table><tr><th></th>${SHAPES.map(([, l]) => `<th>${l[0]}</th>`).join('')}</tr>${rows}</table>
    ${t.n >= 20 ? '' : '<p class="fr-help">20명 이상 검수하면 일치율을 보고서에 쓸 만해져요.</p>'}`;
  void name;
}
const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); };
const stamp = () => new Date().toISOString().slice(0, 10);
els.exportCsv.addEventListener('click', () => {
  const head = ['file', 'reviewer', 'designer_shape', 'ai_1', 'ai_1_p', 'ai_2', 'ai_2_p', 'designer_ears', 'ai_ears', 'cuts_yes', 'cuts_no', 'ratio', 'forehead', 'jaw', 'chin', 'jawAngle', 'skipped'];
  const lines = state.items.filter((x) => !x.pending).map((x) => {
    const c = Object.entries(x.judge?.cuts || {});
    return [x.file, x.judge?.reviewer || state.reviewer, x.judge?.shape || '', x.ai?.probs[0]?.key || '', x.ai?.probs[0]?.p ?? '', x.ai?.probs[1]?.key || '', x.ai?.probs[1]?.p ?? '',
      x.judge?.ears || '', x.ai?.ears || '', c.filter(([, v]) => v === 'yes').map(([k]) => k).join('/'), c.filter(([, v]) => v === 'no').map(([k]) => k).join('/'),
      ...['ratio', 'forehead', 'jaw', 'chin', 'jawAngle'].map((k) => (x.ai?.m?.[k] != null ? x.ai.m[k].toFixed(3) : '')), x.skipped || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  download(`fit-review-${stamp()}.csv`, '﻿' + [head.join(','), ...lines].join('\n'), 'text/csv');
});
els.exportJson.addEventListener('click', () => { const t = tally(); download(`fit-review-summary-${stamp()}.json`, JSON.stringify({ date: stamp(), reviewer: state.reviewer, faces: t.n, shape_top1: t.n ? t.top1 / t.n : null, shape_top2: t.n ? t.top2 / t.n : null, cut_agree: t.cutN ? t.cutYes / t.cutN : null, cut_votes: t.cutN, ear_agree: t.earN ? t.earOk / t.earN : null, confusion: t.conf }, null, 2), 'application/json'); });
els.clear.addEventListener('click', () => { if (confirm('검수 기록을 모두 지울까요?')) { state = { reviewer: state.reviewer, items: [] }; save(); renderList(); renderStats(); els.main.innerHTML = '<h2>검수</h2><p class="note">셀카를 추가하면 차례대로 얼굴을 잽니다.</p>'; } });

// ---- 고객 평가 분석 (앱의 fit-feedback-*.jsonl) ---------------------------------------------
// 근거 문장을 종류로 묶어(커트 · 앞머리 · 기장 · 귀 · 컬러 · 메이크업) 종류별로 고객이 '맞아요' 한 비율을 본다.
// 어떤 종류가 붙은 판단에서 '글쎄요'가 많으면 그 근거의 점수 가중치를 낮추는 것을 권한다.
const KINDS = [['cut', '커트', /커트|컷/], ['bangs', '앞머리', /앞머리|뱅/], ['length', '기장 · 볼륨', /기장|볼륨|컬|웨이브/], ['ears', '귀', /귀/],
  ['color', '피부 · 컬러', /피부|노란기|붉은기|톤|컬러/], ['makeup', '메이크업', /블러셔|아이라인|립|눈썹|섀도|애교살|하이라이트|셰이딩/]];
els.loadVotes.addEventListener('click', () => els.votes.click());
els.votes.addEventListener('change', async () => {
  const rows = [];
  const seen = new Set();   // 내보낼 때마다 이전 평가가 함께 들어 있어, 파일 여러 개를 넣으면 같은 평가가 겹친다
  for (const f of els.votes.files) for (const line of (await f.text()).split('\n')) {
    let o; try { if (line.trim()) o = JSON.parse(line); } catch {}
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    const k = `${o.t}|${o.where}|${o.title}|${o.vote}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!Array.isArray(o.reasons)) o.reasons = [];
    o.reasons = o.reasons.filter((x) => Array.isArray(x) && x.length === 2);
    rows.push(o);
  }
  els.votes.value = '';
  if (!rows.length) { els.voteStats.innerHTML = '<p class="note">평가가 들어 있지 않아요.</p>'; return; }
  const agree = (xs) => (xs.length ? xs.filter((r) => r.vote === 'agree').length / xs.length : null);
  const bins = [['80점 이상', (s) => s >= 80], ['65~79점', (s) => s >= 65 && s < 80], ['50~64점', (s) => s >= 50 && s < 65], ['50점 미만', (s) => s < 50]];
  const binRows = bins.map(([l, f]) => { const xs = rows.filter((r) => r.score != null && f(r.score)); return `<tr><td>${l}</td><td>${xs.length}</td><td>${xs.length ? pct(agree(xs)) : '-'}</td></tr>`; }).join('');
  const kindRows = KINDS.map(([k, l, re]) => {
    const plus = rows.filter((r) => (r.reasons || []).some(([p, t]) => p > 0 && re.test(t))), minus = rows.filter((r) => (r.reasons || []).some(([p, t]) => p < 0 && re.test(t)));
    const a = agree(plus), b = agree(minus);
    const warn = (plus.length >= 10 && a < 0.5) || (minus.length >= 10 && b < 0.5);
    return `<tr><td>${l}</td><td>${plus.length ? `${pct(a)} <small>(${plus.length})</small>` : '-'}</td><td>${minus.length ? `${pct(b)} <small>(${minus.length})</small>` : '-'}</td><td>${warn ? '가중치 낮추기 검토' : ''}</td></tr>`;
  }).join('');
  els.voteStats.innerHTML = `<p><span class="big">${pct(agree(rows))}</span> 고객 '맞아요' 비율 <small>(${rows.length}개 평가)</small></p>
    <table><tr><th>궁합 점수</th><th>평가</th><th>맞아요</th></tr>${binRows}</table>
    <table style="margin-top:10px"><tr><th>근거 종류</th><th>좋은 점일 때</th><th>아쉬운 점일 때</th><th></th></tr>${kindRows}</table>
    <p class="fr-help">점수가 높을수록 '맞아요' 비율도 높아야 점수가 믿을 만해요. 근거 종류별 비율이 50% 아래로 꾸준히 나오면(10개 이상) face-advice.js 의 scoreStyle 에서 그 근거의 점수를 줄이는 것을 검토하세요.</p>`;
});

renderList(); renderStats();
if (state.items.length) show(0);
