// UI 제어 — 모델 로드, 입력 처리, 결과 렌더링
import { env } from '@huggingface/transformers';
import { createAnalyzer } from './analyzer.js';
import { createDescriber } from './advanced.js';
import { TAXONOMY } from './taxonomy.js';

// ---- 설정 -------------------------------------------------------------------
// 기본 분석 모델 후보. 실행 환경(WebGPU 여부)에 따라 dtype 을 고른다.
const MODELS = {
  large: { id: 'Xenova/clip-vit-large-patch14', label: '정밀 · CLIP ViT-L/14' },
  base:  { id: 'Xenova/clip-vit-base-patch16',  label: '빠름 · CLIP ViT-B/16' },
};
// [모델][런타임] → { dtype, MB }  (라벨 임베딩은 미리 계산해 두었으므로 비전 모델만 내려받는다)
const RUNTIME = {
  // 측정: ViT-L q4 는 fp32 대비 속성 일치율 88% (q8 은 83%) 이면서 더 작다 → q4 로 통일
  large: { webgpu_f16: { dtype: 'q4', mb: 194 }, webgpu: { dtype: 'q4', mb: 194 }, wasm: { dtype: 'q4', mb: 194 } },
  base:  { webgpu_f16: { dtype: 'fp16', mb: 173 }, webgpu: { dtype: 'q8', mb: 88 },  wasm: { dtype: 'q8', mb: 88 } },
};
// URL 로 시작 모델 지정 가능: ?model=base (발표 PC 사정에 맞춰 빠르게 전환)
const params = new URLSearchParams(location.search);
let modelKey = MODELS[params.get('model')] ? params.get('model') : 'large';
env.allowLocalModels = false;

// ---- DOM ----------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), statusText: $('statusText'), statusBar: $('statusBar'),
  drop: $('drop'), file: $('file'), preview: $('preview'), dropHint: $('dropHint'),
  samples: $('samples'), category: $('category'), run: $('run'), advanced: $('advanced'), advNote: $('advNote'),
  model: $('model'), modelNote: $('modelNote'),
  empty: $('empty'), result: $('result'), catChips: $('catChips'), headline: $('headline'), desc: $('desc'),
  attrs: $('attrs'), tags: $('tags'), vlmBlock: $('vlmBlock'), vlm: $('vlm'), vlmMeta: $('vlmMeta'), vlmEn: $('vlmEn'), vlmEnBox: $('vlmEnBox'),
  copyText: $('copyText'), copyJson: $('copyJson'), meta: $('meta'), json: $('json'), clipName: $('clipName'),
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
  if (!webgpu) els.advNote.textContent += ' 이 브라우저는 WebGPU 를 지원하지 않아 고급 모드가 매우 느릴 수 있습니다.';

  els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.model === modelKey));
  await loadSamples();
  await loadAnalyzer(modelKey);
}

function runtimeFor(key) {
  const mode = webgpu ? (f16 ? 'webgpu_f16' : 'webgpu') : 'wasm';
  return { device: mode === 'wasm' ? 'wasm' : 'webgpu', ...RUNTIME[key][mode] };
}
const embeddingsCache = {};
async function loadEmbeddings(modelId) {
  const url = `./embeddings/${modelId.split('/').pop()}.json`;
  try { return embeddingsCache[url] ??= await (await fetch(url)).json(); }
  catch (e) { console.warn('사전 계산 임베딩 없음 → 텍스트 모델로 계산', e); return undefined; }
}

async function loadAnalyzer(key) {
  if (analyzerLoading) return analyzerLoading;
  const prev = analyzer; analyzer = null; updateRunButton();
  const m = MODELS[key];
  let rt = runtimeFor(key);
  els.clipName.textContent = `${m.id} (${rt.device}/${rt.dtype})`;
  els.modelNote.textContent = `${m.label} · ${rt.device === 'webgpu' ? 'WebGPU' : 'WASM'} · 약 ${rt.mb}MB (처음 한 번만 내려받고 브라우저에 캐시됩니다)`;
  analyzerLoading = (async () => {
    try {
      try {
        analyzer = await createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), onProgress: makeProgress('기본 모델') });
      } catch (e) {
        if (rt.device !== 'webgpu') throw e;
        console.warn('WebGPU 로드 실패 → WASM 으로 재시도', e);
        rt = { device: 'wasm', ...RUNTIME[key].wasm };
        els.clipName.textContent = `${m.id} (${rt.device}/${rt.dtype})`;
        analyzer = await createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), onProgress: makeProgress('기본 모델') });
      }
      await prev?.dispose?.();
      setStatus(`준비 완료 · ${m.label} · ${rt.device === 'webgpu' ? 'WebGPU' : 'WASM'}`, 100, 'ready');
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
    for (const s of list) {
      const b = document.createElement('button');
      b.title = `${TAXONOMY[s.category]?.label ?? s.category} 예시`;
      b.innerHTML = `<img src="./${s.file}" alt="${b.title}" loading="lazy" />`;
      b.addEventListener('click', async () => {
        document.querySelectorAll('.samples button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const blob = await (await fetch(`./${s.file}`)).blob();
        await setImage(blob);
        if (analyzer) run();
      });
      els.samples.appendChild(b);
    }
  } catch (e) { console.warn('samples not available', e); }
}

