// '내 손톱 분석' 화면: 손 사진 → nail.js 측정 → nail-advice.js 추천
import { analyzeNails, preloadNails, modelsReady, TYPE_KO } from './nail.js';
import { guardStart, guardEnd } from './device.js';
import { SHAPES, nailReport, TYPE_LINE, nailCardImage, NAIL_ICON } from './nail-advice.js';

const $ = (id) => document.getElementById(id);
const els = {
  grid: $('nailGrid'), drop: $('nailDrop'), file: $('nailFile'), preview: $('nailPreview'), hint: $('nailHint'),
  shoot: $('nailShoot'), pick: $('nailPick'), camera: $('nailCamera'),
  empty: $('nailEmpty'), status: $('nailStatus'), result: $('nailResult'), canvas: $('nailCanvas'),
  type: $('nailType'), summary: $('nailSummary'), warn: $('nailWarn'), top: $('nailTop'), avoid: $('nailAvoid'),
  tips: $('nailTips'), measures: $('nailMeasures'), card: $('nailCard'), copy: $('nailCopy'), save: $('nailSave'), again: $('nailAgain'),
  vote: $('nailVote'), voteExport: $('nailVoteExport'), fingers: $('nailFingers'), find: $('nailFind'),
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t) => { const el = $('toast'); if (!el) return; el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); };
const answers = { life: 'normal', length: 'any', natural: 'any', curve: '' };
let blob = null, last = null, seq = 0, busy = false;
const VOTE_KEY = 'beauty-nail-feedback-v1';

