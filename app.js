// UI 제어 — 모델 로드, 입력 처리, 결과 렌더링
import { env } from '@huggingface/transformers';
import { createAnalyzer } from './analyzer.js';
import { createDescriber } from './advanced.js';
import { TAXONOMY, CATEGORY_ORDER } from './taxonomy.js';
import { josa } from './describe.js';

// ---- 설정 -------------------------------------------------------------------
// 기본 분석 모델 후보 — 검수된 평가 세트(사진 210장)로 6개 모델을 비교해 골랐다 (README 참고)
const MODELS = {
  base:  { id: 'Marqo/marqo-fashionSigLIP',      label: '기본 · FashionSigLIP' },
  large: { id: 'Xenova/siglip-large-patch16-384', label: '정밀 · SigLIP-L/384' },
};
// [모델][런타임] → { dtype, MB }  (라벨 문장 임베딩은 미리 계산해 두었으므로 비전 모델만 내려받는다)
const RUNTIME = {
  base:  { webgpu_f16: { dtype: 'q8', mb: 94 },  webgpu: { dtype: 'q8', mb: 94 },  wasm: { dtype: 'q8', mb: 94 } },
  // 정밀 모델: WebGPU 는 q4(208MB, 빠름), CPU 는 q8(329MB, 정확도 가장 높음)
  large: { webgpu_f16: { dtype: 'q4', mb: 208 }, webgpu: { dtype: 'q4', mb: 208 }, wasm: { dtype: 'q8', mb: 329 } },
};
// URL 로 시작 모델 지정 가능: ?model=base (발표 PC 사정에 맞춰 빠르게 전환)
const params = new URLSearchParams(location.search);
let modelKey = MODELS[params.get('model')] ? params.get('model') : 'base';
env.allowLocalModels = false;

// ---- DOM ----------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), statusText: $('statusText'), statusBar: $('statusBar'),
  drop: $('drop'), file: $('file'), preview: $('preview'), dropHint: $('dropHint'),
  pickBtn: $('pickBtn'), cameraBtn: $('cameraBtn'), camera: $('camera'),
  samples: $('samples'), sampleTabs: $('sampleTabs'), category: $('category'), run: $('run'), advanced: $('advanced'), advNote: $('advNote'),
  model: $('model'), modelNote: $('modelNote'),
  empty: $('empty'), result: $('result'), catChips: $('catChips'), headline: $('headline'), desc: $('desc'),
  attrs: $('attrs'), tags: $('tags'), trends: $('trends'), trendBlock: $('trendBlock'), genreLabel: $('genreLabel'), genreName: $('genreName'), genreSub: $('genreSub'), vlmBlock: $('vlmBlock'), vlm: $('vlm'), vlmMeta: $('vlmMeta'), vlmEn: $('vlmEn'), vlmEnBox: $('vlmEnBox'),
  copyText: $('copyText'), copyJson: $('copyJson'), meta: $('meta'), json: $('json'), clipName: $('clipName'),
  fbCat: $('fbCat'), fbExport: $('fbExport'), fbClear: $('fbClear'), fbInfo: $('fbInfo'),
  secondary: $('secondary'), secTitle: $('secTitle'), secDesc: $('secDesc'), secTags: $('secTags'),
  inputCard: $('inputCard'), resultCard: $('resultCard'), fab: $('fab'), toast: $('toast'),
};
// ---- 상태 ---------------------------------------------------------------------
let analyzer = null;      // CLIP
let analyzerLoading = null;
let describer = null;     // VLM (고급 모드)
let describerLoading = null;
let currentBlob = null;   // 현재 선택된 이미지 (Blob)
let currentCategory = 'auto';
let lastResult = null;
let webgpu = false;       // WebGPU 사용 가능 여부
let f16 = false;          // WebGPU shader-f16 지원 여부

