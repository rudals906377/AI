// 핵심 분석 모듈 — UI 에 의존하지 않는다 (브라우저 · Node 둘 다 동작)
//
//   const analyzer = await createAnalyzer({ onProgress });
//   const result   = await analyzer.analyze(fileOrUrl, { category: 'auto' });
//
// 동작 원리
//   1) 모델 로드 시 속성 사전의 모든 라벨 문장을 CLIP 텍스트 임베딩으로 한 번만 계산
//   2) 사진 1장 = CLIP 비전 임베딩 1번
//   3) 카테고리 → 그룹별 코사인 유사도 → 소프트맥스 → 한국어 문장 조립

import {
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

import { TAXONOMY, CATEGORY_ORDER, CONFIDENCE } from './taxonomy.js';
import { compose } from './describe.js';

export const DEFAULT_MODEL = 'Xenova/clip-vit-base-patch16';
const LOGIT_SCALE = 100; // CLIP 의 exp(logit_scale)

export async function createAnalyzer({
  model = DEFAULT_MODEL,
  device,          // 'webgpu' | 'wasm' | undefined(자동)
  dtype,           // 'q8' | 'fp16' | 'fp32' | undefined(자동)
  labelEmbeddings, // buildLabelIndex() 결과(JSON). 있으면 텍스트 모델을 내려받지 않는다
  onProgress,
} = {}) {
  const progress = (p) => onProgress?.(p);
  const opts = { progress_callback: progress };
  if (device) opts.device = device;
  if (dtype) opts.dtype = dtype;

  const hash = taxonomyHash();
  const usePrecomputed = labelEmbeddings && labelEmbeddings.hash === hash && labelEmbeddings.model === model;
  if (labelEmbeddings && !usePrecomputed) console.warn('[analyzer] 사전 계산 임베딩이 현재 속성 사전과 달라 직접 계산합니다.');

  const [processor, visionModel] = await Promise.all([
    AutoProcessor.from_pretrained(model, { progress_callback: progress }),
    CLIPVisionModelWithProjection.from_pretrained(model, opts),
  ]);

  // ---- 1) 라벨 임베딩: 사전 계산 파일 사용, 없으면 텍스트 모델로 계산 -----------
  let index;
  if (usePrecomputed) {
    index = decodeIndex(labelEmbeddings);
  } else {
    progress({ status: 'embedding-labels' });
    index = (await buildLabelIndex({ model, dtype, device, onProgress })).index;
  }
  progress({ status: 'ready' });

  // ---- 2) 이미지 임베딩 ---------------------------------------------------
  async function embedImage(source) {
    const image = source instanceof RawImage ? source : await RawImage.read(source);
    const inputs = await processor(image);
    const { image_embeds } = await visionModel(inputs);
    return { image, vec: normalize(image_embeds.tolist()[0]) };
  }

  // ---- 3) 분석 -------------------------------------------------------------
  async function analyze(source, { category = 'auto', topk = 3 } = {}) {
    const t0 = now();
    const { image, vec } = await embedImage(source);

    // 카테고리 판별: 카테고리별 detect 문장 중 최대 유사도 → 소프트맥스
    const catSims = CATEGORY_ORDER.map((cat) => Math.max(...index[cat].detect.map((e) => dot(vec, e))));
    const catProbs = softmax(catSims.map((s) => s * LOGIT_SCALE));
    const catRanked = CATEGORY_ORDER.map((cat, i) => ({ key: cat, label: TAXONOMY[cat].label, score: catProbs[i] }))
      .sort((a, b) => b.score - a.score);
    const chosen = category === 'auto' ? catRanked[0].key : category;

    // 그룹별 속성
    const def = TAXONOMY[chosen];
    const attributes = def.groups.map((g) => {
      const sims = index[chosen].groups[g.key].map((e) => dot(vec, e));
      const probs = softmax(sims.map((s) => s * LOGIT_SCALE));
      const items = g.labels
        .map((l, i) => ({ label: l.ko, label_en: l.en, score: probs[i], sim: sims[i] }))
        .sort((a, b) => b.score - a.score);
      const top = items[0];
      const level = top.score >= CONFIDENCE.high ? 'high' : top.score >= CONFIDENCE.mid ? 'mid' : 'low';
      return {
        group: g.key,
        group_label: g.label,
        label: top.label,
        label_en: top.label_en,
        score: top.score,
        level,
        alternatives: items.slice(1, topk),
        all: items,
      };
    });

    const text = compose(chosen, attributes);
    const confidence = attributes.reduce((s, a) => s + a.score, 0) / attributes.length;

    return {
      category: chosen,
      category_label: def.label,
      category_auto: category === 'auto',
      category_ranking: catRanked,
      attributes,
      headline: text.headline,
      description_ko: text.description,
      sentences: text.sentences,
      tags: text.tags,
      confidence,
      elapsed_ms: Math.round(now() - t0),
      image_size: { width: image.width, height: image.height },
      model,
    };
  }

  return {
    analyze,
    model,
    precomputed: !!usePrecomputed,
    dispose: async () => { await visionModel.dispose?.(); },
  };
}

// ---- 라벨 임베딩 계산 (오프라인 사전 계산 스크립트와 브라우저 폴백이 공유) ------
export async function buildLabelIndex({ model = DEFAULT_MODEL, dtype, device, onProgress } = {}) {
  const progress = (p) => onProgress?.(p);
  const opts = { progress_callback: progress };
  if (device) opts.device = device;
  if (dtype) opts.dtype = dtype;
  const [tokenizer, textModel] = await Promise.all([
    AutoTokenizer.from_pretrained(model, { progress_callback: progress }),
    CLIPTextModelWithProjection.from_pretrained(model, opts),
  ]);
  async function embedTexts(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += 32) {
      const inputs = tokenizer(texts.slice(i, i + 32), { padding: true, truncation: true });
      const { text_embeds } = await textModel(inputs);
      out.push(...text_embeds.tolist().map(normalize));
    }
    return out;
  }
  // 여러 템플릿 문장의 임베딩을 평균 → 정규화 (prompt ensembling)
  async function embedLabelSet(templates, labelsEn) {
    const prompts = [];
    for (const en of labelsEn) for (const t of templates) prompts.push(t.replace('{}', en));
    const embs = await embedTexts(prompts);
    return labelsEn.map((_, i) => normalize(meanVec(embs.slice(i * templates.length, (i + 1) * templates.length))));
  }
  const index = {};
  for (const cat of CATEGORY_ORDER) {
    const def = TAXONOMY[cat];
    const groups = {};
    for (const g of def.groups) groups[g.key] = await embedLabelSet(g.templates, g.labels.map((l) => l.en));
    index[cat] = { detect: await embedTexts(def.detect), groups };
  }
  await textModel.dispose?.();
  return { index, json: encodeIndex(index, model) };
}

