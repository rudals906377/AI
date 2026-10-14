// UI 제어 — 모델 로드, 입력 처리, 결과 렌더링
import { env } from '@huggingface/transformers';
import { createAnalyzer } from './analyzer.js';
import { LOW_MEM, SAFE_LEVEL, CRASHED, IOS, guardStart, guardEnd, clearSafeMode, decodeScaled, imageDims } from './device.js';
import { createDescriber } from './advanced.js';
import { TAXONOMY, CATEGORY_ORDER } from './taxonomy.js';
import { josa } from './describe.js';
import { buildOrder, swatchText } from './order.js';
import { tattooCard } from './tattoo-advice.js';   // tattooCardImage 는 버튼을 눌렀을 때 import
import { extractColors, COLOR_TARGETS, styleRegions, detectSubjects } from './colors.js';
import { suitsFor } from './suits.js';
import { initHistory } from './history.js';
import { initFaceUI } from './face-ui.js';
import { assetFetch } from './assets.js';
// 공유 이미지 · 결과 이미지 모듈은 버튼을 눌렀을 때 import (첫 로딩을 가볍게)
import { quipFor, manyMessage, subjectNote, WORKING } from './quips.js';

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
if (params.get('designer') === '1') { try { localStorage.setItem('finde-designer', '1'); } catch {} }
let modelKey = MODELS[params.get('model')] ? params.get('model') : 'base';
env.allowLocalModels = false;
// 휴대폰: 추론 뒤 작업 메모리를 돌려주고(아레나 끔), 사진을 조금 작게 다루고, 미리 분석 · 얼굴 모델 선로드를 하지 않는다 (탭이 메모리 초과로 새로 고쳐지는 일을 막기 위해)
let SESSION_OPTS = LOW_MEM ? { enableCpuMemArena: false, enableMemPattern: false } : undefined;
if (params.get('opt')) SESSION_OPTS = { ...(SESSION_OPTS || {}), graphOptimizationLevel: params.get('opt') };   // 고급: ?opt=basic|extended|all|disabled (메모리 실험용)
const IMG_MAX = SAFE_LEVEL >= 2 ? 768 : LOW_MEM ? 896 : 1024;
let currentDevice = null;   // 지금 쓰는 실행 방식 (webgpu | wasm) — 안전 모드 판단용
let afterGuardT = null;     // 결과 뒤 감지 구간 타이머

// ---- DOM ----------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  petMatch: $('petMatch'), analyzing: $('analyzing'), analyzingSub: $('analyzingSub'), subjectNote: $('subjectNote'), quip: $('quip'), quipText: $('quipText'),
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
  inputCard: $('inputCard'), resultCard: $('resultCard'), fab: $('fab'), toast: $('toast'), genreDef: $('genreDef'),
  colorBlock: $('colorBlock'), colorMeta: $('colorMeta'), swatches: $('swatches'),
  orderBlock: $('orderBlock'), orderTo: $('orderTo'), orderGenre: $('orderGenre'), orderRows: $('orderRows'),
  orderChecks: $('orderChecks'), orderNotes: $('orderNotes'), orderCopy: $('orderCopy'), orderSave: $('orderSave'),
  similarBlock: $('similarBlock'), similar: $('similar'), suitsBlock: $('suitsBlock'), suits: $('suits'),
};
// ---- 상태 ---------------------------------------------------------------------
let analyzer = null;      // CLIP
let analyzerLoading = null;
let describer = null;     // VLM (고급 모드)
let describerLoading = null;
let currentBlob = null;   // 현재 선택된 이미지 (Blob)
let currentCategory = 'auto';
let lastResult = null;
let lastOrder = null;     // 시술 요청서 (복사 · 이미지 저장용)
let samples = [];         // 예시 사진 목록 (manifest)
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
    else if (total) setStatus(`${label} 내려받는 중 ${pct}%${total >= 1048576 ? ` (${mb(loaded)}/${mb(total)} MB)` : ''}${firstVisit ? ' · 처음 한 번만 받아요' : ''}`, pct);
    else setStatus(`${label} 로드 중…`, 0);
  };
}
const mb = (b) => { const v = b / 1048576; return v < 10 ? v.toFixed(1) : v.toFixed(0); };
// 처음 방문이면 '처음 한 번만 받아요'를 덧붙인다 (모델은 브라우저에 저장돼 다음부터 바로 열림)
let firstVisit = true;
try { firstVisit = !localStorage.getItem('beauty-visited'); localStorage.setItem('beauty-visited', '1'); } catch {}
// detail: 기술 정보(모델 · 실행 방식)는 화면에는 짧게, 마우스를 올리면(title) 자세히
function setStatus(text, pct = 0, cls = '', detail = '') {
  els.statusText.textContent = text;
  // 사진을 먼저 올려 두고 기다리는 중이면 진행률을 결과 칸에도 보여 준다
  if (!analyzer && currentBlob && cls !== 'error' && !els.analyzing.classList.contains('hidden')) els.analyzingSub.textContent = `${text} — 준비되면 바로 분석해요`;
  els.status.title = detail || text;
  els.statusBar.style.width = `${pct}%`;
  els.status.className = `status ${cls}`;
}

// 예상 못 한 오류: 조용히 멈추지 않게 알리고, '분석 중' 상태에 갇히지 않게 푼다
window.addEventListener('unhandledrejection', (e) => { const msg = String(e.reason?.message || e.reason || '').slice(0, 120); console.warn('[app] 처리되지 않은 오류', e.reason); if (busy) { busy = false; els.analyzing?.classList.add('hidden'); els.resultCard?.classList.remove('busy'); updateRunButton(); } if (msg && !/AbortError/.test(msg)) toast(`문제가 생겼어요: ${msg} · 다시 시도해 주세요`); });
window.addEventListener('error', (e) => { if (e.message && /out of memory|메모리/i.test(e.message)) toast('메모리가 부족해요. 다른 탭을 닫고 다시 시도해 주세요'); });