// ---- 진행률 표시 --------------------------------------------------------------
function makeProgress(label) {
  const files = new Map();
  return (p) => {
    if (p.status === 'progress' && p.file) files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    if (p.status === 'done' && p.file && files.has(p.file)) { const f = files.get(p.file); f.loaded = f.total; }
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    const pct = total ? Math.round((loaded / total) * 100) : 0;
    if (p.status === 'embedding-labels') setStatus(`${label}: 속성 사전 임베딩 계산 중…`, 100);
    else if (p.status === 'ready') setStatus(`${label} 준비 완료`, 100, 'ready');
    else if (total) setStatus(`${label} 내려받는 중 ${pct}% (${mb(loaded)}/${mb(total)} MB)`, pct);
    else setStatus(`${label} 로드 중…`, 0);
  };
}
const mb = (b) => (b / 1024 / 1024).toFixed(0);
function setStatus(text, pct = 0, cls = '') {
  els.statusText.textContent = text;
  els.statusBar.style.width = `${pct}%`;
  els.status.className = `status ${cls}`;
}

// ---- 초기화 -------------------------------------------------------------------
async function init() {
  window.__appStarted = true;
  try {
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
    webgpu = !!adapter;
    f16 = !!adapter?.features?.has('shader-f16');
  } catch { webgpu = false; f16 = false; }
  if (!webgpu) els.advNote.textContent += ' 이 브라우저는 WebGPU 를 지원하지 않아 고급 모드가 느립니다 (사진 1장에 수 분).';

  els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.model === modelKey));
  await loadSamples();
  await loadAnalyzer(modelKey);
}

function runtimeFor(key) {
  const mode = webgpu ? (f16 ? 'webgpu_f16' : 'webgpu') : 'wasm';
  const rt = { device: mode === 'wasm' ? 'wasm' : 'webgpu', ...RUNTIME[key][mode] };
  // 고급 사용자용 URL 옵션: ?device=wasm&dtype=q8
  if (params.get('device')) rt.device = params.get('device');
  if (params.get('dtype')) { rt.dtype = params.get('dtype'); rt.mb = '?'; }
  return rt;
}
const jsonCache = {};
async function loadJson(url, what) {
  try {
    if (!(url in jsonCache)) { const r = await fetch(url); jsonCache[url] = r.ok ? await r.json() : undefined; }
    return jsonCache[url];
  } catch (e) { console.warn(`${what} 없음`, e); return undefined; }
}
// 라벨 문장 임베딩(사전 계산) · 학습된 분류 헤드 — 모델 이름으로 찾는다
const loadEmbeddings = (modelId) => loadJson(`./embeddings/${modelId.split('/').pop()}.json`, '사전 계산 임베딩');
const loadHeads = (modelId) => loadJson(`./heads/${modelId.split('/').pop()}.json`, '학습된 헤드');

async function loadAnalyzer(key) {
  if (analyzerLoading) return analyzerLoading;
  const prev = analyzer; analyzer = null; updateRunButton();
  const m = MODELS[key];
  let rt = runtimeFor(key);
  els.clipName.textContent = `${m.id} (${rt.device}/${rt.dtype})`;
  els.modelNote.textContent = `${m.label} · ${rt.device === 'webgpu' ? 'WebGPU' : 'WASM'} · ${rt.mb === '?' ? '' : `약 ${rt.mb}MB · `}처음 한 번만 내려받고 브라우저에 캐시됩니다`;
  analyzerLoading = (async () => {
    try {
      try {
        analyzer = await createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), heads: await loadHeads(m.id), onProgress: makeProgress('기본 모델') });
      } catch (e) {
        if (rt.device !== 'webgpu') throw e;
        console.warn('WebGPU 로드 실패 → WASM 으로 재시도', e);
        rt = { device: 'wasm', ...RUNTIME[key].wasm };
        els.clipName.textContent = `${m.id} (${rt.device}/${rt.dtype})`;
        analyzer = await createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), heads: await loadHeads(m.id), onProgress: makeProgress('기본 모델') });
      }
      await prev?.dispose?.();
      setStatus(`준비 완료 · ${m.label} · ${rt.device === 'webgpu' ? 'WebGPU' : 'WASM'}${analyzer.trainedHeads ? ` · 학습 헤드 ${analyzer.trainedHeads}개` : ''}`, 100, 'ready');
      if (currentBlob) setTimeout(run, 0); // 모델이 준비되기 전에 올려 둔 사진 (또는 모델을 바꾼 경우) 바로 분석
    } catch (e) {
      console.error(e);
      setStatus(`모델 로드 실패: ${e.message}`, 0, 'error');
    } finally {
      analyzerLoading = null;
      updateRunButton();
    }
  })();
  return analyzerLoading;
}

