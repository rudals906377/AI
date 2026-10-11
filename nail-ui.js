// '내 손톱 분석' 화면: 손 사진 → nail.js 측정 → nail-advice.js 추천
import { analyzeNails, preloadNails, TYPE_KO } from './nail.js';
import { nailReport, TYPE_LINE } from './nail-advice.js';

const $ = (id) => document.getElementById(id);
const els = {
  grid: $('nailGrid'), drop: $('nailDrop'), file: $('nailFile'), preview: $('nailPreview'), hint: $('nailHint'),
  shoot: $('nailShoot'), pick: $('nailPick'), camera: $('nailCamera'),
  empty: $('nailEmpty'), status: $('nailStatus'), result: $('nailResult'), canvas: $('nailCanvas'),
  type: $('nailType'), summary: $('nailSummary'), warn: $('nailWarn'), top: $('nailTop'), avoid: $('nailAvoid'),
  tips: $('nailTips'), measures: $('nailMeasures'), card: $('nailCard'), copy: $('nailCopy'), again: $('nailAgain'),
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t) => { const el = $('toast'); if (!el) return; el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); };
const answers = { life: 'normal', length: 'any', natural: 'any', curve: '' };
let blob = null, last = null, seq = 0;

if (els.grid) {
  // 탭을 열면 모델을 미리 받아 둔다 (손 랜드마크 7.8MB + 손톱 모델 + 분석 엔진)
  window.addEventListener('modechange', () => { if (document.body.dataset.mode === 'nail') preloadNails().catch(() => {}); });
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
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    answers[g.dataset.q] = b.dataset.v;
    if (last?.ok) render(); // 답이 바뀌면 추천만 다시
  }));
  els.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(els.card.textContent); toast('상담 카드를 복사했어요'); } catch { toast('복사하지 못했어요'); } });
  els.again.addEventListener('click', () => els.file.click());
}

function setImage(f) {
  if (!f?.type?.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요'); return; }
  blob = f;
  if (els.preview.src.startsWith('blob:')) URL.revokeObjectURL(els.preview.src);
  els.preview.src = URL.createObjectURL(f); els.preview.classList.remove('hidden'); els.hint.classList.add('hidden');
  run();
}

async function run() {
  const id = ++seq;
  els.empty.classList.add('hidden'); els.result.classList.add('hidden');
  els.status.classList.remove('hidden');
  els.status.innerHTML = '<p class="st"><span class="spin"></span> 손톱을 재는 중… <small>처음에는 손 · 손톱 모델(약 20MB)을 내려받아요</small></p>';
  if (window.innerWidth < 900) $('nailResultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const r = await analyzeNails(blob);
    if (id !== seq) return;
    last = r;
    if (!r.ok) { renderRetake(r); return; }
    els.status.classList.add('hidden');
    render();
  } catch (e) {
    console.error(e);
    if (id !== seq) return;
    els.status.innerHTML = `손톱 분석 모델을 불러오지 못했어요 (${esc(e.message)}). 인터넷 연결을 확인하고 다시 시도해 주세요.`;
  }
}

function renderRetake(r) {
  const list = r.issues.length ? r.issues : [{ title: '손톱 모양을 재지 못했어요', fix: '손등이 위로 오게 손을 평평하게 두고 위에서 찍어 주세요.' }];
  els.status.innerHTML = `<div class="retake-head"><b>다시 찍어 주세요</b></div><ul class="issues">${list.map((x) => `<li class="${x.level || 'block'}"><b>${esc(x.title)}</b><span>${esc(x.fix)}</span></li>`).join('')}</ul>`;
}

// 쉐입 아이콘 (손톱 하나, 위가 끝)
const ICON = {
  라운드: 'M8 60V26a15 15 0 0 1 30 0v34',
  오벌: 'M8 60V30C8 12 14 6 23 6s15 6 15 24v30',
  라운드스퀘어: 'M8 60V12q0-5 5-5h20q5 0 5 5v48',
  스퀘어: 'M8 60V7h30v53',
  아몬드: 'M8 60V30Q10 10 23 4q13 6 15 26v30',
  코핀: 'M8 60L12 8h22l4 52',
  스틸레토: 'M8 60V36Q12 18 23 2q11 16 15 34v24',
};
const icon = (k) => `<svg viewBox="0 0 46 64" aria-hidden="true"><path d="${ICON[k] || ICON.라운드}" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 50q15 -8 30 0" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".5"/></svg>`;

function render() {
  const r = last, t = r.type;
  const rep = nailReport(t, { life: answers.life, length: answers.length, natural: answers.natural, curve: answers.curve || null });
  drawOverlay(r);
  els.result.classList.remove('hidden');
  els.type.textContent = `${TYPE_KO.width[t.width]}`;
  els.summary.textContent = [TYPE_KO.base[t.base], TYPE_KO.spread[t.spread], TYPE_KO.finger[t.finger], t.length ? TYPE_KO.length[t.length] : null].filter(Boolean).join(' · ') + ` (검지 · 중지 · 약지 ${t.n}개 기준)`;
  const warns = r.issues.filter((x) => x.level !== 'block');
  els.warn.classList.toggle('hidden', !warns.length);
  els.warn.innerHTML = warns.map((x) => `<li><b>${esc(x.title)}</b> ${esc(x.fix)}</li>`).join('');
  els.top.innerHTML = rep.top.map((s, i) => `<div class="nail-shape${i ? '' : ' top'}">${icon(s.key)}<div><b>${i + 1}. ${esc(s.key)}</b> <span class="sc">${s.score}점</span><p>${esc(s.why[0])}</p><p class="sc">${esc(s.d)}</p></div></div>`).join('');
  els.avoid.classList.toggle('hidden', !rep.avoid.length);
  els.avoid.innerHTML = rep.avoid.length ? `<b>피하면 좋은 모양</b> · ${rep.avoid.map((s) => `${esc(s.key)}: ${esc(s.warn[0])}`).join(' / ')}` : '';
  els.tips.innerHTML = [
    `<div class="adv"><b>길이</b><ul>${rep.lengthTip.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul></div>`,
    `<div class="adv"><b>디자인</b><ul>${rep.design.map((d) => `<li><span>${esc(d.k)}</span> <small>${esc(d.t)}</small></li>`).join('')}</ul></div>`,
  ].join('');
  const f2 = (x, d = 2) => (x == null ? '–' : x.toFixed(d));
  els.measures.innerHTML = `<thead><tr><th>손가락</th><th>너비 : 길이</th><th>끝 퍼짐</th><th>큐티클 깊이</th><th>하얀 끝</th></tr></thead><tbody>${r.fingers.map((f) => f.m
    ? `<tr${f.key === 'thumb' ? ' class="muted"' : ''}><th>${esc(f.ko)}${f.key === 'thumb' ? ' <small>(참고)</small>' : ''}</th><td>${f2(f.m.ratio)} : 1</td><td>${f2(f.m.taper)}</td><td>${f2(f.m.cuticle)}</td><td>${Math.round(f.m.free * 100)}%</td></tr>`
    : `<tr class="muted"><th>${esc(f.ko)}</th><td colspan="4">손톱을 찾지 못했어요</td></tr>`).join('')}</tbody>`;
  els.card.textContent = ['[FINDE 손톱 상담 카드]', ...rep.card, '', '* 사진으로 잰 손톱 모양 참고 정보예요 (의학적 진단 아님)'].join('\n');
  window.dispatchEvent(new CustomEvent('beauty:nail'));
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
}
export { TYPE_LINE };