// ---- 분석 엔진(ONNX 런타임) 설정 단계 ------------------------------------------------
// iPhone 등에서 엔진이 'no available backend found' 로 못 뜨는 일이 있다. ORT 는 한 번 실패한 초기화를 같은 화면에서 다시 하지 못하므로,
// 실패하면 다음 설정을 기억해 두고 화면을 새로 연다(올려 둔 사진은 이어서 분석). 성공한 설정은 다음 방문에도 그대로 쓴다.
//   ''        : 기본 (iPhone · iPad 는 가벼운 일반 WASM 빌드 + 작업 스레드)
//   'noproxy' : 일반 WASM 빌드, 작업 스레드 없이
//   'webgpu'  : WebGPU (지원할 때만)
//   'asyncify': 라이브러리 기본 WASM 빌드, 작업 스레드 없이
const ORT_STEPS = ['', 'noproxy', 'webgpu', 'asyncify'];
const ORT_KEY = 'finde-ort', PENDING_KEY = 'finde-pending-photo';
let ortStep = '';
try { ortStep = localStorage.getItem(ORT_KEY) || ''; } catch {}
if (params.has('ort')) ortStep = params.get('ort');
if (!ORT_STEPS.includes(ortStep)) ortStep = '';
function applyOrtBuild() {
  try {
    const w = env.backends?.onnx?.wasm, v = env.backends?.onnx?.versions?.web;
    if (!w || !v) return;
    // 일반 빌드(약 14MB)는 WebGPU 용 asyncify 빌드(약 27MB)의 절반이라 휴대폰 메모리에 덜 부담된다. WebGPU 를 쓰지 않을 때만
    const plain = ortStep === 'noproxy' || (ortStep === '' && (IOS || params.get('ortbuild') === 'plain'));
    if (plain) { const pre = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/`; w.wasmPaths = { mjs: `${pre}ort-wasm-simd-threaded.mjs`, wasm: `${pre}ort-wasm-simd-threaded.wasm` }; }
  } catch (e) { console.warn('[app] WASM 빌드 설정 실패', e); }
}
// 엔진을 못 띄운 경우만 다음 단계로 (네트워크 실패는 제외 — 다시 시도하면 되는 문제)
const isBackendFail = (e) => { const m = String(e?.message || e || ''); return !/Failed to fetch|Load failed|NetworkError|network error|HTTP \d/i.test(m) && /no available backend|initWasm|backend|WebAssembly|wasm|Out of memory|worker/i.test(m); };
async function recoverBackend(e) {
  if (!isBackendFail(e) || params.has('ort')) return false;
  let i = ORT_STEPS.indexOf(ortStep) + 1;
  if (ORT_STEPS[i] === 'webgpu' && !webgpu) i++;
  const next = ORT_STEPS[i];
  if (next == null) { try { localStorage.removeItem(ORT_KEY); } catch {} return false; }   // 다 해 봤으면 다음 방문엔 처음부터
  try { localStorage.setItem(ORT_KEY, next); } catch { return false; }
  setStatus('분석 엔진을 다른 설정으로 다시 준비할게요…', 0, 'loading');
  // 올려 둔 사진은 줄여서 잠깐 맡겨 두었다가 새 화면에서 바로 분석한다
  if (currentBlob) {
    try {
      const bmp = await decodeScaled(currentBlob, 1280);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
      sessionStorage.setItem(PENDING_KEY, c.toDataURL('image/jpeg', 0.9));
    } catch (err) { console.warn('[app] 사진 맡기기 실패', err); }
  }
  guardEnd();   // 일부러 새로 여는 것이라 안전 모드로 치지 않는다
  setTimeout(() => location.reload(), 400);
  return true;
}
async function resumePendingPhoto() {
  let url = null; try { url = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch {}
  if (!url) return;
  try {
    const blob = await (await fetch(url)).blob();
    faceUI.setMode('style', { scroll: false });
    toast('설정을 바꿔 다시 준비했어요. 올린 사진을 이어서 분석해요');
    await pickImage(blob);
  } catch (err) { console.warn('[app] 맡겨 둔 사진 불러오기 실패', err); }
}

// ---- 초기화 -------------------------------------------------------------------
async function init() {
  window.__appStarted = true;
  try {
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
    webgpu = !!adapter;
    f16 = !!adapter?.features?.has('shader-f16');
  } catch { webgpu = false; f16 = false; }
  if (!webgpu) els.advNote.textContent += ' 이 브라우저에서는 느려요 (사진 1장에 수 분).';
  // WebGPU 가 없으면 AI 계산(WASM)을 별도 작업 스레드(worker)에서 돌려, 분석하는 동안에도 화면 스크롤 · 터치가 멈추지 않게 한다
  const noProxy = ortStep === 'noproxy' || ortStep === 'webgpu' || ortStep === 'asyncify';
  if (!noProxy && (!webgpu || params.get('device') === 'wasm' || SAFE_LEVEL >= 1 || (IOS && params.get('device') !== 'webgpu')) && params.get('proxy') !== '0') useWasmProxy();
  applyOrtBuild();
  setWasmThreads();

  els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.model === modelKey));
  await loadSamples();
  // 휴대폰: 스타일 모델(약 94MB, 메모리 600MB 안팎)은 사진을 올릴 때 받는다 — 얼굴 · 손톱만 쓰는 사람은 안 받아도 되게
  if (LOW_MEM && !currentBlob) setStatus('사진을 올리면 분석 모델을 받아요 · 약 94MB, 처음 한 번만', 0, 'ready', '휴대폰에서는 필요할 때 받아 메모리를 아껴요');
  else await loadAnalyzer(modelKey);
  resumePendingPhoto();
}

function useWasmProxy() {
  try { if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.proxy = true; } catch (e) { console.warn('[app] WASM 작업 스레드 설정 실패', e); }
}
// WASM 스레드 수: 사이트가 cross-origin isolated 면 ORT 가 여러 스레드를 쓰는데, WebKit(사파리 · iOS)은 다중 스레드 WASM 으로 긴 추론 중 웹 프로세스가 죽는 일이 있어 1개로 고정. 그 밖은 최대 4개
function setWasmThreads() {
  try {
    const w = env.backends?.onnx?.wasm; if (!w) return;
    const webkitOnly = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/.test(navigator.userAgent);
    w.numThreads = (webkitOnly || IOS || LOW_MEM) ? 1 : Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
    if (params.get('threads')) w.numThreads = Math.max(1, +params.get('threads') || 1);
  } catch (e) { console.warn('[app] WASM 스레드 수 설정 실패', e); }
}
function runtimeFor(key) {
  const mode = webgpu ? (f16 ? 'webgpu_f16' : 'webgpu') : 'wasm';
  const rt = { device: mode === 'wasm' ? 'wasm' : 'webgpu', ...RUNTIME[key][mode] };
  // 안전 모드(지난번 화면이 새로 열림) 또는 iPhone · iPad: WebGPU 대신 CPU(WASM). iOS 18 Safari 의 WebGPU 는 분석 직후 웹 프로세스가 죽는 사례가 있어 기본을 CPU 로 둔다 (?device=webgpu 로 다시 켤 수 있음)
  if (ortStep !== 'webgpu' && (SAFE_LEVEL >= 1 || ortStep === 'noproxy' || (IOS && params.get('device') !== 'webgpu')) && rt.device === 'webgpu') Object.assign(rt, { device: 'wasm', ...RUNTIME[key].wasm });
  // 고급 사용자용 URL 옵션: ?device=wasm&dtype=q8
  if (params.get('device')) rt.device = params.get('device');
  if (params.get('dtype')) { rt.dtype = params.get('dtype'); rt.mb = '?'; }
  return rt;
}
const jsonCache = {};
async function loadJson(url, what) {
  try {
    if (!(url in jsonCache)) { const r = await assetFetch(url); jsonCache[url] = r.ok ? await r.json() : undefined; }
    return jsonCache[url];
  } catch (e) { console.warn(`${what} 없음`, e); return undefined; }
}
// 라벨 문장 임베딩(사전 계산) · 학습된 분류 헤드 — 모델 이름으로 찾는다
const loadEmbeddings = (modelId) => loadJson(`./embeddings/${modelId.split('/').pop()}.json`, '사전 계산 임베딩');
const loadHeads = (modelId) => loadJson(`./heads/${modelId.split('/').pop()}.json`, '학습된 헤드');
// 타투 세부 모티브(장미 · 늑대 …) 문장 임베딩 · 학습 정보
const loadMotifs = (modelId) => loadJson(`./embeddings/motifs-${modelId.split('/').pop()}.json`, '타투 모티브');

// 정밀 모드는 정밀 모델과 기본 모델의 확률을 평균한다 (교차 검증 +2%p). 기본 모델은 짝(partner)으로 메모리에 남겨 둔다
let partner = null;
let fellBack = false;   // WebGPU 로드가 실패해 WASM 으로 내려온 적이 있으면 true
async function makeBase(rt) {
  const m = MODELS.base;
  return createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), heads: await loadHeads(m.id), motifs: await loadMotifs(m.id), regions: styleRegions, sessionOptions: SESSION_OPTS, onProgress: makeProgress(m.label) });
}

async function loadAnalyzer(key) {
  if (analyzerLoading) return analyzerLoading;
  const prev = analyzer; analyzer = null; updateRunButton();
  const m = MODELS[key];
  // 정밀 → 기본: 짝으로 남겨 둔 기본 모델을 그대로 쓴다
  if (key === 'base' && partner) {
    analyzer = partner; partner = null;
    await prev?.dispose?.();
    els.clipName.textContent = `${m.id}`;
    els.modelNote.textContent = `${m.label} · 처음 한 번만 내려받고 브라우저에 캐시됩니다`;
    setStatus('준비 완료 · 사진을 올려 보세요', 100, 'ready', `${m.label}${analyzer.trainedHeads ? ` · 학습 헤드 ${analyzer.trainedHeads}개` : ''}`);
    updateRunButton();
    if (currentBlob) setTimeout(run, 0);
    return;
  }
  let rt = runtimeFor(key);
  currentDevice = rt.device;
  guardStart('load', { device: rt.device });   // 모델을 받다가 화면이 새로 열리면 다음엔 안전 모드로
  els.clipName.textContent = `${m.id} (${rt.device}/${rt.dtype})`;
  els.modelNote.textContent = `${m.label} · ${rt.device === 'webgpu' ? 'WebGPU' : 'WASM'} · ${rt.mb === '?' ? '' : `약 ${rt.mb}MB · `}처음 한 번만 내려받고 브라우저에 캐시됩니다`;
  analyzerLoading = (async () => {
    try {
      try {
        analyzer = await createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), heads: await loadHeads(m.id), motifs: await loadMotifs(m.id), regions: styleRegions, sessionOptions: SESSION_OPTS, onProgress: makeProgress(m.label) });
      } catch (e) {
        if (rt.device !== 'webgpu') throw e;
        console.warn('WebGPU 로드 실패 → WASM 으로 재시도', e);
        rt = { device: 'wasm', ...RUNTIME[key].wasm }; currentDevice = 'wasm';
        fellBack = true;   // 이후 짝 모델도 WASM 으로 (작업 스레드 설정은 첫 세션 전에만 바꿀 수 있어 그대로 둔다)
        els.clipName.textContent = `${m.id} (${rt.device}/${rt.dtype})`;
        analyzer = await createAnalyzer({ model: m.id, device: rt.device, dtype: rt.dtype, labelEmbeddings: await loadEmbeddings(m.id), heads: await loadHeads(m.id), motifs: await loadMotifs(m.id), regions: styleRegions, sessionOptions: SESSION_OPTS, onProgress: makeProgress(m.label) });
      }
      if (key === 'large') {
        // 기본 모델을 이미 쓰고 있었으면 짝으로 남기고, 아니면 이어서 불러온다
        if (prev?.model === MODELS.base.id) partner = prev;
        else {
          await prev?.dispose?.();
          // 두 모델이 다 준비될 때까지는 분석하지 않는다 (먼저 누르면 정밀 모델 혼자 판단하게 되므로)
          const main = analyzer; analyzer = null; updateRunButton();
          setStatus('정밀 모델을 받았어요 · 함께 쓸 기본 모델을 불러오는 중…', 95, 'loading');
          try { partner = await makeBase(fellBack ? { device: 'wasm', ...RUNTIME.base.wasm } : runtimeFor('base')); } catch (e) { console.warn('기본 모델(짝) 로드 실패 → 정밀 모델만 씁니다', e); partner = null; }
          analyzer = main;
        }
      } else await prev?.dispose?.();
      setStatus(`준비 완료 · 사진을 올려 보세요${key === 'large' ? ' (정밀 모드)' : ''}`, 100, 'ready', `${m.label}${key === 'large' && partner ? ' + 기본 모델 함께' : ''} · ${rt.device === 'webgpu' ? 'WebGPU' : 'WASM'}${analyzer.trainedHeads ? ` · 학습 헤드 ${analyzer.trainedHeads}개` : ''}`);
      if (currentBlob) setTimeout(run, 0); // 모델이 준비되기 전에 올려 둔 사진 (또는 모델을 바꾼 경우) 바로 분석
      // 스타일 모델이 준비된 뒤 한가할 때 얼굴 분석 모델(약 20MB)도 미리 받아 둔다 → '내 얼굴 분석'이 바로 열린다
      if (!LOW_MEM) (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => { warmUp().finally(() => faceUI.preload?.()); });   // 휴대폰은 필요할 때 받는다
    } catch (e) {
      console.error(e);
      // 새 모델을 못 불러오면 쓰던 모델로 되돌린다 (정밀 모델이 휴대폰 메모리를 넘는 경우 등)
      if (prev && !analyzer) {
        analyzer = prev;
        modelKey = prev.model === MODELS.large.id ? 'large' : 'base';
        els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.model === modelKey));
        setStatus(`${m.label}을 불러오지 못해 쓰던 모델을 그대로 써요 (${e.message})`, 100, 'ready');
        if (currentBlob && !lastResult) setTimeout(run, 0);
      } else if (await recoverBackend(e)) {
        return;   // 다른 설정으로 화면을 새로 연다
      } else {
        setStatus(`분석 엔진을 시작하지 못했어요. 화면을 새로 고쳐 다시 시도해 주세요 (${String(e.message).slice(0, 160)})`, 0, 'error');
        // 사진을 먼저 올려 두고 기다리던 화면을 정리한다
        els.analyzing.classList.add('hidden');
        els.resultCard.style.minHeight = '';
        if (!lastResult) els.empty.classList.remove('hidden');
      }
    } finally {
      analyzerLoading = null; guardEnd();
      updateRunButton();
    }
  })();
  return analyzerLoading;
}

async function loadSamples() {
  try {
    const list = samples = await (await fetch('./samples/manifest.json')).json();
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
      b.dataset.file = s.file;
      b.addEventListener('click', () => openSample(s));
      els.samples.appendChild(b);
    }
    showSampleTab = show;
    if (cats.length) show(cats[0]);
  } catch (e) { console.warn('samples not available', e); }
}

let showSampleTab = () => {};
// 예시 사진 열기 (예시 목록 · 비슷한 스타일에서 공통)
async function openSample(s) {
  showSampleTab(s.category);
  document.querySelectorAll('.samples button').forEach((x) => x.classList.toggle('active', x.dataset.file === s.file));
  const blob = await (await fetch(`./${s.file}`)).blob();
  await pickImage(blob, s.file);
}

// ---- 입력 처리 ----------------------------------------------------------------
let imageSeq = 0;
let currentSample = null;   // 지금 사진이 예시 사진이면 그 파일 이름 (분석 결과를 다시 쓰려고)
async function setImage(blob, sample = null) {
  guardEnd();   // 사진 고르기가 무사히 끝났다
  if (!blob || !blob.type?.startsWith('image/')) { if (blob) toast('사진 파일만 올릴 수 있어요'); return false; }
  const my = ++imageSeq;
  const small = await downscale(blob, IMG_MAX);
  if (my !== imageSeq) return false;      // 그사이 다른 사진을 골랐으면 이 사진은 버린다 (큰 사진이 늦게 끝나 덮어쓰지 않게)
  currentBlob = small; currentSample = sample;
  if (els.preview.src.startsWith('blob:')) URL.revokeObjectURL(els.preview.src);
  els.preview.src = URL.createObjectURL(currentBlob);
  els.preview.classList.remove('hidden');
  els.dropHint.classList.add('hidden');
  // 미리보기가 다 그려져 화면 높이가 정해진 뒤에 분석한다
  // (그 전에 결과로 스크롤하면 사진 칸이 커지면서 스크롤이 중간에 멈춘다)
  await els.preview.decode().catch(() => {});
  updateRunButton();
  return my === imageSeq;
}
// 큰 사진은 긴 변 기준으로 줄여서 처리 (속도·메모리)
async function downscale(blob, max) {
  try {
    const d = await imageDims(blob);
    if (d && Math.max(d.w, d.h) <= max) return blob;   // 이미 작으면 그대로
    const bmp = await decodeScaled(blob, max);           // 큰 사진은 줄여서 디코딩 (아이폰 48MP 사진을 통째로 풀지 않게)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && !d) { bmp.close?.(); return blob; }   // 크기를 못 읽었는데 디코딩해 보니 작다
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();   // 원본 비트맵은 바로 돌려준다 (휴대폰 메모리)
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    c.width = c.height = 0;
    return out;
  } catch { return blob; }
}
function updateRunButton() { els.run.disabled = !(analyzer && currentBlob); }

// 사용자가 올린 사진은 예시 사진처럼 바로 분석한다 (모델이 준비된 경우)
async function pickImage(blob, sample = null) {
  if (!(await setImage(blob, sample))) return;
  if (currentBlob) showResultArea();
  if (analyzer && currentBlob) run();
  else if (currentBlob) { showWaiting(); if (!analyzerLoading) loadAnalyzer(modelKey).catch(() => {}); }   // 휴대폰: 이때 모델을 받고, 받자마자 분석 (loadAnalyzer 가 run 을 이어 부른다)
}
// 휴대폰: 사진을 고른 그 순간(사용자가 직접 한 동작) 결과 칸으로 한 번만 내려 준다.
// 분석이 끝났을 때는 움직이지 않는다 — 기다리는 동안 사용자가 스크롤했다면 그 자리를 지킨다
function showResultArea() {
  if (window.innerWidth >= 900) return;
  const top = els.resultCard.getBoundingClientRect().top;
  // 결과가 아직 짧으면 결과 칸 맨 위까지 내려가지 못하므로, 분석하는 동안 화면 높이만큼 자리를 잡아 둔다 (끝나면 run 이 푼다)
  els.resultCard.style.minHeight = `${window.innerHeight}px`;
  if (top > window.innerHeight * 0.45 || top < -8) els.resultCard.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
// 모델이 준비되기 전에 사진을 올렸을 때: 받은 사진은 그대로 두고, 준비 진행률을 보여 주다가 끝나면 바로 분석한다 (loadAnalyzer 가 이어서 run)
function showWaiting() {
  els.empty.classList.add('hidden');
  els.analyzing.classList.remove('hidden');
  els.analyzing.querySelector('b').textContent = '사진을 받았어요 · AI를 준비하는 중이에요';
  els.analyzingSub.textContent = `${els.statusText.textContent} — 준비되면 바로 분석해요`;
}
for (const b of [els.pickBtn, els.cameraBtn, els.drop]) b?.addEventListener('click', () => guardStart('pick'));   // 사진을 고르는 동안 화면이 새로 열리면 안전 모드로
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
  if (analyzer && currentBlob) { showResultArea(); run(); }
});
els.model.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.model === modelKey || analyzerLoading) return;
  if (busy) { toast('분석이 끝난 뒤에 모델을 바꿀 수 있어요'); return; }
  modelKey = b.dataset.model;
  els.model.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  await loadAnalyzer(modelKey);
});
els.run.addEventListener('click', () => { showResultArea(); run(); });
els.advanced.addEventListener('change', () => { if (els.advanced.checked) ensureDescriber().catch(() => {}); });

// ---- 분석 실행 ----------------------------------------------------------------
const sampleCache = new Map();
function rememberSample(key, r) {
  const { run_id, blob, ...keep } = r;
  sampleCache.set(key, structuredClone(keep));   // 수정(피드백)으로 화면 결과를 고쳐도 저장본은 그대로
  if (sampleCache.size > 40) sampleCache.delete(sampleCache.keys().next().value);
}
// 모델이 준비된 뒤 한가할 때 예시 사진 한 장을 미리 분석해 둔다:
// 첫 분석에만 드는 준비 시간(계산 준비 · 부위 찾기 모델 불러오기)을 미리 써 두고, 그 사진을 누르면 결과가 바로 나온다
async function warmUp() {
  if (LOW_MEM || busy || currentBlob || !analyzer || modelKey !== 'base') return;   // 휴대폰에서는 미리 분석하지 않는다 (메모리)
  const s = samples.find((x) => x.category === 'hair') || samples[0];
  if (!s) return;
  try {
    const blob = await downscale(await (await fetch(`./${s.file}`)).blob(), IMG_MAX);
    const key = `${modelKey}|${currentCategory}|${s.file}`;
    if (sampleCache.has(key) || busy) return;
    const subjects = await detectSubjects(blob).catch(() => null);
    if (subjects && subjects.n >= 2) return;
    const r = await analyzer.analyze(blob, { category: currentCategory });
    if (!sampleCache.has(key)) rememberSample(key, r);
  } catch (e) { console.warn('[app] 미리 분석 실패 (괜찮아요)', e); }
}
let busy = false;     // 분석 중 새 요청이 오면 끝난 뒤 마지막 것 하나만 이어서 실행
let pending = false;
let runSeq = 0;
async function run() {
  if (!analyzer || !currentBlob) return;
  if (busy) { pending = true; return; }
  busy = true;
  guardStart('style', { device: currentDevice });
  const seq = ++runSeq;
  els.run.disabled = true;
  els.run.textContent = '분석 중…';
  els.resultCard.classList.add('busy');
  els.analyzingSub.textContent = modelKey === 'large' ? '정밀 모드는 메이크업 사진에서 20~25초 걸릴 수 있어요' : '보통 몇 초면 끝나요';
  els.analyzing.classList.remove('hidden');
  // 분석 중 문구를 돌려 가며 (기다리는 동안 무엇을 보는지)
  let wi = Math.floor(Math.random() * WORKING.length); const wb = els.analyzing.querySelector('b'); wb.textContent = '분석 중입니다…';
  const ticker = setInterval(() => { wb.textContent = WORKING[wi++ % WORKING.length]; }, 1600);
  // 예상 진행 막대: 지난번 걸린 시간(이 기기)으로 어림해 95% 까지 차오르고, 끝나면 100%. 휴대폰(CPU)은 10~20초라 기다리는 느낌을 줄인다
  const bar = $('analyzingBar'), t0 = performance.now();
  let est = 4000; try { est = +localStorage.getItem('finde-run-ms') || (LOW_MEM ? 15000 : 4000); } catch {}
  if (LOW_MEM) els.analyzingSub.textContent = `휴대폰은 CPU 로 계산해서 ${Math.round(est / 1000)}초쯤 걸려요`;
  if (bar) { bar.style.transition = 'none'; bar.style.width = '2%'; }
  const prog = setInterval(() => { if (bar) bar.style.width = `${Math.min(95, 100 * (1 - Math.exp(-(performance.now() - t0) / est)))}%`; }, 200);
  if (!lastResult) els.empty.classList.add('hidden');
  try {
    // 주인공이 여럿이면(여러 사람 · 사람과 동물 · 여러 마리 · 콜라주) 분석하지 않고 안내한다
    let subjects = null;
    const blob = currentBlob;
    // 예시 사진은 한 번 분석한 결과를 다시 쓴다 (같은 모델 · 같은 카테고리 설정이면 결과가 같다) → 다시 누르면 바로
    const key = currentSample ? `${modelKey}|${currentCategory}|${currentSample}` : null;
    const hit = key && sampleCache.get(key);
    if (!hit && SAFE_LEVEL < 1) try { subjects = await detectSubjects(blob); } catch (e) { console.warn('[app] 대상 세기 실패 → 그대로 분석', e); }   // 안전 모드: 대상 세기(부위 인식 모델)도 건너뛴다
    if (subjects && subjects.n >= 2) { showManySubjects(subjects); return; }
    const result = hit ? structuredClone(hit) : await analyzer.analyze(blob, { category: currentCategory, partner: modelKey === 'large' ? partner : null });
    if (key && !hit) rememberSample(key, result);
    result.run_id = seq;
    result.blob = blob;
    if (els.status.classList.contains('error')) setStatus('준비 완료 · 사진을 올려 보세요', 100, 'ready');   // 앞선 오류 문구가 남지 않게   // 이 결과를 낸 사진 (색 · 공유 카드 · 요청서 이미지가 다른 사진과 섞이지 않게)
    lastResult = result;
    render(result);
    if (els.advanced.checked && !pending) await runAdvanced(result);
  } catch (e) {
    console.error(e);
    setStatus(`분석 중 오류: ${e.message}`, 0, 'error');
    if (els.empty.classList.contains('many')) { els.empty.innerHTML = EMPTY_HTML; els.empty.classList.remove('many'); }
  } finally {
    guardStart('after', { device: currentDevice }); clearTimeout(afterGuardT); afterGuardT = setTimeout(guardEnd, 12000);   // 결과가 나온 뒤 몇 초 사이(기록 저장 · 색 뽑기 · GPU 정리)에 화면이 새로 열려도 감지
    busy = false;
    els.resultCard.classList.remove('busy');
    clearInterval(ticker); clearInterval(prog); if (bar) bar.style.width = '100%';
    try { const ms = performance.now() - t0; if (ms > 300) localStorage.setItem('finde-run-ms', String(Math.round(ms))); } catch {}
    els.analyzing.classList.add('hidden');
    if (!pending) els.resultCard.style.minHeight = '';
    if (!lastResult) els.empty.classList.remove('hidden');
    els.run.textContent = '다시 분석하기';
    updateRunButton();
    if (pending) { pending = false; run(); }
  }
}

async function ensureDescriber() {
  if (describer) return describer;
  if (!describerLoading) {
    describerLoading = createDescriber({ device: webgpu ? 'webgpu' : 'wasm', fp16: f16, onProgress: makeProgress('고급 모델') })
      .then((d) => { describer = d; setStatus('준비 완료 · 자유 서술 모드도 켜졌어요', 100, 'ready', '기본 + 고급(자유 서술) 모델'); return d; })
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
// 대상이 여럿인 사진: 이유를 말하고 한 대상만 나온 사진을 부탁한다
const EMPTY_HTML = els.empty.innerHTML;   // '여러 대상' 안내로 바꾼 뒤 되돌릴 원래 문구
function showManySubjects(s) {
  lastResult = null;
  els.result.classList.add('hidden');
  els.empty.classList.remove('hidden');
  // 같은 사진이면 같은 문장, 사진이 다르면 다른 문장 (찾은 상자 크기로 고른다)
  const seed = (s.all || []).reduce((h, d) => (h * 31 + Math.round(d.area * 1e5) + Math.round(d.score * 1e3)) >>> 0, 7);
  const m = manyMessage(s.counts, seed);
  els.empty.innerHTML = `<strong>${esc(m.title)}</strong><small>${esc(m.body)}<br>${esc(m.ask)}</small>`;
  els.empty.classList.add('many');
  faceUI.styleChanged(null);
}

// 반려동물 닮은꼴 헤어 — 털을 사람 머리로 읽어(헤어 기준으로 다시 분석) 닮은 헤어스타일과, 집사 얼굴형에 그 머리를 했을 때의 궁합을 보여 준다
const PET_LINES = ['커플 산책룩의 완성은 헤어 맞춤이죠.', '같은 머리로 찍으면 가족사진이 한층 화목해 보일 거예요.', '미용실에서 "이 친구처럼 해 주세요"라고 사진을 보여 줘도 돼요. 아마 웃으실 거예요.', '털 관리 루틴을 따라 하면 집사님 머릿결도 좋아질지 몰라요.'];
async function renderPet(r) {
  const seq = r.run_id;
  let hr = r;
  if (r.category !== 'hair') { try { hr = await analyzer.analyze(r.blob || currentBlob, { category: 'hair', partner: modelKey === 'large' ? partner : null }); } catch { return; } }
  if (lastResult?.run_id !== seq) return;
  const A = (g) => hr.attributes.find((a) => a.group === g && a.score >= 0.3);
  const len = A('length'), perm = A('perm'), color = A('color');
  const x = r.subject.ko;
  const fit = faceUI.fitFor({ ...hr, is_beauty: true });
  let h = 0; for (const c of hr.headline || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  els.petMatch.innerHTML = `<small>${esc(x)} 닮은꼴 헤어</small><b class="good">사람 머리로 옮기면 → ${esc(hr.genre?.name || hr.headline)}</b>
    <div class="chips">${[len && `길이 ${len.label}`, perm && `결 ${perm.label}`, color && `색 ${color.label}`].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    <p>${fit?.score != null ? `집사님 얼굴형(${esc(fit.title.split(' × ')[1])})에 이 머리를 하면 궁합 ${fit.score}점 — ${esc(fit.verdict)}. ${esc(PET_LINES[h % PET_LINES.length])}` : `집사님도 ${esc(josa(x, '과/와'))} 맞춰 볼까요? 내 얼굴을 분석하면 이 머리와의 궁합을 알려 드려요.`}</p>
    ${fit?.score != null ? '' : '<button class="ghost small" type="button" data-act="face">집사 얼굴 분석하기</button>'}`;
  els.petMatch.querySelector('[data-act="face"]')?.addEventListener('click', () => faceUI.setMode('face'));
  els.petMatch.classList.remove('hidden');
}

function render(r) {
  if (els.empty.classList.contains('many')) els.empty.innerHTML = EMPTY_HTML;
  els.empty.classList.remove('many');
  els.empty.classList.add('hidden');
  els.result.classList.remove('hidden', 'enter');
  void els.result.offsetWidth; // 애니메이션을 다시 시작하려고 한 번 그리게 한다
  els.result.classList.add('enter');
  els.vlmBlock.classList.toggle('hidden', !els.advanced.checked);

  // 사람이 아닌 사진(동물 · 인형)도 분석은 그대로 하고, 맨 위에 한마디
  els.subjectNote.classList.toggle('hidden', !r.subject);
  els.petMatch.classList.add('hidden');
  if (r.subject?.type === 'animal') renderPet(r);
  if (r.subject) { let hs = 0; for (const c of `${r.subject.ko}|${r.headline}`) hs = (hs * 31 + c.charCodeAt(0)) >>> 0; els.subjectNote.innerHTML = subjectNote(esc(r.subject.ko), hs, josa); }

  const top = r.category_ranking[0];
  els.catChips.innerHTML = r.category_ranking
    .map((c, i) => `<span class="chip ${i ? 'muted' : ''}">${c.label} ${pct(c.score)}</span>`)
    .join('') + (r.category_auto ? '' : `<span class="chip muted">카테고리 수동 선택: ${r.category_label}</span>`);
  if (r.category_auto && top.key !== r.category) els.catChips.innerHTML += '';

  if (!r.is_beauty && !r.subject) els.catChips.innerHTML = `<span class="chip warn">뷰티 사진이 아닐 수 있어요 (${pct(1 - r.beauty_score)})</span>` + els.catChips.innerHTML;
  for (const w of r.warnings || []) els.catChips.innerHTML += `<span class="chip warn">${esc(w)}</span>`;
  // 함께 보이는 스타일 (예: 헤어 사진 속 메이크업)
  const sec = r.secondary;
  els.secondary.classList.toggle('hidden', !sec);
  if (sec) {
    els.secTitle.innerHTML = `함께 보이는 ${esc(sec.category_label)}: <b>${esc(sec.genre.name)}</b><small>${pct(sec.score)}</small>`;
    els.secDesc.innerHTML = paragraphsHtml(sec);
    els.secTags.innerHTML = [...(sec.trends || []).map((t) => t.name), ...sec.tags].slice(0, 8).map((t) => `<span class="chip">#${esc(t.replace(/[\s·()]/g, ''))}</span>`).join('');
    els.secondary.open = false;
  }
  els.headline.textContent = r.headline;
  renderStyleNoticed(r);
  // 장르 (크게) + 옆에 트렌드 키워드
  const g = r.genre;
  els.genreLabel.textContent = `${TAXONOMY[r.category].label} 장르 · ${g.group} ${pct(g.score)}`;
  els.genreName.textContent = g.name;
  els.genreSub.textContent = [g.second ? `${g.second} 요소도 보임` : '', g.sub, g.info].filter(Boolean).join(' · ');
  // 장르 이름이 된 속성의 용어 설명
  const ga = r.attributes.find((a) => a.group_label === g.group && g.name.includes(a.label));
  els.genreDef.textContent = ga ? defOf(r.category, ga.group, ga.label) : '';
  els.trends.innerHTML = (r.trends || []).map((t) => `<span class="trend"><b>#${esc(t.name.replace(/[\s·()]/g, ''))}</b><small>${esc(t.why)}</small></span>`).join('');
  els.trendBlock.classList.toggle('hidden', !(r.trends || []).length);
  els.desc.innerHTML = paragraphsHtml(r);
  // 에디터 한마디: 같은 사진이면 같은 문장 (헤드라인 + 속성 확률로 고르므로 같은 장르라도 사진마다 다르다)
  let h = 0; for (const c of `${r.headline}|${r.attributes.map((a) => Math.round(a.score * 1000)).join(',')}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  r.quip = quipFor(r.category, { genre: r.genre?.name, labels: r.attributes.filter((a) => a.score >= 0.5).map((a) => a.label),
    sure: (r.genre?.score ?? 0) >= 0.5, subject: r.subject, seed: h });
  els.quipText.textContent = r.quip;
  els.quip.classList.toggle('hidden', !r.quip);
  renderSuits(r);
  faceUI.styleChanged(r);

  els.attrs.innerHTML = r.attributes.map((a) => `
    <div class="attr ${a.level}" data-g="${esc(a.group)}">
      <div class="g">${esc(a.group_label)}${a.region ? `<small class="reg" title="사진에서 이 부분만 잘라 판단했어요">${REGION_KO[a.region] || a.region}</small>` : ''}</div>
      <div class="bar"><i style="width:${Math.max(4, a.score * 100)}%"></i><b><span>${esc(a.label)}</span><small>${pct(a.score)}</small></b></div>
      <button class="fix" title="이 항목 고치기" aria-label="${esc(a.group_label)} 고치기">수정</button>
      ${a.level !== 'low' && defOf(r.category, a.group, a.label) ? `<div class="def">${esc(defOf(r.category, a.group, a.label))}</div>` : ''}
      ${a.family ? `<div class="fam" title="같은 계열 라벨들의 확률을 더한 값이에요">${esc(a.family.label)}로는 <b>${pct(a.family.score)}</b> · ${a.family.members.map((x) => esc(x.label)).join(' · ')}</div>` : ''}
      ${a.motifs?.length ? `<div class="motif" title="도안에 그려진 세부 모티브예요">${a.motifs[0].level === 'low' ? '세부 모티브 후보' : '세부 모티브'}: ${a.motifs.filter((m, i) => i === 0 || m.score >= 0.1).map((m) => `<b>${esc(m.ko)}</b> ${pct(m.score)}`).join(' · ')}</div>` : ''}
      <div class="alts">다음 후보: ${a.alternatives.map((x) => `${esc(x.label)} ${pct(x.score)}`).join(' · ')}</div>
    </div>`).join('');
  renderFeedback(r);

  els.tags.innerHTML = r.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('');
  els.result.dataset.run = r.run_id ?? '';
  els.meta.textContent = `분석 ${r.elapsed_ms}ms · 평균 신뢰도 ${pct(r.confidence)} · ${r.image_size.width}×${r.image_size.height}px`;
  els.json.textContent = JSON.stringify(slim(r), null, 2);

  renderOrder(r, {});
  renderTattoo(r);
  renderSimilar(r);
  startColors(r);
  // 기록(내 기록 탭)은 상담 카드까지 다 만들어진 뒤에 저장한다
  window.dispatchEvent(new CustomEvent('beauty:style', { detail: { result: r, blob: r.blob || currentBlob } }));
}


// ---- 타투 상담 카드 (타투 사진일 때만) -----------------------------------------------------
// 장르 · 모티브 · 컬러 · 부위 · 크기로 예상 시간 · 회차, 부위 · 장르 · 컬러별 알아 둘 것, 상담 질문, 준비, 애프터케어를 정리한다
let lastTattoo = null;
function renderTattoo(r) {
  const box = $('tattooCard'); if (!box) return;
  const card = r.is_beauty && r.category === 'tattoo' ? tattooCard(r, { skin: faceUI.skinInfo?.() || null }) : null;
  lastTattoo = card; r.tattoo = card;
  box.classList.toggle('hidden', !card);
  if (!card) return;
  const designer = (() => { try { return localStorage.getItem('finde-designer') === '1'; } catch { return false; } })();
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join('');
  const pain = card.place ? `<span class="tc-pain" aria-label="통증 참고 ${card.place.pain}/5">${'●'.repeat(card.place.pain)}${'○'.repeat(5 - card.place.pain)}</span> <small>${esc(card.place.painText)}</small>` : '';
  box.innerHTML = `<div class="order-head"><h3>타투 상담 카드</h3><small>타투이스트에게 보여 주세요</small></div>
    ${card.genre ? `<p class="order-genre"><small>원하는 스타일</small><b>${esc(card.genre)}</b></p>` : ''}
    <div class="tc-grid">
      <div class="tc-box"><small>예상 시간 · 회차</small><b>${esc(card.plan.time)}</b><span>${esc(card.plan.sessions)} · ${esc(card.plan.size || '크기 미정')} (${esc(card.plan.cm)})</span></div>
      ${card.place ? `<div class="tc-box"><small>부위 · 통증 참고</small><b>${esc(card.place.name)}${card.place.sure ? '' : ' <em>추정</em>'}</b><span>${pain}</span></div>` : ''}
      ${card.style ? `<div class="tc-box"><small>장르</small><b>${esc(card.style.name)}${card.style.sure ? '' : ' <em>추정</em>'}</b><span>${esc([card.subject, ...card.motifs].filter(Boolean).join(' · ') || '도안은 상담 때')}</span></div>` : ''}
      ${card.color.name ? `<div class="tc-box"><small>컬러</small><b>${esc(card.color.name)}</b><span>${card.color.skinNote ? '피부 톤 발색 안내 아래' : '블랙은 가장 오래 가요'}</span></div>` : ''}
    </div>
    <p class="muted small tc-why">${esc(card.plan.why)}</p>
    ${designer && card.pro.length ? `<div class="tc-pro"><b>타투이스트 메모</b><ul>${li(card.pro)}</ul></div>` : ''}
    <details class="tc-sec" open><summary>미리 알아 둘 것 <small>${esc([card.style?.name, card.place?.name, card.color.name].filter(Boolean).join(' · '))}</small></summary>
      <ul>${li([...(card.style?.points || []), ...(card.place?.points || []), ...card.color.points, ...(card.color.skinNote ? [card.color.skinNote] : [])])}</ul></details>
    <details class="tc-sec"><summary>상담 때 꼭 물어볼 것 <small>${card.ask.length}가지</small></summary><ul class="tc-check">${li(card.ask)}</ul></details>
    <details class="tc-sec"><summary>시술 전 준비</summary><ul>${li(card.prep)}</ul></details>
    <details class="tc-sec"><summary>애프터케어 요약 <small>2~4주</small></summary><ul>${li(card.after)}</ul></details>
    <p class="muted small">통증 · 시간 · 회차는 일반적인 참고 범위예요. 사람과 작가마다 달라서, 실제 시술은 타투이스트와 상담해 정해 주세요.</p>
    <div class="row order-actions"><button class="primary small" id="tattooCopy" type="button">상담 카드 복사</button><button class="ghost small" id="tattooSave" type="button">이미지로 저장</button></div>`;
  box.querySelector('#tattooCopy').addEventListener('click', () => lastTattoo && copy(lastTattoo.text));
  box.querySelector('#tattooSave').addEventListener('click', async (e) => {
    if (!lastTattoo) return;
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const { tattooCardImage } = await import('./tattoo-advice.js');
      const blob = await tattooCardImage(lastTattoo, lastResult?.blob || currentBlob || null, { designer });
      const name = `타투상담카드-${new Date().toISOString().slice(0, 10)}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: '타투 상담 카드' }).catch(() => {}); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('이미지로 저장했어요');
    } catch (err) { console.error(err); toast('이미지를 만들지 못했어요'); } finally { btn.disabled = false; }
  });
}