async function loadSamples() {
  try {
    const list = await (await fetch('./samples/manifest.json')).json();
    const cats = CATEGORY_ORDER.filter((c) => list.some((s) => s.category === c));
    // 카테고리 탭: 한 번에 한 카테고리의 예시만 보여 준다 (사진이 많아도 화면이 길어지지 않게)
    const show = (cat) => {
      els.sampleTabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.cat === cat));
      els.samples.querySelectorAll('button').forEach((x) => { x.hidden = x.dataset.cat !== cat; });
    };
    for (const c of cats) {
      const t = document.createElement('button');
      t.dataset.cat = c;
      t.textContent = `${TAXONOMY[c].label} ${list.filter((s) => s.category === c).length}`;
      t.addEventListener('click', () => show(c));
      els.sampleTabs.appendChild(t);
    }
    for (const s of list) {
      const b = document.createElement('button');
      b.dataset.cat = s.category;
      b.title = `${TAXONOMY[s.category]?.label ?? s.category} 예시`;
      // 정적 Space 는 일부 파일을 다른 도메인(CDN)으로 넘겨 주는데, 이 페이지는 교차 출처 격리(COEP) 상태라
      // 일반 img 요청은 막힌다. CORS 모드로 받으면 CDN 이 허용 헤더를 주므로 정상 표시된다.
      // 목록에는 작은 사진(thumb)을 쓰고, 누르면 분석용 사진을 받는다
      b.innerHTML = `<img src="./${s.thumb || s.file}" alt="${b.title}" loading="lazy" crossorigin="anonymous" />`;
      b.addEventListener('click', async () => {
        document.querySelectorAll('.samples button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const blob = await (await fetch(`./${s.file}`)).blob();
        await setImage(blob);
        if (analyzer) run();
      });
      els.samples.appendChild(b);
    }
    if (cats.length) show(cats[0]);
  } catch (e) { console.warn('samples not available', e); }
}

// ---- 입력 처리 ----------------------------------------------------------------
async function setImage(blob) {
  if (!blob || !blob.type.startsWith('image/')) return;
  currentBlob = await downscale(blob, 1024);
  els.preview.src = URL.createObjectURL(currentBlob);
  els.preview.classList.remove('hidden');
  els.dropHint.classList.add('hidden');
  // 미리보기가 다 그려져 화면 높이가 정해진 뒤에 분석한다
  // (그 전에 결과로 스크롤하면 사진 칸이 커지면서 스크롤이 중간에 멈춘다)
  await els.preview.decode().catch(() => {});
  updateRunButton();
}
// 큰 사진은 긴 변 기준으로 줄여서 처리 (속도·메모리)
async function downscale(blob, max) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1) return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  } catch { return blob; }
}
function updateRunButton() { els.run.disabled = !(analyzer && currentBlob); }

