// 전문가 검수 도구 — 사진 여러 장을 분석하고, 전문가가 속성마다 맞음 · 틀림 · 정답을 표시한다.
// 결과: 그룹별 정확도(확신 단계별 포함), 학습용 JSONL(tools/train-heads.py --feedback 호환), 항목별 · 요약 CSV
import { env } from '@huggingface/transformers';
import { createAnalyzer } from './analyzer.js';
import { TAXONOMY, CATEGORY_ORDER } from './taxonomy.js';

env.allowLocalModels = false;
const MODELS = {
  base: { id: 'Marqo/marqo-fashionSigLIP', gpu: 'q8', cpu: 'q8' },
  large: { id: 'Xenova/siglip-large-patch16-384', gpu: 'q4', cpu: 'q8' },
};
const STORE = 'beauty-review-v1';
const LEVEL = { high: '확신', mid: '중간', low: '낮음' };
const CATS = [...CATEGORY_ORDER.map((c) => [c, TAXONOMY[c].label]), ['other', '뷰티 사진 아님']];

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(['status', 'statusText', 'statusBar', 'reviewer', 'field', 'catMode', 'model', 'add', 'files', 'list', 'count', 'main', 'stats',
  'exportJsonl', 'exportCsv', 'exportSum', 'clear'].map((k) => [k, $(k)]));

// ---- 저장 -------------------------------------------------------------------------
let state = load();
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { reviewer: '', field: '', items: [] }; } catch { return { reviewer: '', field: '', items: [] }; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch { setStatus('검수 기록을 저장하지 못했어요 (브라우저 저장 공간 부족). 지금까지 결과를 내보내 주세요.', 0, 'error'); }
}
els.reviewer.value = state.reviewer; els.field.value = state.field;
els.reviewer.addEventListener('input', () => { state.reviewer = els.reviewer.value.trim(); save(); });
els.field.addEventListener('change', () => { state.field = els.field.value; save(); if (state.field) els.catMode.value = state.field; });

const photos = new Map(); // key → { blob, url }  (메모리에만)
let cur = 0;

// ---- 모델 ------------------------------------------------------------------------
let analyzer = null, loading = null, device = 'wasm';
function setStatus(text, pct = 0, cls = '') { els.statusText.textContent = text; els.statusBar.style.width = `${pct}%`; els.status.className = `status ${cls}`; }
async function loadAnalyzer() {
  const m = MODELS[els.model.value];
  analyzer = null;
  loading = (async () => {
    try { device = navigator.gpu && (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm'; } catch { device = 'wasm'; }
    const name = m.id.split('/').pop();
    const [emb, heads] = await Promise.all([fetch(`./embeddings/${name}.json`).then((r) => r.json()), fetch(`./heads/${name}.json`).then((r) => r.json())]);
    const files = new Map();
    const onProgress = (p) => {
      if (p.status === 'progress' && p.file) files.set(p.file, [p.loaded || 0, p.total || 0]);
      let a = 0, b = 0; for (const [x, y] of files.values()) { a += x; b += y; }
      if (b) setStatus(`모델 내려받는 중 ${Math.round((a / b) * 100)}%`, (a / b) * 100);
    };
    const make = (dev) => createAnalyzer({ model: m.id, device: dev, dtype: dev === 'webgpu' ? m.gpu : m.cpu, labelEmbeddings: emb, heads, onProgress });
    try { analyzer = await make(device); } catch (e) { if (device !== 'webgpu') throw e; device = 'wasm'; analyzer = await make('wasm'); }
    setStatus(`준비 완료 · ${els.model.selectedOptions[0].textContent} · ${device === 'webgpu' ? 'WebGPU' : 'WASM'}`, 100, 'ready');
    loading = null;
    processQueue();
  })().catch((e) => { console.error(e); setStatus(`모델 로드 실패: ${e.message}`, 0, 'error'); loading = null; });
}
els.model.addEventListener('change', () => {
  if (state.items.some((x) => x.model !== MODELS[els.model.value].id) && !confirm('모델을 바꾸면 새로 추가하는 사진만 새 모델로 분석해요. 이미 검수한 기록은 그대로 둡니다. 바꿀까요?')) {
    els.model.value = Object.keys(MODELS).find((k) => MODELS[k].id === state.items[0]?.model) || 'base';
    return;
  }
  loadAnalyzer();
});

// ---- 사진 추가 · 분석 --------------------------------------------------------------
els.add.addEventListener('click', () => els.files.click());
els.files.addEventListener('change', () => { addFiles([...els.files.files]); els.files.value = ''; });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); });