// 눈여겨본 디테일 · 가장 헷갈린 것: 판정 바로 아래 한 줄로, "AI 가 이런 것까지 봤구나"와 "이건 자신 없어요"를 같이 보여 준다
function renderStyleNoticed(r) {
  const box = $('styleNoticed'); if (!box) return;
  const attrs = (r.attributes || []).filter((a) => !a.all?.[0]?.hidden);
  const seen = attrs.filter((a) => a.score >= 0.6 && !(r.headline || '').includes(a.label)).sort((a, b) => b.score - a.score).slice(0, 3);
  const unsure = attrs.filter((a) => a.score < 0.55 && a.alternatives?.[0]).sort((a, b) => a.score - b.score)[0];
  const parts = [];
  if (seen.length) parts.push(`<span><b>눈여겨본 디테일</b> ${seen.map((a) => `${esc(a.group_label)} <strong>${esc(a.label)}</strong> <small>${pct(a.score)}</small>`).join(' · ')}</span>`);
  if (unsure) parts.push(`<span class="unsure"><b>가장 헷갈린 것</b> ${esc(unsure.group_label)} — ${esc(unsure.label)} ${pct(unsure.score)} 또는 ${esc(unsure.alternatives[0].label)} ${pct(unsure.alternatives[0].score)}</span>`);
  box.innerHTML = parts.join('');
  box.classList.toggle('hidden', !parts.length);
}