// 사용자가 올린 사진은 예시 사진처럼 바로 분석한다 (모델이 준비된 경우)
async function pickImage(blob) {
  await setImage(blob);
  if (analyzer && currentBlob) run();
}
for (const input of [els.file, els.camera]) {
  input.addEventListener('change', () => {
    pickImage(input.files[0]);
    input.value = ''; // 같은 사진을 다시 골라도 동작하게
  });
}
els.pickBtn.addEventListener('click', () => els.file.click());
els.cameraBtn.addEventListener('click', () => els.camera.click());
// 휴대폰 · 태블릿에서는 카메라로 바로 찍는 버튼도 보여 준다
els.cameraBtn.hidden = !matchMedia('(pointer: coarse)').matches;
['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
els.drop.addEventListener('drop', (e) => pickImage(e.dataTransfer.files[0]));
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (item) pickImage(item.getAsFile());
});
els.category.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  currentCategory = b.dataset.cat;
  els.category.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  if (analyzer && currentBlob) run();
});
els.model.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.model === modelKey || analyzerLoading) return;
  modelKey = b.dataset.model;
  els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  await loadAnalyzer(modelKey);
});
els.run.addEventListener('click', run);
els.advanced.addEventListener('change', () => { if (els.advanced.checked) ensureDescriber().catch(() => {}); });

// ---- 분석 실행 ----------------------------------------------------------------
let busy = false;     // 분석 중 새 요청이 오면 끝난 뒤 마지막 것 하나만 이어서 실행
let pending = false;
let runSeq = 0;
async function run() {
  if (!analyzer || !currentBlob) return;
  if (busy) { pending = true; return; }
  busy = true;
  const seq = ++runSeq;
  els.run.disabled = true;
  els.run.textContent = '분석 중…';
  els.resultCard.classList.add('busy');
  try {
    const result = await analyzer.analyze(currentBlob, { category: currentCategory });
    result.run_id = seq;
    lastResult = result;
    render(result);
    if (window.innerWidth < 900) els.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (els.advanced.checked && !pending) await runAdvanced(result);
  } catch (e) {
    console.error(e);
    setStatus(`분석 중 오류: ${e.message}`, 0, 'error');
  } finally {
    busy = false;
    els.resultCard.classList.remove('busy');
    els.run.textContent = '다시 분석하기';
    updateRunButton();
    if (pending) { pending = false; run(); }
  }
}

async function ensureDescriber() {
  if (describer) return describer;
  if (!describerLoading) {
    describerLoading = createDescriber({ device: webgpu ? 'webgpu' : 'wasm', fp16: f16, onProgress: makeProgress('고급 모델') })
      .then((d) => { describer = d; setStatus('기본 + 고급 모델 준비 완료', 100, 'ready'); return d; })
      .catch((e) => { console.error(e); setStatus(`고급 모델 로드 실패: ${e.message}`, 0, 'error'); els.advanced.checked = false; describerLoading = null; throw e; });
  }
  return describerLoading;
}

async function runAdvanced(result) {
  els.vlmBlock.classList.remove('hidden');
  els.vlm.textContent = '';
  els.vlmEn.textContent = '';
  els.vlm.classList.add('thinking');
  els.vlmMeta.textContent = describer ? '· 영어로 관찰 중…' : '· 모델 내려받는 중…';
  let phase = '영어로 관찰 중';
  const t0 = Date.now();
  const timer = setInterval(() => { if (describer) els.vlmMeta.textContent = `· ${phase}… ${Math.round((Date.now() - t0) / 1000)}초`; }, 500);
  try {
    const d = await ensureDescriber();
    els.vlmEnBox.open = true;
    const out = await d.describe(currentBlob, result.category, {
      onEnglish: (t) => { els.vlmEn.textContent += t; },
      onKorean: (ko) => { els.vlm.textContent = ko; },
      onPhase: (p) => { phase = p; },
    });
    clearInterval(timer);
    els.vlm.textContent = out.ko || out.en;
    els.vlmEn.textContent = out.en;
    els.vlmEnBox.open = false;
    els.vlmMeta.textContent = `· 관찰 ${(out.en_ms / 1000).toFixed(1)}초 + 번역 ${(out.ko_ms / 1000).toFixed(1)}초 · ${out.device === 'webgpu' ? 'WebGPU' : 'WASM'}`;
    lastResult = { ...result, description_vlm: out.ko, description_vlm_en: out.en, vlm_model: out.model };
    els.json.textContent = JSON.stringify(slim(lastResult), null, 2);
  } catch (e) {
    console.error(e);
    els.vlm.textContent = `고급 모드 실패: ${e.message}`;
  } finally {
    clearInterval(timer);
    els.vlm.classList.remove('thinking');
  }
}