// ---- 입력 처리 ----------------------------------------------------------------
async function setImage(blob) {
  if (!blob || !blob.type.startsWith('image/')) return;
  currentBlob = await downscale(blob, 1024);
  els.preview.src = URL.createObjectURL(currentBlob);
  els.preview.classList.remove('hidden');
  els.dropHint.classList.add('hidden');
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

els.file.addEventListener('change', () => setImage(els.file.files[0]));
['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
els.drop.addEventListener('drop', (e) => setImage(e.dataTransfer.files[0]));
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (item) setImage(item.getAsFile());
});
els.category.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  currentCategory = b.dataset.cat;
  els.category.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
});
els.model.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.model === modelKey || analyzerLoading) return;
  modelKey = b.dataset.model;
  els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  await loadAnalyzer(modelKey);
});
els.run.addEventListener('click', run);
els.advanced.addEventListener('change', () => { if (els.advanced.checked) ensureDescriber(); });

// ---- 분석 실행 ----------------------------------------------------------------
async function run() {
  if (!analyzer || !currentBlob) return;
  els.run.disabled = true;
  els.run.textContent = '분석 중…';
  try {
    const result = await analyzer.analyze(currentBlob, { category: currentCategory });
    lastResult = result;
    render(result);
    if (els.advanced.checked) await runAdvanced(result);
  } catch (e) {
    console.error(e);
    alert(`분석 중 오류: ${e.message}`);
  } finally {
    els.run.textContent = '분석하기';
    updateRunButton();
  }
}

async function ensureDescriber() {
  if (describer) return describer;
  if (!describerLoading) {
    describerLoading = createDescriber({ device: webgpu ? 'webgpu' : 'wasm', onProgress: makeProgress('고급 모델') })
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
  try {
    const d = await ensureDescriber();
    els.vlmMeta.textContent = '· 영어로 관찰 중…';
    els.vlmEnBox.open = true;
    const out = await d.describe(currentBlob, result.category, {
      onEnglish: (t) => { els.vlmEn.textContent += t; },
      onKorean: (ko) => { els.vlmMeta.textContent = '· 한국어로 번역 중…'; els.vlm.textContent = ko; },
    });
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
    els.vlm.classList.remove('thinking');
  }
}

// ---- 렌더링 -------------------------------------------------------------------
function render(r) {
  els.empty.classList.add('hidden');
  els.result.classList.remove('hidden');
  els.vlmBlock.classList.toggle('hidden', !els.advanced.checked);

  const top = r.category_ranking[0];
  els.catChips.innerHTML = r.category_ranking
    .map((c, i) => `<span class="chip ${i ? 'muted' : ''}">${TAXONOMY[c.key].icon} ${c.label} ${pct(c.score)}</span>`)
    .join('') + (r.category_auto ? '' : `<span class="chip muted">카테고리 수동 선택: ${r.category_label}</span>`);
  if (r.category_auto && top.key !== r.category) els.catChips.innerHTML += '';

  els.headline.textContent = r.headline;
  els.desc.innerHTML = r.sentences
    .map((s) => (/가능성도|단정하기 어렵|추정/.test(s) ? `<span class="hedge">${esc(s)}</span>` : esc(s)))
    .join(' ');

  els.attrs.innerHTML = r.attributes.map((a) => `
    <div class="attr ${a.level}">
      <div class="g">${esc(a.group_label)}</div>
      <div class="bar"><i style="width:${Math.max(4, a.score * 100)}%"></i><b><span>${esc(a.label)}</span><small>${pct(a.score)}</small></b></div>
      <div class="alts">다음 후보: ${a.alternatives.map((x) => `${esc(x.label)} ${pct(x.score)}`).join(' · ')}</div>
    </div>`).join('');

  els.tags.innerHTML = r.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('');
  els.meta.textContent = `분석 ${r.elapsed_ms}ms · 평균 신뢰도 ${pct(r.confidence)} · ${r.image_size.width}×${r.image_size.height}px`;
  els.json.textContent = JSON.stringify(slim(r), null, 2);
}

// JSON 출력용: 화면 전용 필드 정리
function slim(r) {
  return {
    category: r.category, category_label: r.category_label, category_ranking: r.category_ranking.map((c) => ({ key: c.key, score: round(c.score) })),
    headline: r.headline, description_ko: r.description_ko, description_vlm: r.description_vlm, description_vlm_en: r.description_vlm_en,
    attributes: r.attributes.map((a) => ({ group: a.group, group_label: a.group_label, label: a.label, label_en: a.label_en, score: round(a.score), level: a.level,
      alternatives: a.alternatives.map((x) => ({ label: x.label, score: round(x.score) })) })),
    tags: r.tags, confidence: round(r.confidence), model: r.model, vlm_model: r.vlm_model, elapsed_ms: r.elapsed_ms,
  };
}
const pct = (x) => `${Math.round(x * 100)}%`;
const round = (x) => Math.round(x * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

els.copyText.addEventListener('click', () => copy(lastResult ? `${lastResult.headline}\n${lastResult.description_ko}${lastResult.description_vlm ? `\n\n[AI 자유 서술]\n${lastResult.description_vlm}\n\n[원문]\n${lastResult.description_vlm_en}` : ''}` : ''));
els.copyJson.addEventListener('click', () => copy(els.json.textContent));
async function copy(text) { try { await navigator.clipboard.writeText(text); setStatus('복사했습니다', 100, 'ready'); } catch { /* ignore */ } }

init();