// 부위를 잘라 판단한 그룹 표시 (analyzer.js 의 region)
const REGION_KO = { eye: '눈 부분', lip: '입술 부분', face: '얼굴 부분', hair: '머리카락 부분', head: '머리 전체', bangs: '앞머리 부분' };

// 설명 문장: 문단마다 <p>, 확실하지 않은 문장은 흐리게
function paragraphsHtml(r) {
  const hedgy = (x) => /가능성|단정하기 어렵|추정|확실하지 않|헷갈릴/.test(x);
  // 문장은 한 덩어리(.s)로 묶어, 줄 끝에 걸리면 문장째 다음 줄로 넘긴다
  return (r.paragraphs || [r.sentences]).map((p) => `<p>${p.map((x) => `<span class="s${hedgy(x) ? ' hedge' : ''}">${esc(x)}</span>`).join(' ')}</p>`).join('');
}

// ---- 이런 분께 잘 어울려요 ------------------------------------------------------------
function renderSuits(r) {
  const { items } = suitsFor(r);
  r.suits = items.map(({ label, text }) => ({ label, text }));
  els.suitsBlock.classList.toggle('hidden', !items.length);
  els.suits.innerHTML = items.map((x) => `<div class="suit"><b>${esc(x.label)}</b><p>${esc(x.text)}</p>${x.basis ? `<small>근거: ${esc(x.basis)}</small>` : ''}</div>`).join('');
  // 4개 이상이면 3개만 먼저 보이고 '더 보기'로 펼친다
  els.suitsBlock.querySelector('.more-btn')?.remove();
  els.suits.classList.toggle('collapsed', items.length > 3);
  if (items.length > 3) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ghost small more-btn'; b.textContent = `${items.length - 3}개 더 보기`; b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => { const open = els.suits.classList.toggle('collapsed') === false; b.textContent = open ? '접기' : `${items.length - 3}개 더 보기`; b.setAttribute('aria-expanded', String(open)); });
    els.suits.after(b);
  }
}