// 속성 사전이 바뀌면 사전 계산 파일을 무효화하기 위한 해시
export function taxonomyHash() {
  const src = JSON.stringify(CATEGORY_ORDER.map((c) => [TAXONOMY[c].detect, TAXONOMY[c].groups.map((g) => [g.key, g.templates, g.labels.map((l) => l.en)])]));
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// index ⇄ JSON (Float32 → base64)
function encodeIndex(index, model) {
  const vecs = [];
  const layout = {};
  for (const cat of CATEGORY_ORDER) {
    layout[cat] = { detect: index[cat].detect.length, groups: {} };
    vecs.push(...index[cat].detect);
    for (const [k, arr] of Object.entries(index[cat].groups)) { layout[cat].groups[k] = arr.length; vecs.push(...arr); }
  }
  const dim = vecs[0].length;
  const buf = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => buf.set(v, i * dim));
  return { model, hash: taxonomyHash(), dim, count: vecs.length, layout, data: toBase64(new Uint8Array(buf.buffer)) };
}
function decodeIndex(json) {
  const bytes = fromBase64(json.data);
  const buf = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let k = 0;
  const take = () => Array.from(buf.subarray(k * json.dim, ++k * json.dim));
  const index = {};
  for (const cat of CATEGORY_ORDER) {
    const L = json.layout[cat];
    const detect = Array.from({ length: L.detect }, take);
    const groups = {};
    for (const g of TAXONOMY[cat].groups) groups[g.key] = Array.from({ length: L.groups[g.key] }, take);
    index[cat] = { detect, groups };
  }
  return index;
}
function toBase64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64); const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// ---- 수학 유틸 ----------------------------------------------------------------
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function normalize(v) { const n = Math.sqrt(dot(v, v)) || 1; return v.map((x) => x / n); }
function meanVec(rows) {
  const out = new Array(rows[0].length).fill(0);
  for (const r of rows) for (let i = 0; i < r.length; i++) out[i] += r[i];
  return out.map((x) => x / rows.length);
}
function softmax(xs) {
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp(x - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / s);
}
function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