// ---- 렌더링 -------------------------------------------------------------------
function render(r) {
  els.empty.classList.add('hidden');
  els.result.classList.remove('hidden', 'enter');
  void els.result.offsetWidth; // 애니메이션을 다시 시작하려고 한 번 그리게 한다
  els.result.classList.add('enter');
  els.vlmBlock.classList.toggle('hidden', !els.advanced.checked);

  const top = r.category_ranking[0];
  els.catChips.innerHTML = r.category_ranking
    .map((c, i) => `<span class="chip ${i ? 'muted' : ''}">${c.label} ${pct(c.score)}</span>`)
    .join('') + (r.category_auto ? '' : `<span class="chip muted">카테고리 수동 선택: ${r.category_label}</span>`);
  if (r.category_auto && top.key !== r.category) els.catChips.innerHTML += '';

  if (!r.is_beauty) els.catChips.innerHTML = `<span class="chip warn">뷰티 사진이 아닐 수 있어요 (${pct(1 - r.beauty_score)})</span>` + els.catChips.innerHTML;
  for (const w of r.warnings || []) els.catChips.innerHTML += `<span class="chip warn">${esc(w)}</span>`;
  // 함께 보이는 스타일 (예: 헤어 사진 속 메이크업)
  const sec = r.secondary;
  els.secondary.classList.toggle('hidden', !sec);
  if (sec) {
    els.secTitle.innerHTML = `함께 보이는 ${esc(sec.category_label)}: <b>${esc(sec.genre.name)}</b><small>${pct(sec.score)}</small>`;
    els.secDesc.textContent = sec.description_ko;
    els.secTags.innerHTML = [...(sec.trends || []).map((t) => t.name), ...sec.tags].slice(0, 8).map((t) => `<span class="chip">#${esc(t.replace(/[\s·()]/g, ''))}</span>`).join('');
    els.secondary.open = false;
  }
  els.headline.textContent = r.headline;
  // 장르 (크게) + 옆에 트렌드 키워드
  const g = r.genre;
  els.genreLabel.textContent = `${TAXONOMY[r.category].label} 장르 · ${g.group} ${pct(g.score)}`;
  els.genreName.textContent = g.name;
  els.genreSub.textContent = [g.second ? `${g.second} 요소도 보임` : '', g.sub, g.info].filter(Boolean).join(' · ');
  els.trends.innerHTML = (r.trends || []).map((t) => `<span class="trend"><b>#${esc(t.name.replace(/[\s·()]/g, ''))}</b><small>${esc(t.why)}</small></span>`).join('');
  els.trendBlock.classList.toggle('hidden', !(r.trends || []).length);
  els.desc.innerHTML = r.sentences
    .map((s) => (/가능성|단정하기 어렵|추정|확실하지 않|헷갈릴/.test(s) ? `<span class="hedge">${esc(s)}</span>` : esc(s)))
    .join(' ');

  els.attrs.innerHTML = r.attributes.map((a) => `
    <div class="attr ${a.level}" data-g="${esc(a.group)}">
      <div class="g">${esc(a.group_label)}</div>
      <div class="bar"><i style="width:${Math.max(4, a.score * 100)}%"></i><b><span>${esc(a.label)}</span><small>${pct(a.score)}</small></b></div>
      <button class="fix" title="이 항목 고치기" aria-label="${esc(a.group_label)} 고치기">수정</button>
      <div class="alts">다음 후보: ${a.alternatives.map((x) => `${esc(x.label)} ${pct(x.score)}`).join(' · ')}</div>
    </div>`).join('');
  renderFeedback(r);

  els.tags.innerHTML = r.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('');
  els.result.dataset.run = r.run_id ?? '';
  els.meta.textContent = `분석 ${r.elapsed_ms}ms · 평균 신뢰도 ${pct(r.confidence)} · ${r.image_size.width}×${r.image_size.height}px`;
  els.json.textContent = JSON.stringify(slim(r), null, 2);
}