// ---- 용어 설명 ------------------------------------------------------------------
function defOf(cat, group, label) {
  return TAXONOMY[cat]?.groups.find((g) => g.key === group)?.labels.find((l) => l.ko === label)?.def || '';
}

// ---- 사진 속 색 ------------------------------------------------------------------
const PART = { hair: '머리카락', lip: '입술', eye: '눈두덩', nail: '손톱' };
const NO_COLOR = {
  hair: '머리카락 부분을 찾지 못했어요.',
  makeup: '얼굴을 찾지 못했어요. 정면에 가까운 얼굴 사진에서 색을 뽑을 수 있어요.',
  nail: '손을 찾지 못해 손톱 색을 뽑지 못했어요. 손가락 전체가 보이게 찍으면 뽑을 수 있어요.',
};
// 휴대폰(LOW_MEM): 결과가 나온 몇 초 뒤 부위 인식 모델(MediaPipe)을 더 올리면서 메모리가 넘쳐 화면이 새로 열리는 일이 있어, 색 뽑기는 버튼을 눌렀을 때만 한다
async function startColors(r, { force = false } = {}) {
  const targets = COLOR_TARGETS[r.category];
  els.colorBlock.classList.toggle('hidden', !targets || !r.is_beauty);
  if (!targets || !r.is_beauty) return;
  const blob = r.blob || currentBlob, id = r.run_id;
  els.colorMeta.textContent = '';
  if (LOW_MEM && !force) {
    els.swatches.innerHTML = `<span class="note">사진 속 실제 색은 부위 인식 모델을 하나 더 써요. 휴대폰 메모리를 아끼려고 누를 때만 뽑아요.</span><button type="button" class="ghost small" id="colorsGo">사진 속 색 뽑기</button>`;
    els.swatches.querySelector('#colorsGo').addEventListener('click', () => startColors(r, { force: true }));
    return;
  }
  els.swatches.innerHTML = '<span class="note">색을 뽑는 중…</span>';
  let c = {};
  guardStart('colors', { device: currentDevice });   // 여기서 화면이 새로 열리면 다음부터 안전 모드
  try { c = await extractColors(blob, r.category); } catch (e) { console.warn('색 추출 실패', e); c = null; } finally { guardEnd(); }
  if (lastResult?.run_id !== id) return; // 그새 다른 사진을 분석했다
  if (!c) { els.swatches.innerHTML = '<span class="note">색을 뽑지 못했어요 (부위 인식 모델을 불러오지 못함).</span>'; return; }
  lastResult.colors = c;
  const items = [];
  for (const key of targets) {
    const x = c[key];
    if (!x) continue;
    // 대표색 + (여러 색이 섞여 있으면) 비율별 색 묶음
    const pal = x.palette?.length > 1 ? x.palette : [];
    items.push(`<div class="sw">
      <i style="background:${x.hex}"></i>
      <span><b>${PART[key]}</b>${x.name ? ` ${esc(x.name)} 계열` : ''}
      <small>${x.hex}${x.level ? ` · 약 ${x.level}레벨` : ''}</small>
      ${pal.length ? `<em class="pal">${pal.map((p) => `<i style="background:${p.hex}" title="${p.hex}${p.name ? ` ${esc(p.name)}` : ''}"></i>${pct(p.share)}`).join(' ')}</em>` : ''}</span>
    </div>`);
  }
  els.swatches.innerHTML = items.join('') || `<span class="note">${NO_COLOR[r.category]}</span>`;
  els.json.textContent = JSON.stringify(slim(lastResult), null, 2);
  renderOrder(lastResult, { hair: c.hair, lip: c.lip, eye: c.eye, nail: c.nail });
}