const keyOf = (f) => `${f.name}|${f.size}`;
function addFiles(files) {
  for (const f of files) {
    const key = keyOf(f);
    if (!photos.has(key)) photos.set(key, { blob: f, url: URL.createObjectURL(f) });
    if (!state.items.some((x) => x.key === key)) state.items.push({ key, file: f.name, pending: true, category: els.catMode.value });
  }
  save(); renderList(); processQueue();
  if (state.items.length && !els.main.querySelector('.rv-cat')) show(Math.max(0, state.items.findIndex((x) => photos.has(x.key))));
}
let working = false;
async function processQueue() {
  if (working || !analyzer || !state.items.some((x) => x.pending && photos.has(x.key))) return;
  working = true;
  try {
    for (const it of state.items) {
      if (!it.pending || !photos.has(it.key)) continue;
      await analyzeItem(it, it.category === 'auto' ? 'auto' : it.category);
      renderList();
      if (state.items[cur] === it) show(cur);
    }
  } finally { working = false; }
  const left = state.items.filter((x) => x.pending).length;
  setStatus(left ? `분석 대기 ${left}장 (사진을 다시 추가해 주세요)` : `분석 완료 · ${state.items.length}장`, 100, 'ready');
}
async function analyzeItem(it, category) {
  const n = state.items.filter((x) => !x.pending).length + 1;
  setStatus(`분석 중 ${n}/${state.items.length}`, (n / state.items.length) * 100);
  const r = await analyzer.analyze(photos.get(it.key).blob, { category });
  Object.assign(it, {
    pending: false, model: r.model, hash: r.taxonomy_hash, predicted: r.category_ranking[0].key, predicted_score: round(r.category_ranking[0].score),
    category: it.fixedCategory || r.category, is_beauty: r.is_beauty,
    attrs: r.attributes.map((a) => ({ group: a.group, label: a.label, score: round(a.score), level: a.level, alts: a.all.filter((x) => !x.hidden).slice(1, 4).map((x) => x.label) })),
    verdict: {}, correct: {}, emb: b64f32(r.embedding), ts: new Date().toISOString(),
  });
  save();
}

// ---- 화면 -------------------------------------------------------------------------
function renderList() {
  els.list.innerHTML = state.items.map((it, i) => {
    const p = photos.get(it.key);
    const done = isDone(it);
    return `<button type="button" data-i="${i}" class="${i === cur ? 'cur' : ''} ${done ? 'done' : ''}" title="${esc(it.file)}">${p ? `<img src="${p.url}" alt="" />` : '사진 없음'}</button>`;
  }).join('');
  const done = state.items.filter(isDone).length;
  els.count.textContent = state.items.length ? `${done}/${state.items.length} 완료` : '';
  renderStats();
}
const isDone = (it) => !it.pending && (it.category === 'other' || (it.attrs || []).every((a) => it.verdict[a.group]));
els.list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); });