// ---- 피드백: 틀린 결과 고치기 ------------------------------------------------------
// 사진은 저장하지 않고, 모델이 뽑은 특징값(임베딩)과 고친 라벨만 이 브라우저에 저장한다.
// 내보낸 파일은 tools/train-heads.py --feedback 으로 바로 다시 학습할 수 있다.
const FB_KEY = 'beauty-feedback-v1';
const FB_CATS = [...Object.keys(TAXONOMY).map((k) => [k, TAXONOMY[k].label]), ['other', '뷰티 사진 아님']];
function fbLoad() { try { return JSON.parse(localStorage.getItem(FB_KEY) || '[]'); } catch { return []; } }
function fbSave(list) {
  try { localStorage.setItem(FB_KEY, JSON.stringify(list)); return true; }
  catch { setStatus('피드백을 저장하지 못했어요 (브라우저 저장 공간 부족 또는 차단)', 0, 'error'); return false; }
}
function b64f32(vec) {
  const u8 = new Uint8Array(Float32Array.from(vec).buffer);
  let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fbRecord(r) {
  const list = fbLoad();
  let rec = list.find((x) => x.id === r.fb_id);
  if (!rec) {
    r.fb_id = `${Date.now().toString(36)}-${r.run_id}`;
    rec = { id: r.fb_id, ts: new Date().toISOString(), app: 'beauty-style-describer/1', model: r.model, hash: r.taxonomy_hash,
      predicted: r.category, category: r.category, labels: {}, emb: b64f32(r.embedding) };
    list.push(rec);
  }
  return { list, rec };
}
function fbUpdateInfo() {
  const n = fbLoad().length;
  els.fbInfo.textContent = `${n ? `저장된 피드백 ${n}건 · ` : ''}고친 내용은 사진 없이 특징값만 이 브라우저에 저장됩니다.`;
  els.fbExport.disabled = els.fbClear.disabled = !n;
}
function renderFeedback(r) {
  els.fbCat.innerHTML = FB_CATS.map(([k, label]) => `<option value="${k}" ${k === r.category ? 'selected' : ''}>${label}</option>`).join('');
  const rec = fbLoad().find((x) => x.id === r.fb_id);
  if (rec) {
    els.fbCat.value = rec.category;
    for (const [g, [label]] of Object.entries(rec.labels)) markFixed(g, label);
  }
  fbUpdateInfo();
}
function markFixed(group, label) {
  const row = els.attrs.querySelector(`.attr[data-g="${CSS.escape(group)}"]`);
  if (!row) return;
  row.querySelector('.fixed')?.remove();
  row.insertAdjacentHTML('beforeend', `<div class="fixed">${esc(josa(label, "으로/로"))} 고침</div>`);
}
els.attrs.addEventListener('click', (e) => {
  const btn = e.target.closest('.fix');
  if (!btn || !lastResult) return;
  const row = btn.closest('.attr'); const key = row.dataset.g;
  if (row.querySelector('select')) { row.querySelector('select').remove(); return; }
  const group = TAXONOMY[lastResult.category].groups.find((g) => g.key === key);
  const current = lastResult.attributes.find((a) => a.group === key)?.label;
  const opts = group.labels.filter((l) => !l.hidden || l.ko === '확인 불가')
    .map((l) => `<option value="${esc(l.ko)}" ${l.ko === current ? 'selected' : ''}>${esc(l.ko)}</option>`).join('');
  row.insertAdjacentHTML('beforeend', `<select class="fix-sel" aria-label="${esc(group.label)} 정답 고르기"><option value="">정답을 골라 주세요</option>${opts}</select>`);
  const sel = row.querySelector('select'); sel.focus();
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    const { list, rec } = fbRecord(lastResult);
    if (rec.category !== lastResult.category) { sel.remove(); return; } // 카테고리를 바꾼 뒤에는 이 속성들은 맞지 않음
    rec.labels[key] = [sel.value];
    if (fbSave(list)) { markFixed(key, sel.value); fbUpdateInfo(); }
    sel.remove();
  });
});
els.fbCat.addEventListener('change', () => {
  if (!lastResult) return;
  const { list, rec } = fbRecord(lastResult);
  rec.category = els.fbCat.value;
  if (rec.category !== lastResult.category) {
    rec.labels = {}; // 다른 카테고리의 속성 라벨은 버린다
    els.attrs.querySelectorAll('.fixed').forEach((x) => x.remove());
    setStatus(rec.category === 'other' ? '뷰티 사진이 아니라고 저장했어요' : '카테고리를 고쳤어요. 왼쪽 카테고리 버튼으로 다시 분석하면 속성도 고칠 수 있어요', 100, 'ready');
  }
  if (fbSave(list)) fbUpdateInfo();
});
els.fbExport.addEventListener('click', () => {
  const list = fbLoad();
  if (!list.length) return;
  const blob = new Blob([list.map((x) => JSON.stringify(x)).join('\n') + '\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `beauty-feedback-${new Date().toISOString().slice(0, 10)}.jsonl`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
els.fbClear.addEventListener('click', () => {
  if (!confirm('이 브라우저에 저장된 피드백을 모두 지울까요?')) return;
  try { localStorage.removeItem(FB_KEY); } catch { /* ignore */ }
  els.attrs.querySelectorAll('.fixed').forEach((x) => x.remove());
  fbUpdateInfo();
});

// JSON 출력용: 화면 전용 필드 정리
function slim(r) {
  return {
    category: r.category, category_label: r.category_label, category_ranking: r.category_ranking.map((c) => ({ key: c.key, score: round(c.score) })),
    genre: r.genre, headline: r.headline, description_ko: r.description_ko, description_vlm: r.description_vlm, description_vlm_en: r.description_vlm_en,
    attributes: r.attributes.map((a) => ({ group: a.group, group_label: a.group_label, label: a.label, label_en: a.label_en, score: round(a.score), level: a.level,
      alternatives: a.alternatives.map((x) => ({ label: x.label, score: round(x.score) })) })),
    trends: r.trends, tags: r.tags, is_beauty: r.is_beauty, confidence: round(r.confidence), model: r.model, vlm_model: r.vlm_model, elapsed_ms: r.elapsed_ms,
    secondary: r.secondary && { category: r.secondary.category, score: round(r.secondary.score), genre: r.secondary.genre, headline: r.secondary.headline,
      description_ko: r.secondary.description_ko, trends: r.secondary.trends, tags: r.secondary.tags,
      attributes: r.secondary.attributes.map((a) => ({ group: a.group, label: a.label, score: round(a.score), level: a.level })) },
    warnings: r.warnings,
  };
}
const pct = (x) => `${Math.round(x * 100)}%`;
const round = (x) => Math.round(x * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

els.copyText.addEventListener('click', () => copy(lastResult ? `${lastResult.headline}\n${lastResult.description_ko}\n${lastResult.tags.map((t) => '#' + t).join(' ')}${lastResult.description_vlm ? `\n\n[자유 서술]\n${lastResult.description_vlm}\n\n[원문]\n${lastResult.description_vlm_en}` : ''}` : ''));
els.copyJson.addEventListener('click', () => copy(els.json.textContent));
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('복사했어요'); } catch { toast('복사하지 못했어요'); }
}
let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

// 휴대폰: 결과를 보다가 위로 올라가지 않고도 다른 사진을 고를 수 있게 떠 있는 버튼
if ('IntersectionObserver' in window) {
  let inputVisible = true;
  const updateFab = () => els.fab.classList.toggle('hidden', inputVisible || window.innerWidth >= 900 || !lastResult);
  new IntersectionObserver(([e]) => { inputVisible = e.isIntersecting; updateFab(); }, { threshold: 0.05 }).observe(els.inputCard);
  window.addEventListener('resize', updateFab);
  els.fab.addEventListener('click', () => els.inputCard.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

init();