if (els.grid) {
  // 탭을 열면 모델을 미리 받아 둔다 (손 랜드마크 7.8MB + 손톱 모델 + 분석 엔진)
  window.addEventListener('modechange', () => { if (document.body.dataset.mode === 'nail') preloadNails().catch(() => {}); });
  if (document.body.dataset.mode === 'nail') preloadNails().catch(() => {}); // ?mode=nail 로 바로 열린 경우 (app.js 가 먼저 탭을 바꿈)
  els.pick.addEventListener('click', () => els.file.click());
  els.shoot.addEventListener('click', () => els.camera.click());
  for (const inp of [els.file, els.camera]) inp.addEventListener('change', () => { const f = inp.files[0]; inp.value = ''; if (f) setImage(f); });
  ['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
  els.drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) setImage(f); });
  window.addEventListener('paste', (e) => {
    if (document.body.dataset.mode !== 'nail') return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.stopImmediatePropagation(); setImage(item.getAsFile()); }
  }, true);
  document.querySelectorAll('.nail-q [data-q]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    answers[g.dataset.q] = b.dataset.v;
    if (last?.ok && !busy) render(); // 답이 바뀌면 추천만 다시 (분석 중이면 끝난 뒤 새 답으로 그린다)
  }));
  els.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(els.card.textContent); toast('상담 카드를 복사했어요'); } catch { toast('복사하지 못했어요'); } });
  // 이미지로 저장: 손 사진(윤곽 · 입혀 본 쉐입 포함) + 손톱형 + 추천 쉐입 + 상담 문장을 한 장으로 (휴대폰은 공유 시트)
  els.save?.addEventListener('click', async () => {
    if (!last || !lastRep) return;
    els.save.disabled = true;
    try {
      const blob = await nailCardImage({ canvas: els.canvas, rep: lastRep, headline: els.type.textContent, summary: els.summary.textContent, icons: ICON, tryOn: tryShape ? { shape: tryShape, color: tryColor } : null });
      const name = `손톱상담카드-${new Date().toISOString().slice(0, 10)}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: '손톱 상담 카드' }).catch(() => {}); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('이미지로 저장했어요');
    } catch (e) { console.error(e); toast('이미지를 만들지 못했어요'); } finally { els.save.disabled = false; }
  });
  els.again.addEventListener('click', () => els.file.click());
  // 실험실 평가: 측정값 · 판정 · 추천 · 답만 이 브라우저에 쌓는다 (사진 X). 같은 결과에서 다시 누르면 답을 바꾼다
  els.vote.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b || !last?.ok) return;
    const row = b.closest('[data-q]'); row.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    last.votes ??= {}; last.votes[row.dataset.q] = b.dataset.v === '1';
    saveVote(); toast('알려 줘서 고마워요. 기준을 다듬는 데 쓸게요.');
  });
  els.voteExport.addEventListener('click', () => {
    const rows = votes(); if (!rows.length) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' }));
    a.download = `nail-feedback-${new Date().toISOString().slice(0, 10)}.jsonl`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  syncVoteExport();
}
function votes() { try { const v = JSON.parse(localStorage.getItem(VOTE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function syncVoteExport() { const n = votes().length; els.voteExport?.classList.toggle('hidden', !n); if (els.voteExport) els.voteExport.textContent = `평가 ${n}개 내보내기`; }
function saveVote() {
  const r = last; r.voteId ??= `${Date.now()}`;
  const fingers = Object.fromEntries(r.fingers.filter((f) => f.m).map((f) => [f.key, Object.fromEntries(['ratio', 'taper', 'cuticle', 'free', 'size'].map((k) => [k, f.m[k] == null ? null : Math.round(f.m[k] * 1000) / 1000]))]));
  const row = { id: r.voteId, t: new Date().toISOString(), v: 1, votes: r.votes, type: { width: r.type.width, spread: r.type.spread, base: r.type.base, finger: r.type.finger, length: r.type.length },
    top: r.lastTop || null, answers: { ...answers }, polish: !!r.polish, hand: { finger: Math.round(r.hand.finger * 1000) / 1000 }, fingers };
  try { const list = votes().filter((x) => x.id !== row.id); list.push(row); localStorage.setItem(VOTE_KEY, JSON.stringify(list.slice(-500))); } catch {}
  syncVoteExport();
}

function setImage(f) {
  if (!f?.type?.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요'); return; }
  blob = f;
  if (els.preview.src.startsWith('blob:')) URL.revokeObjectURL(els.preview.src);
  els.preview.src = URL.createObjectURL(f); els.preview.classList.remove('hidden'); els.hint.classList.add('hidden');
  run();
}

async function run() {
  const id = ++seq, img = blob;
  busy = true; last = null;
  els.empty.classList.add('hidden'); els.result.classList.add('hidden');
  els.status.classList.remove('hidden');
  els.status.innerHTML = '<p class="st"><span class="spin"></span> 손톱을 재는 중… <small>처음에는 손 · 손톱 모델(약 20MB)을 내려받아요</small></p>';
  if (window.innerWidth < 900) $('nailResultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    guardStart('nail'); let r; try { r = await analyzeNails(img); } finally { guardEnd('nail'); }
    if (id !== seq) return;
    busy = false; last = r;
    if (!r.ok) { renderRetake(r); return; }
    els.status.classList.add('hidden');
    render({ fresh: true });
  } catch (e) {
    console.error(e);
    if (id !== seq) return;
    busy = false;
    els.status.innerHTML = modelsReady()
      ? `이 사진을 읽지 못했어요 (${esc(e.message)}). JPG · PNG 사진으로 다시 올려 주세요.`
      : `손톱 분석 모델을 불러오지 못했어요 (${esc(e.message)}). ${/GLctx|WebGL|webgl|context/i.test(e.message) ? '이 브라우저에서는 분석에 필요한 그래픽 기능(WebGL)을 쓸 수 없어요. 다른 브라우저(크롬 · 사파리 최신)에서 열어 주세요.' : '인터넷 연결을 확인하고 다시 시도해 주세요.'}`;
  }
}

function renderRetake(r) {
  const list = r.issues.length ? r.issues : [{ title: '손톱 모양을 재지 못했어요', fix: '손등이 위로 오게 손을 평평하게 두고 위에서 찍어 주세요.' }];
  els.result.classList.add('hidden');
  const blocks = list.filter((x) => (x.level || 'block') === 'block'), warns = list.filter((x) => x.level === 'warn');
  els.status.innerHTML = `<div class="retake-head"><b>다시 찍어 주세요</b></div><ul class="issues">${[...blocks, ...warns].map((x) => `<li class="${x.level || 'block'}"><b>${esc(x.title)}</b><span>${esc(x.fix)}</span></li>`).join('')}</ul><div class="row"><button type="button" class="primary" data-act="retake">다시 찍기</button><button type="button" class="ghost" data-act="pick">다른 사진 올리기</button></div>`;
  els.status.querySelector('[data-act="retake"]').addEventListener('click', () => els.camera.click());
  els.status.querySelector('[data-act="pick"]').addEventListener('click', () => els.file.click());
}

// 쉐입 아이콘 (손톱 하나, 위가 끝)
// 쉐입 아이콘(SVG path)은 nail-advice.js 의 NAIL_ICON 을 쓴다 (기록에서 상담 카드를 다시 그릴 때도 필요)
const ICON = NAIL_ICON;
const icon = (k) => `<svg viewBox="0 0 46 64" aria-hidden="true"><path d="${ICON[k] || ICON.라운드}" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 50q15 -8 30 0" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".5"/></svg>`;

function render({ fresh = false } = {}) {   // fresh: 새 사진을 분석한 직후 (답만 바꾼 경우는 기록을 새로 만들지 않고 고친다)
  const r = last, t = r.type;
  const rep = lastRep = nailReport(t, { life: answers.life, length: answers.length, natural: answers.natural, curve: answers.curve || null });
  renderTry();
  drawOverlay(r);
  els.result.classList.remove('hidden');
  els.type.textContent = `${TYPE_KO.width[t.width]}`;
  els.summary.textContent = [TYPE_KO.base[t.base], TYPE_KO.spread[t.spread], TYPE_KO.finger[t.finger], t.length ? TYPE_KO.length[t.length] : null].filter(Boolean).join(' · ') + ` (검지 · 중지 · 약지 ${t.n}개 기준)`;
  const warns = r.issues.filter((x) => x.level !== 'block');
  els.warn.classList.toggle('hidden', !warns.length);
  els.warn.innerHTML = warns.map((x) => `<li><b>${esc(x.title)}</b> ${esc(x.fix)}</li>`).join('');
  r.lastTop = rep.top.map((x) => x.key);
  els.vote.querySelectorAll('[data-q]').forEach((row) => { const v = r.votes?.[row.dataset.q]; row.querySelectorAll('button').forEach((x) => x.classList.toggle('active', v != null && (x.dataset.v === '1') === v)); });
  els.top.innerHTML = rep.top.map((s, i) => `<div class="nail-shape${i ? '' : ' top'}">${icon(s.key)}<div><b>${i + 1}. ${esc(s.key)}</b> <span class="sc">${s.score}점</span><p>${esc(s.why[0])}</p><p class="sc">${esc(s.d)}</p></div></div>`).join('');
  els.avoid.classList.toggle('hidden', !rep.avoid.length);
  els.avoid.innerHTML = rep.avoid.length ? `<b>피하면 좋은 모양</b> · ${rep.avoid.map((s) => `${esc(s.key)}: ${esc(s.warn[0])}`).join(' / ')}` : '';
  els.tips.innerHTML = [
    `<div class="adv"><b>길이</b><ul>${rep.lengthTip.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul></div>`,
    `<div class="adv"><b>디자인</b><ul>${rep.design.map((d) => `<li><span>${esc(d.k)}</span> <small>${esc(d.t)}</small></li>`).join('')}</ul></div>`,
  ].join('');
  const f2 = (x, d = 2) => (x == null ? '–' : x.toFixed(d));
  els.measures.innerHTML = `<thead><tr><th>손가락</th><th>너비 : 길이</th><th>끝 퍼짐</th><th>큐티클 깊이</th><th>하얀 끝</th></tr></thead><tbody>${r.fingers.map((f) => f.m
    ? `<tr${f.key === 'thumb' ? ' class="muted"' : ''}><th scope="row">${esc(f.ko)}${f.key === 'thumb' ? ' <small>(참고)</small>' : ''}</th><td>${f2(f.m.ratio)} : 1</td><td>${f2(f.m.taper)}</td><td>${f2(f.m.cuticle)}</td><td>${Math.round(f.m.free * 100)}%</td></tr>`
    : `<tr class="muted"><th scope="row">${esc(f.ko)}</th><td colspan="4">손톱을 찾지 못했어요</td></tr>`).join('')}</tbody>`;
  renderFingers(r);
  els.card.textContent = ['[FINDE 손톱 상담 카드]', ...rep.card, '', '* 사진으로 잰 손톱 모양 참고 정보예요 (의학적 진단 아님)'].join('\n');
  window.dispatchEvent(new CustomEvent('beauty:nail', { detail: { update: !fresh, result: r, report: rep, headline: els.type.textContent, summary: els.summary.textContent, tryOn: tryShape ? { shape: tryShape, color: tryColor } : null } }));
}

// 손가락별 카드: 손톱마다 잘라 본 사진 + 윤곽 + 한 줄 평, 그리고 다섯 손톱을 비교한 발견 한 줄
const NN = { ratio: [0.80, 0.2], taper: [0.931, 0.129], cuticle: [0.057, 0.074] };   // nail.js NAIL_NORM 과 같은 기준 (손톱 851개)
function fingerSay(m) {
  const z = (k) => (m[k] - NN[k][0]) / NN[k][1];
  const out = [];
  const zr = z('ratio');
  out.push(zr <= -0.6 ? '세로로 길쭉한 손톱' : zr >= 0.6 ? '가로로 넉넉한 손톱' : '가로세로 균형이 좋은 손톱');
  const zt = z('taper');
  if (zt >= 0.7) out.push('끝이 살짝 퍼져요'); else if (zt <= -0.7) out.push('끝으로 갈수록 갸름해져요');
  const zc = z('cuticle');
  if (zc >= 0.7) out.push('큐티클 라인이 둥글게 깊어요'); else if (zc <= -0.6) out.push('큐티클 라인이 납작한 편');
  return out;
}
function fingerThumb(r, f, size = 132) {
  const xs = f.outline.map((p) => p[0]), ys = f.outline.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.68 + 6;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), s = size / (half * 2), T = ([x, y]) => [(x - cx + half) * s, (y - cy + half) * s];
  g.drawImage(r.canvas, cx - half, cy - half, half * 2, half * 2, 0, 0, size, size);
  g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = f.key === 'thumb' ? 'rgba(255,255,255,.85)' : '#2ecc71';
  g.beginPath(); f.outline.forEach((p, i) => { const [x, y] = T(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
  return c.toDataURL('image/jpeg', 0.85);
}
function renderFingers(r) {
  const list = r.fingers.filter((f) => f.m && f.outline);
  if (!list.length) { els.fingers.innerHTML = ''; els.find.classList.add('hidden'); return; }
  els.fingers.innerHTML = list.map((f) => `<figure class="nf${f.key === 'thumb' ? ' thumb' : ''}"><img src="${fingerThumb(r, f)}" alt="${esc(f.ko)} 손톱" /><figcaption><b>${esc(f.ko)}</b>${fingerSay(f.m).map((t) => `<span>${esc(t)}</span>`).join('')}<small>너비 : 길이 ${f.m.ratio.toFixed(2)} : 1</small></figcaption></figure>`).join('');
  // 발견: 엄지를 뺀 손톱 중 가장 갸름한(너비 비율이 가장 작은) 손가락 — 반지 · 네일아트 포인트 자리로
  const four = list.filter((f) => f.key !== 'thumb');
  if (four.length >= 2) {
    const slim = four.slice().sort((a, b) => a.m.ratio - b.m.ratio)[0], wide = four.slice().sort((a, b) => b.m.ratio - a.m.ratio)[0];
    const gap = wide.m.ratio - slim.m.ratio;
    els.find.innerHTML = `<b>발견</b> 가장 갸름한 손톱은 <strong>${esc(slim.ko)}</strong>예요 (너비 : 길이 ${slim.m.ratio.toFixed(2)} : 1). ${gap >= 0.08 ? `${esc(wide.ko)}보다 ${Math.round((gap / wide.m.ratio) * 100)}% 더 갸름해서, 파츠 · 포인트 아트를 올리면 가장 돋보이는 자리예요.` : '네 손톱 비율이 고르게 비슷해서, 같은 디자인을 열 손가락에 해도 균형이 잘 맞아요.'}`;
    els.find.classList.remove('hidden');
  } else els.find.classList.add('hidden');
}

// 가상 쉐입 입혀 보기: 고른 모양을 손톱 위에 그린다 (분할로 찾은 손톱 너비 · 길이 기준, 긴 모양은 끝을 늘려 그림)
let tryShape = null, tryColor = '#e8b4b8', lastRep = null;
const NAIL_COLORS = ['#e8b4b8', '#f3d9c8', '#c94b5a', '#8b2e3f', '#d9c7f2', '#9fb7c9', '#2b2b2b', '#f6f0e8'];
const SHAPE_GEO = { 라운드: { len: 1.0, tipW: 1.0, tipH: 0.5, flat: false, sharp: false }, 오벌: { len: 1.15, tipW: 0.82, tipH: 0.55, flat: false, sharp: false },
  라운드스퀘어: { len: 1.05, tipW: 0.96, tipH: 0.14, flat: true, sharp: false }, 스퀘어: { len: 1.05, tipW: 1.0, tipH: 0.0, flat: true, sharp: false },
  아몬드: { len: 1.35, tipW: 0.0, tipH: 0.45, flat: false, sharp: true }, 코핀: { len: 1.5, tipW: 0.55, tipH: 0.45, flat: true, sharp: false }, 스틸레토: { len: 1.5, tipW: 0.0, tipH: 0.5, flat: false, sharp: true } };
function renderTry() {
  const sp = document.getElementById('nailShapePick'), cp = document.getElementById('nailColorPick'); if (!sp) return;
  sp.innerHTML = `<button type="button" data-s="" class="${tryShape ? '' : 'active'}">안 보기</button>` + Object.keys(SHAPES).map((k) => `<button type="button" data-s="${k}" class="${tryShape === k ? 'active' : ''}">${k}</button>`).join('');
  cp.innerHTML = NAIL_COLORS.map((c) => `<button type="button" data-c="${c}" class="${tryColor === c ? 'active' : ''}" style="background:${c}" aria-label="색 ${c}"></button>`).join('');
  // 입혀 본 모양 · 색이 바뀌면 내 기록의 사진과 상담 카드도 그에 맞춘다
  const tried = () => { if (!last) return; drawOverlay(last); window.dispatchEvent(new CustomEvent('beauty:nail-try', { detail: { tryOn: tryShape ? { shape: tryShape, color: tryColor } : null, canvas: els.canvas } })); };
  sp.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tryShape = b.dataset.s || null; renderTry(); tried(); };
  cp.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tryColor = b.dataset.c; renderTry(); tried(); };
}
function shapePath(m, geo) {
  const { l, r, yTop, yBot } = m.box, W = r - l + 1, cx = (l + r + 1) / 2, L0 = yBot - yTop + 1;
  const tipY = yBot - L0 * geo.len, tipH = geo.sharp || geo.flat ? (yBot - tipY) * geo.tipH : W * geo.tipH;
  const shoulder = tipY + tipH, wTip = W * geo.tipW;
  const pts = [[l, yBot]];
  // 왼쪽 옆선: 뿌리 → 어깨 (끝이 좁아지는 모양은 어깨에서 폭이 줄기 시작)
  const sx = cx - wTip / 2, sxR = cx + wTip / 2;
  pts.push([l, Math.min(yBot, shoulder + (geo.sharp || geo.flat ? 0 : 0))]);
  if (geo.sharp) { pts.push([cx, tipY]); pts.push([r + 1, shoulder]); }
  else if (geo.flat) { pts.push([sx, tipY]); pts.push([sxR, tipY]); pts.push([r + 1, shoulder]); }
  else { // 둥근 끝: 타원 호
    const n = 10; for (let i = 0; i <= n; i++) { const a = Math.PI - (Math.PI * i) / n; pts.push([cx + (wTip / 2) * Math.cos(a), shoulder - tipH * Math.sin(a)]); }
    pts.push([r + 1, shoulder]);
  }
  pts.push([r + 1, yBot]);
  // 큐티클 쪽 둥근 바닥
  const n2 = 8; for (let i = 1; i < n2; i++) { const u = i / n2; pts.push([r + 1 - W * u, yBot + W * 0.13 * Math.sin(Math.PI * u)]); }
  return pts;
}
function drawTry(g, r, sc) {
  if (!tryShape) return;
  const geo = SHAPE_GEO[tryShape]; if (!geo) return;
  for (const f of r.fingers) {
    if (!f.m || !f.frame) continue;
    const { p0, a, b } = f.frame;
    const P = shapePath(f.m, geo).map(([x, y]) => [(p0[0] + a[0] * x + b[0] * y) * sc, (p0[1] + a[1] * x + b[1] * y) * sc]);
    g.save(); g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = tryColor + '99'; g.fill(); g.lineWidth = Math.max(1.5, g.canvas.width / 450); g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke(); g.restore();
  }
}
function drawOverlay(r) {
  const c = els.canvas, src = r.canvas;
  const sc = Math.min(1, 900 / Math.max(src.width, src.height));
  c.width = Math.round(src.width * sc); c.height = Math.round(src.height * sc);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  g.lineWidth = Math.max(2, c.width / 300); g.lineJoin = 'round';
  for (const f of r.fingers) {
    if (!f.outline) continue;
    g.strokeStyle = f.key === 'thumb' ? 'rgba(255,255,255,.75)' : '#2ecc71';
    g.beginPath(); f.outline.forEach(([x, y], i) => (i ? g.lineTo(x * sc, y * sc) : g.moveTo(x * sc, y * sc))); g.closePath(); g.stroke();
    if (f.freeLine) { g.save(); g.setLineDash([4, 3]); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(f.freeLine[0][0] * sc, f.freeLine[0][1] * sc); g.lineTo(f.freeLine[1][0] * sc, f.freeLine[1][1] * sc); g.stroke(); g.restore(); }
  }
  drawTry(g, r, sc);
}
export { TYPE_LINE };