function show(i) {
  if (!state.items.length) return;
  cur = Math.max(0, Math.min(state.items.length - 1, i));
  const it = state.items[cur];
  const p = photos.get(it.key);
  const photo = p ? `<img class="rv-photo" src="${p.url}" alt="${esc(it.file)}" />` : `<div class="rv-missing">이 사진(${esc(it.file)})을 다시 추가하면 화면에 보여요. 검수 기록은 남아 있어요.</div>`;
  if (it.pending) { els.main.innerHTML = `<h2>검수 <small>${cur + 1}/${state.items.length}</small></h2>${photo}<p class="note">${analyzer ? '분석 중…' : '모델 준비 중…'}</p>`; markCur(); return; }
  const def = TAXONOMY[it.category];
  const rows = it.category === 'other' ? '<p class="note">뷰티 사진이 아니라고 표시했어요. 이 사진의 속성은 검수하지 않아요.</p>' : it.attrs.map((a) => {
    const g = def.groups.find((x) => x.key === a.group);
    const v = it.verdict[a.group];
    const d = g.labels.find((l) => l.ko === a.label)?.def || '';
    const opts = g.labels.map((l) => `<option ${it.correct[a.group] === l.ko ? 'selected' : ''}>${esc(l.ko)}</option>`).join('');
    return `<div class="rv-row" data-g="${a.group}">
      <span class="g">${esc(g.label)}</span>
      <span class="p"><b>${esc(a.label)}</b><small>${pct(a.score)}</small><span class="lv">${LEVEL[a.level]}</span></span>
      <span class="v">${[['ok', '맞음'], ['wrong', '틀림'], ['skip', '판단 불가']].map(([k, t]) => `<button type="button" data-v="${k}" class="${v === k ? 'on' : ''}">${t}</button>`).join('')}</span>
      ${d ? `<span class="d">${esc(d)} · 다음 후보: ${a.alts.map(esc).join(', ')}</span>` : ''}
      ${v === 'wrong' ? `<select aria-label="${esc(g.label)} 정답"><option value="">정답 고르기</option>${opts}</select>` : ''}
    </div>`;
  }).join('');
  els.main.innerHTML = `<h2>검수 <small>${cur + 1}/${state.items.length} · ${esc(it.file)}</small></h2>${photo}
    <div class="rv-cat">카테고리: AI 판단 <b>${esc(TAXONOMY[it.predicted]?.label || it.predicted)}</b> ${pct(it.predicted_score)}${it.is_beauty ? '' : ' (뷰티 사진 아닐 수 있음)'}
      <label>정답 <select id="catFix">${CATS.map(([k, l]) => `<option value="${k}" ${k === it.category ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${rows}
    <div class="row"><button class="ghost small" id="prev" type="button">이전</button><button class="primary small" id="allOk" type="button">남은 항목 모두 맞음 · 다음</button><button class="ghost small" id="next" type="button">다음</button></div>`;
  $('prev').onclick = () => show(cur - 1);
  $('next').onclick = () => show(cur + 1);
  $('allOk').onclick = allOkNext;
  $('catFix').onchange = async (e) => {
    const c = e.target.value;
    it.fixedCategory = c;
    if (c === 'other') { it.category = 'other'; it.verdict = {}; it.correct = {}; save(); renderList(); show(cur); return; }
    if (!photos.has(it.key) || !analyzer) { alert('카테고리를 바꾸려면 사진과 모델이 필요해요.'); e.target.value = it.category; return; }
    await analyzeItem(it, c); renderList(); show(cur);
  };
  markCur();
}
function markCur() { els.list.querySelectorAll('button').forEach((b) => b.classList.toggle('cur', +b.dataset.i === cur)); }

els.main.addEventListener('click', (e) => {
  const b = e.target.closest('.v button'); if (!b) return;
  setVerdict(b.closest('.rv-row').dataset.g, b.dataset.v);
});
els.main.addEventListener('change', (e) => {
  if (e.target.tagName !== 'SELECT' || e.target.id === 'catFix') return;
  const it = state.items[cur];
  const g = e.target.closest('.rv-row').dataset.g;
  it.correct[g] = e.target.value || undefined;
  // 고른 정답이 AI 답과 같으면 '맞음'으로 바꾼다
  if (e.target.value === it.attrs.find((a) => a.group === g).label) { it.verdict[g] = 'ok'; delete it.correct[g]; show(cur); }
  save(); renderList();
});
function setVerdict(g, v) {
  const it = state.items[cur];
  if (!it || it.pending) return;
  it.verdict[g] = it.verdict[g] === v ? undefined : v;
  if (v !== 'wrong') delete it.correct[g];
  save(); renderList(); show(cur);
  if (v === 'wrong') els.main.querySelector(`.rv-row[data-g="${g}"] select`)?.focus();
}
function allOkNext() {
  const it = state.items[cur];
  if (it && !it.pending && it.category !== 'other') for (const a of it.attrs) if (!it.verdict[a.group]) it.verdict[a.group] = 'ok';
  save(); renderList();
  const next = state.items.findIndex((x, i) => i > cur && !isDone(x));
  show(next >= 0 ? next : cur + 1);
}
document.addEventListener('keydown', (e) => {
  const a = document.activeElement;
  // 이름 입력 중이거나 정답 고르는 목록이 열려 있을 때는 단축키를 쓰지 않는다
  if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'file') || (a.tagName === 'SELECT' && els.main.contains(a)))) return;
  if (a?.tagName === 'SELECT') a.blur(); // 위쪽 설정 목록에 남은 포커스는 풀어 준다
  const it = state.items[cur];
  if (e.key === 'ArrowRight') show(cur + 1);
  else if (e.key === 'ArrowLeft') show(cur - 1);
  else if (e.key === 'Enter') { e.preventDefault(); allOkNext(); }
  else if (['1', '2', '3'].includes(e.key) && it && !it.pending && it.attrs) {
    const a = it.attrs.find((x) => !it.verdict[x.group]);
    if (a) setVerdict(a.group, ['ok', 'wrong', 'skip'][+e.key - 1]);
  }
});

// ---- 정확도 -----------------------------------------------------------------------
function tally() {
  const groups = new Map(); // 'hair.cut' → { n, ok, byLevel: { high: [n, ok], ... } }
  let catN = 0, catOk = 0;
  for (const it of state.items) {
    if (it.pending) continue;
    if (it.fixedCategory || isDone(it)) { catN++; if (it.predicted === it.category) catOk++; }
    if (it.category === 'other') continue;
    for (const a of it.attrs || []) {
      const v = it.verdict[a.group];
      if (v !== 'ok' && v !== 'wrong') continue;
      const k = `${it.category}.${a.group}`;
      const t = groups.get(k) || { n: 0, ok: 0, byLevel: { high: [0, 0], mid: [0, 0], low: [0, 0] } };
      t.n++; t.byLevel[a.level][0]++;
      if (v === 'ok') { t.ok++; t.byLevel[a.level][1]++; }
      groups.set(k, t);
    }
  }
  return { groups, catN, catOk };
}
function renderStats() {
  const { groups, catN, catOk } = tally();
  if (!groups.size && !catN) { els.stats.innerHTML = '<p class="note">아직 검수한 항목이 없어요.</p>'; return; }
  let n = 0, ok = 0; const lv = { high: [0, 0], mid: [0, 0], low: [0, 0] };
  for (const t of groups.values()) { n += t.n; ok += t.ok; for (const k in lv) { lv[k][0] += t.byLevel[k][0]; lv[k][1] += t.byLevel[k][1]; } }
  const rate = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const rows = [...groups.entries()].sort().map(([k, t]) => {
    const [c, g] = k.split('.');
    const label = `${TAXONOMY[c].label} · ${TAXONOMY[c].groups.find((x) => x.key === g).label}`;
    return `<tr><td>${esc(label)}</td><td>${t.n}</td><td>${rate(t.ok, t.n)}</td><td>${rate(t.byLevel.high[1], t.byLevel.high[0])}</td></tr>`;
  }).join('');
  els.stats.innerHTML = `<p><span class="big">${rate(ok, n)}</span> 속성 정확도 (${ok}/${n})</p>
    <p class="note">확신(90% 이상, '~예요'로 말함) ${rate(lv.high[1], lv.high[0])} · 중간 ${rate(lv.mid[1], lv.mid[0])} · 낮음 ${rate(lv.low[1], lv.low[0])}<br>카테고리 ${rate(catOk, catN)} (${catN}장)</p>
    <table><thead><tr><th>항목</th><th>수</th><th>정확도</th><th>확신일 때</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- 내보내기 ---------------------------------------------------------------------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const csv = (rows) => '﻿' + rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
els.exportJsonl.addEventListener('click', () => {
  const lines = [];
  for (const it of state.items) {
    if (it.pending) continue;
    const labels = {};
    if (it.category !== 'other') for (const a of it.attrs) {
      const v = it.verdict[a.group];
      if (v === 'ok') labels[a.group] = [a.label];
      else if (v === 'wrong' && it.correct[a.group]) labels[a.group] = [it.correct[a.group]];
    }
    if (!Object.keys(labels).length && it.category === it.predicted) continue;
    lines.push(JSON.stringify({ id: `rv-${hash(it.key)}`, ts: it.ts, app: 'beauty-review/1', source: 'expert-review', reviewer: state.reviewer, field: state.field,
      model: it.model, hash: it.hash, predicted: it.predicted, category: it.category, labels, emb: it.emb }));
  }
  if (!lines.length) return alert('내보낼 검수 결과가 없어요.');
  download(`beauty-review-${stamp()}.jsonl`, lines.join('\n') + '\n', 'application/x-ndjson');
});
els.exportCsv.addEventListener('click', () => {
  const rows = [['검수자', '분야', '파일', '모델', 'AI 카테고리', '정답 카테고리', '항목', 'AI 답', '확률', '확신 단계', '판정', '정답']];
  for (const it of state.items) {
    if (it.pending) continue;
    if (it.category === 'other') { rows.push([state.reviewer, state.field, it.file, it.model, it.predicted, 'other', '', '', '', '', '', '']); continue; }
    for (const a of it.attrs) {
      const g = TAXONOMY[it.category].groups.find((x) => x.key === a.group);
      const v = it.verdict[a.group];
      rows.push([state.reviewer, state.field, it.file, it.model, it.predicted, it.category, g.label, a.label, a.score, LEVEL[a.level],
        { ok: '맞음', wrong: '틀림', skip: '판단 불가' }[v] || '', v === 'ok' ? a.label : it.correct[a.group] || '']);
    }
  }
  download(`beauty-review-items-${stamp()}.csv`, csv(rows), 'text/csv');
});
els.exportSum.addEventListener('click', () => {
  const { groups, catN, catOk } = tally();
  const rows = [['카테고리', '항목', '검수 수', '맞음', '정확도', '확신 수', '확신 정확도', '중간 수', '중간 정확도', '낮음 수', '낮음 정확도']];
  const r = (a, b) => (b ? (a / b).toFixed(3) : '');
  for (const [k, t] of [...groups.entries()].sort()) {
    const [c, g] = k.split('.');
    rows.push([TAXONOMY[c].label, TAXONOMY[c].groups.find((x) => x.key === g).label, t.n, t.ok, r(t.ok, t.n),
      ...['high', 'mid', 'low'].flatMap((l) => [t.byLevel[l][0], r(t.byLevel[l][1], t.byLevel[l][0])])]);
  }
  rows.push(['전체', '카테고리 판별', catN, catOk, r(catOk, catN)]);
  download(`beauty-review-summary-${stamp()}.csv`, csv(rows), 'text/csv');
});
els.clear.addEventListener('click', () => {
  if (!confirm('이 브라우저에 저장된 검수 기록을 모두 지울까요? 먼저 내보내기를 권해요.')) return;
  state = { reviewer: state.reviewer, field: state.field, items: [] };
  save(); cur = 0; renderList();
  els.main.innerHTML = '<h2>검수</h2><p class="note">사진을 추가하면 차례대로 분석합니다.</p>';
});

// ---- 도움 함수 --------------------------------------------------------------------
function b64f32(vec) {
  const u8 = new Uint8Array(Float32Array.from(vec).buffer);
  let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const pct = (x) => `${Math.round(x * 100)}%`;
const round = (x) => Math.round(x * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const firstModel = Object.keys(MODELS).find((k) => MODELS[k].id === state.items.find((x) => x.model)?.model);
if (firstModel) els.model.value = firstModel;
if (state.field) els.catMode.value = state.field;
renderList();
if (state.items.length) show(0);
loadAnalyzer();