// ---- 시술 요청서 ---------------------------------------------------------------
function renderOrder(r, colors) {
  els.orderBlock.classList.toggle('hidden', !r.is_beauty);
  els.jumpRow.classList.toggle('hidden', !r.is_beauty);
  const o = lastOrder = buildOrder(r, colors);
  // 내 기록용: 요청서 + (얼굴 분석을 했으면) 상담 카드 정보. 색 견본은 사진 색을 뽑은 뒤 다시 오므로 그때 한 번 더 알린다
  r.order = o;
  window.dispatchEvent(new CustomEvent('beauty:order', { detail: { result: r, order: o, face: typeof faceUI !== 'undefined' ? faceUI.consultInfo(r) : null } }));
  els.orderTitle.textContent = o.title;
  els.orderTo.textContent = `${o.to}에게 보여 주세요`;
  els.orderGenre.innerHTML = o.genre ? `<small>원하는 스타일</small><b>${esc(o.genre)}</b>` : '';
  els.orderRows.innerHTML = o.rows.map((x) => `<div class="${x.sure ? 'sure' : 'mid'}">
    <dt>${esc(x.label)}</dt>
    <dd>${esc(x.value)}${x.measured ? ' <small>사진 속 색 기준</small>' : ''}${x.extra ? ` <small>${esc(x.extra)}</small>` : ''}${x.alt ? ` <small class="alt">또는 ${esc(x.alt)}</small>` : ''}${x.swatch ? `<span class="mini"><i style="background:${x.swatch.hex}"></i>${esc(swatchText(x.measured ? { ...x.swatch, name: null } : x.swatch))}</span>` : ''}</dd>
  </div>`).join('');
  els.orderChecks.innerHTML = o.checks.length ? `<b>상담 때 정할 것</b><ul>${o.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
  els.orderNotes.innerHTML = o.notes.length ? `<b>참고</b><ul>${o.notes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
}
els.orderTitle = $('orderTitle');
els.jumpRow = $('jumpRow');
// 요청서는 결과 아래쪽에 있어 바로 보이지 않으므로, 장르 카드 밑 버튼으로 내려간다
let flashTimer;
$('toOrder').addEventListener('click', () => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.orderBlock.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  els.orderBlock.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => els.orderBlock.classList.remove('flash'), 1600);
  els.orderCopy.focus({ preventScroll: true });
});
els.orderCopy.addEventListener('click', () => lastOrder && copy(lastOrder.text));
els.orderSave.addEventListener('click', async () => {
  if (!lastOrder || !currentBlob) return;
  try {
    const face = faceUI.consultInfo(lastResult);
    const blob = await orderImage(lastOrder, lastResult?.blob || currentBlob, face);
    const name = `${face ? '상담카드' : '시술요청서'}-${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    // 휴대폰: 공유 시트(카카오톡 · 메시지 등)로 바로 보낸다
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: lastOrder.title }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('이미지로 저장했어요');
  } catch (e) { console.error(e); toast('이미지를 만들지 못했어요'); }
});

// 요청서 이미지: 사진 + 항목 표를 한 장에 그린다 (매장에 보여 주거나 메시지로 보내기 좋게)
// face: 내 얼굴 분석을 했거나 기억해 두었으면 얼굴형 · 특징 · 궁합 · 피할 스타일을 붙여 '미용실 상담 카드'로 만든다
async function orderImage(o, photo, face = null) {
  await document.fonts?.ready;
  const W = 1080, P = 72, INNER = W - P * 2;
  const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';
  const C = { bg: '#fbf8f3', text: '#2e2622', muted: '#74665a', accent: '#8f6654', line: '#e5dccf' };
  const bmp = await createImageBitmap(photo);
  const s = Math.min(INNER / bmp.width, 900 / bmp.height);
  const iw = Math.round(bmp.width * s), ih = Math.round(bmp.height * s);
  const date = new Date().toLocaleDateString('ko-KR');
  const LABEL_W = 230;

  function wrap(ctx, text, max) {
    const out = []; let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ch.trimStart(); } else line += ch;
    }
    if (line) out.push(line);
    return out;
  }
  // 한 번은 높이만 재고, 한 번은 실제로 그린다
  function draw(ctx, paint) {
    let y = P;
    const text = (t, size, weight, color, x, maxW, lh = 1.45) => {
      ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'top';
      const lines = wrap(ctx, t, maxW);
      lines.forEach((l, i) => paint && ctx.fillText(l, x, y + i * size * lh));
      return lines.length * size * lh;
    };
    y += text(face ? `미용실 상담 카드 · ${o.title.replace('시술 요청서 · ', '')}` : o.title, 46, 700, C.text, P, INNER) + 4;
    y += text(`FINDE · ${date} · ${o.to}에게 보여 주세요`, 24, 400, C.muted, P, INNER) + 28;
    if (paint) {
      ctx.save(); ctx.beginPath(); ctx.roundRect(P + (INNER - iw) / 2, y, iw, ih, 16); ctx.clip();
      ctx.drawImage(bmp, P + (INNER - iw) / 2, y, iw, ih); ctx.restore();
    }
    y += ih + 36;
    if (o.genre) {
      y += text('원하는 스타일', 24, 600, C.accent, P, INNER) + 2;
      y += text(o.genre, 40, 700, C.text, P, INNER) + 24;
    }
    for (const x of o.rows) {
      if (paint) { ctx.fillStyle = C.line; ctx.fillRect(P, y, INNER, 2); }
      y += 18;
      const top = y;
      text(x.label, 27, 500, C.muted, P, LABEL_W);
      let v = x.value + (x.measured ? ' (사진 속 색 기준)' : '') + (x.extra ? ` (${x.extra})` : '') + (x.alt ? ` / ${x.alt}일 수도 있음` : '');
      let h = text(v, 30, 600, C.text, P + LABEL_W, INNER - LABEL_W);
      if (x.swatch) {
        y = top + h + 6;
        if (paint) { ctx.fillStyle = x.swatch.hex; ctx.beginPath(); ctx.roundRect(P + LABEL_W, y + 2, 30, 30, 8); ctx.fill(); }
        const sh = text(swatchText(x.measured ? { ...x.swatch, name: null } : x.swatch), 24, 400, C.muted, P + LABEL_W + 42, INNER - LABEL_W - 42);
        h += 6 + Math.max(sh, 34);
      }
      y = top + Math.max(h, 40) + 14;
    }
    if (face) {
      // 내 얼굴 정보 상자: 한 번은 높이만 재고(paint 없이), 배경을 깐 뒤 그린다
      const pad = 28, top = y + 20;
      const body = (on) => {
        y = top + pad;
        const add = (str, size, weight, color, gap = 6) => {
          ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'top';
          const lines = wrap(ctx, str, INNER - pad * 2);
          if (on) lines.forEach((l, i) => ctx.fillText(l, P + pad, y + i * size * 1.45));
          y += lines.length * size * 1.45 + gap;
        };
        add('내 얼굴', 24, 600, C.accent, 2);
        add(face.headline, 36, 700, C.text, 8);
        if (face.traits.length) add(face.traits.join(' · '), 26, 400, C.text, 10);
        if (face.ear) add(`귀: ${face.ear}`, 26, 400, C.text, 10);
        if (face.fit) add(`이 스타일과의 궁합 ${face.fit.score}점 — ${face.fit.verdict}`, 28, 700, C.accent, 6);
        for (const r of (face.fit?.reasons || []).slice(0, 3)) add(`${r.pts > 0 ? '✓' : '△'} ${r.text}`, 24, 400, C.text, 4);
        if (face.avoid.length) { y += 8; add('피하고 싶은 것', 24, 600, C.accent, 2); for (const x of face.avoid) add(`· ${x}`, 24, 400, C.text, 4); }
        return y - top + pad;
      };
      const h = body(false);
      if (paint) { ctx.fillStyle = '#f3ebe2'; ctx.beginPath(); ctx.roundRect(P, top, INNER, h, 20); ctx.fill(); body(true); }
      y = top + h + 8;
    }
    for (const [head, list] of [['상담 때 정할 것', o.checks], ['참고', o.notes]]) {
      if (!list.length) continue;
      y += 24;
      y += text(head, 28, 700, C.text, P, INNER) + 8;
      for (const c of list) y += text(`· ${c}`, 25, 400, C.text, P, INNER) + 6;
    }
    y += 30;
    if (paint) { ctx.fillStyle = C.line; ctx.fillRect(P, y, INNER, 2); }
    y += 22;
    y += text('사진을 AI 로 분석한 참고용 요약입니다. 실제 시술은 상담 후 정해 주세요.', 22, 400, C.muted, P, INNER);
    return y + P;
  }
  const probe = document.createElement('canvas').getContext('2d');
  const H = Math.ceil(draw(probe, false));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  draw(ctx, true);
  bmp.close?.();
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

// ---- 비슷한 스타일 ---------------------------------------------------------------
// 예시 사진의 특징값(tools/make-similar.mjs)과 지금 사진의 특징값이 가까운 순서로 3장
const loadSimilar = (modelId) => loadJson(`./samples/similar/${modelId.split('/').pop()}.json`, '예시 사진 특징값');
async function renderSimilar(r) {
  els.similarBlock.classList.add('hidden');
  const data = await loadSimilar(r.model);
  if (!data || data.model !== r.model || lastResult?.run_id !== r.run_id || !r.is_beauty) return;
  data.q ??= new Int8Array(Uint8Array.from(atob(data.data), (ch) => ch.charCodeAt(0)).buffer);
  const v = r.embedding, D = data.dim;
  const byFile = new Map(samples.map((s) => [s.file, s]));
  const top = data.files.map((f, i) => {
    let d = 0;
    for (let j = 0; j < D; j++) d += v[j] * data.q[i * D + j];
    return { s: byFile.get(f), score: d * data.scale[i] };
  }).filter((x) => x.s && x.s.category === r.category && x.score < 0.97) // 0.97 이상은 같은 사진
    .sort((a, b) => b.score - a.score).slice(0, 3);
  if (!top.length) return;
  els.similar.innerHTML = top.map(({ s }) => `<button type="button" data-file="${esc(s.file)}" title="이 예시 사진 분석하기">
    <img src="./${esc(s.thumb || s.file)}" alt="비슷한 ${esc(TAXONOMY[s.category].label)} 예시" loading="lazy" crossorigin="anonymous" /></button>`).join('');
  els.similarBlock.classList.remove('hidden');
}
els.similar.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const s = samples.find((x) => x.file === b.dataset.file);
  if (s) openSample(s);
});

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
    ai_generated: true, generator: 'FINDE', generative_model: r.vlm_model,
    category: r.category, category_label: r.category_label, category_ranking: r.category_ranking.map((c) => ({ key: c.key, score: round(c.score) })),
    genre: r.genre, headline: r.headline, description_ko: r.description_ko, description_vlm: r.description_vlm, description_vlm_en: r.description_vlm_en,
    attributes: r.attributes.map((a) => ({ group: a.group, group_label: a.group_label, label: a.label, label_en: a.label_en, score: round(a.score), level: a.level, ...(a.region ? { region: a.region } : {}),
      ...(a.family ? { family: { label: a.family.label, score: round(a.family.score), level: a.family.level, members: a.family.members.map((x) => x.label) } } : {}),
      ...(a.motifs ? { motifs: a.motifs.map((m) => ({ label: m.ko, parent: m.parent, score: round(m.score), level: m.level })) } : {}),
      alternatives: a.alternatives.map((x) => ({ label: x.label, score: round(x.score) })) })),
    trends: r.trends, tags: r.tags, quip: r.quip, subject: r.subject?.ko ?? null, is_beauty: r.is_beauty, confidence: round(r.confidence), model: r.model, vlm_model: r.vlm_model, elapsed_ms: r.elapsed_ms,
    secondary: r.secondary && { category: r.secondary.category, score: round(r.secondary.score), genre: r.secondary.genre, headline: r.secondary.headline,
      description_ko: r.secondary.description_ko, trends: r.secondary.trends, tags: r.secondary.tags,
      attributes: r.secondary.attributes.map((a) => ({ group: a.group, label: a.label, score: round(a.score), level: a.level })) },
    warnings: r.warnings,
    suits: r.suits,
    colors: r.colors && Object.fromEntries(Object.entries(r.colors).filter(([, v]) => v).map(([k, v]) => [k, { hex: v.hex, name: v.name, level: v.level,
      palette: v.palette?.map((p) => ({ hex: p.hex, name: p.name, share: p.share })) }])),
  };
}
const pct = (x) => `${Math.round(x * 100)}%`;
const round = (x) => Math.round(x * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('shareStyle').addEventListener('click', async (e) => {
  if (!lastResult || !currentBlob) return;
  const b = e.currentTarget; b.disabled = true;
  try {
    const { styleCard, shareImage } = await import('./share-card.js');
    const blob = await styleCard({ photo: lastResult.blob || currentBlob, result: lastResult, fit: faceUI.fitFor(lastResult) });
    const how = await shareImage(blob, `${(lastResult.genre?.name || '스타일').replace(/[\\/:*?"<>|\s]+/g, '-')}.png`, lastResult.headline);
    if (how === 'downloaded') toast('공유 이미지를 저장했어요');
  } catch (err) { console.error(err); toast('공유 이미지를 만들지 못했어요'); } finally { b.disabled = false; }
});
// 결과 이미지로 저장: 화면의 분석 결과(사진 · 판정 · 장르 · 설명 · 속성 · 어울리는 분 · 궁합 · 요청서 요약)를 한 장으로
$('saveResult').addEventListener('click', async (e) => {
  if (!lastResult || !currentBlob) return;
  const b = e.currentTarget; b.disabled = true;
  try {
    const [{ resultImage }, { shareImage }] = await Promise.all([import('./result-image.js'), import('./share-card.js')]);
    const blob = await resultImage({ photo: lastResult.blob || currentBlob, result: lastResult, fit: faceUI.fitFor(lastResult), order: lastOrder, catLabel: TAXONOMY[lastResult.category]?.label || '스타일' });
    const how = await shareImage(blob, `FINDE-${TAXONOMY[lastResult.category]?.label || '스타일'}-분석결과-${new Date().toISOString().slice(0, 10)}.png`, `${lastResult.headline} · 분석 결과`);
    if (how === 'downloaded') toast('결과 이미지를 저장했어요');
  } catch (err) { console.error(err); toast('결과 이미지를 만들지 못했어요'); } finally { b.disabled = false; }
});
els.copyText.addEventListener('click', () => copy(lastResult ? `${lastResult.headline}\n${lastResult.description_ko}\n${lastResult.quip ? `에디터 한마디: ${lastResult.quip}\n` : ''}${lastResult.tags.map((t) => '#' + t).join(' ')}${lastResult.description_vlm ? `\n\n[자유 서술]\n${lastResult.description_vlm}\n\n[원문]\n${lastResult.description_vlm_en}` : ''}\n\n(AI 생성 · FINDE 결과라 틀릴 수 있어요)` : ''));
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
  const updateFab = () => els.fab.classList.toggle('hidden', inputVisible || window.innerWidth >= 900 || !lastResult || document.body.dataset.mode !== 'style' && !!document.body.dataset.mode);
  new IntersectionObserver(([e]) => { inputVisible = e.isIntersecting; updateFab(); }, { threshold: 0.05 }).observe(els.inputCard);
  window.addEventListener('resize', updateFab);
  window.addEventListener('modechange', updateFab);
  window.addEventListener('beauty:style', () => setTimeout(updateFab, 0)); // 첫 결과가 나온 뒤에도 다시 판단
  els.fab.addEventListener('click', () => els.inputCard.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// 내 얼굴 분석 (셀카 → 얼굴형 · 맞춤 헤어 · 메이크업). 스타일 분석 결과와 사진을 넘겨 궁합을 본다
// 내 얼굴 분석의 '원하는 스타일 비교'에서 사진 한 장을 분석한다 (화면의 결과 카드는 바꾸지 않음).
// 인물 사진은 헤어 · 메이크업이 함께 보이므로, 자동 판단이 다른 쪽이어도 비교하려는 카테고리가 2순위 안에 있으면 그 기준으로 다시 본다
async function analyzeStyle(blob, purpose) {
  if (!analyzer) throw new Error('스타일 분석 모델을 준비하는 중이에요');
  let subjects = null;
  try { subjects = await detectSubjects(blob); } catch {}
  if (subjects && subjects.n >= 2) return { many: true };
  const opts = { partner: modelKey === 'large' ? partner : null };
  const r = await analyzer.analyze(blob, { category: 'auto', ...opts });
  if (r.category === purpose || !r.is_beauty) return r;
  const alt = r.category_ranking.find((c) => c.key === purpose);
  return alt && alt.score >= 0.2 ? analyzer.analyze(blob, { category: purpose, ...opts }) : r;
}
initHistory();
// 휴대폰에서 메모리 때문에 화면이 새로 고쳐졌을 때를 위해: 방금(3분 안) 저장된 기록이 있으면 결과가 내 기록에 남아 있다고 알려 준다
(() => {
  try {
    const list = JSON.parse(localStorage.getItem('finde-history-v1') || '[]'); const last = list[list.length - 1];
    if (!last || Date.now() - last.t > 3 * 60 * 1000) return;
    const bar = document.createElement('div'); bar.className = 'recover'; bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>방금 분석한 <b>${last.title ? String(last.title).replace(/[<>&]/g, '') : '결과'}</b>가 내 기록에 저장돼 있어요. 화면이 새로 고쳐졌다면 거기서 바로 볼 수 있어요.</span><button type="button" class="primary small" data-act="open">내 기록 열기</button><button type="button" class="ghost small" data-act="close" aria-label="닫기">닫기</button>`;
    bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.act === 'open') faceUI.setMode('history'); bar.remove(); });
    document.getElementById('modeTabs')?.insertAdjacentElement('afterend', bar);
  } catch {}
})();
// 지난 분석(또는 사진 고르기) 중에 화면이 새로 열렸으면: 다음부턴 안전 모드(CPU · 메모리 절약 · 작은 사진)로 돌고 그 사실을 알린다
if (CRASHED) {
  const bar = document.createElement('div'); bar.className = 'recover'; bar.setAttribute('role', 'status');
  const why = CRASHED.lastKind === 'pick' ? '사진을 고르는 동안' : CRASHED.lastKind === 'load' ? '분석 모델을 받는 동안' : CRASHED.lastKind === 'after' ? '결과가 나온 직후에' : CRASHED.lastKind === 'colors' ? '사진 속 색을 뽑는 동안' : '분석하는 동안';
  const tip = IOS ? ' 아이폰은 다른 앱 안의 브라우저보다 Safari 에서 열면 더 안정적이에요 (아래 나침반 아이콘).' : '';
  bar.innerHTML = `<span>지난번에 ${why} 화면이 새로 열려서, 이번엔 <b>더 가벼운 설정</b>(CPU · 메모리 절약${SAFE_LEVEL >= 2 ? ' · 작은 사진' : ''})으로 분석해요.${tip}</span><button type="button" class="ghost small" data-act="reset">원래 설정으로</button><button type="button" class="ghost small" data-act="close" aria-label="닫기">닫기</button>`;
  bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.act === 'reset') { clearSafeMode(); location.reload(); return; } bar.remove(); });
  document.getElementById('modeTabs')?.insertAdjacentElement('afterend', bar);
}
const faceUI = initFaceUI({ getStyle: () => ({ result: lastResult, blob: lastResult?.blob || currentBlob }), analyzeStyle, openSample: (file, category) => openSample({ file, category }), toast, copy });
// 첫 화면: 주소에 ?mode= 가 있으면 그것, 아니면 지난번에 쓰던 탭, 처음이면 '내 얼굴 분석' (셀카 한 장이 가장 재미있는 입구)
{
  const MODES = ['style', 'face', 'nail', 'history'];
  let saved = null; try { saved = localStorage.getItem('finde-mode'); } catch {}
  const mode = MODES.includes(params.get('mode')) ? params.get('mode') : MODES.includes(saved) ? saved : 'face';
  faceUI.setMode(mode, { scroll: false });
}


// 첫 방문 안내: 셀카 한 장 → FINDE 가 알아챈 것 확인 → 추천 보고 저장 · 공유. 다 하거나 닫으면 다시 보이지 않는다 (?guide=1 로 다시 볼 수 있음)
(function onboarding() {
  const KEY = 'finde-onboard-v2';
  const box = document.getElementById('onboard');
  if (!box) return;
  try { if (localStorage.getItem(KEY) && !params.has('guide')) return; } catch { return; }
  const done = new Set();
  const save = () => { try { localStorage.setItem(KEY, '1'); } catch {} };
  const paint = () => {
    const now = [1, 2, 3].find((n) => !done.has(n));
    box.querySelectorAll('li[data-step]').forEach((li) => {
      const n = +li.dataset.step;
      li.classList.toggle('done', done.has(n));
      li.classList.toggle('now', n === now);
    });
    if (!now) { document.getElementById('obDone').classList.remove('hidden'); save(); }
  };
  const mark = (n) => { if (box.classList.contains('hidden') || done.has(n)) return; done.add(n); paint(); };
  const show = (id) => { const el = document.getElementById(id); if (!el || el.classList.contains('hidden')) return false; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return true; };
  box.classList.remove('hidden');
  paint();
  document.getElementById('obClose').addEventListener('click', () => { box.classList.add('hidden'); save(); });
  box.addEventListener('click', (e) => {
    const act = e.target.closest('[data-ob]')?.dataset.ob;
    if (!act) return;
    faceUI.setMode('face', { scroll: false });
    if (act === 'shoot') document.getElementById('faceShoot')?.click();
    else if (act === 'pick') document.getElementById('facePick')?.click();
    else if (act === 'noticed') { if (!show('faceNoticed')) toast('정면 셀카를 올리면 FINDE 가 알아챈 것이 나와요'); }
    else if (act === 'save') { if (!show('faceImage')) toast('셀카를 분석하면 추천과 저장 버튼이 나와요'); }
  });
  window.addEventListener('beauty:face', () => { mark(1); setTimeout(() => mark(2), 4000); }); // 결과를 잠깐 본 뒤 2단계도 지난 것으로
  for (const id of ['faceImage', 'faceShare', 'facePdf', 'faceCopy']) document.getElementById(id)?.addEventListener('click', () => mark(3));
})();


init();
