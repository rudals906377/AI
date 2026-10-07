// 핵심 분석 모듈 — UI 에 의존하지 않는다 (브라우저 · Node 둘 다 동작)
//
//   const analyzer = await createAnalyzer({ model, labelEmbeddings, heads, onProgress });
//   const result   = await analyzer.analyze(fileOrUrl, { category: 'auto' });
//
// 동작 원리
//   1) 속성 사전의 라벨 문장 임베딩은 미리 계산한 파일을 쓴다 (없으면 텍스트 모델로 계산)
//   2) 사진 1장 = 비전 임베딩 1번 (선택: 좌우 반전 평균)
//   3) 그룹마다 학습된 헤드가 있으면 헤드로, 없으면 제로샷(코사인 유사도)으로 확률 계산
//      메이크업처럼 작은 부위를 보는 그룹은 얼굴 · 눈 · 입술만 잘라낸 임베딩으로 판단한다 (regions 옵션, 헤드 파일의 regions)
//   4) 톤은 컬러 라벨이 가진 톤 정보와 사진에서 직접 읽은 톤을 합쳐 판단
//   5) 한국어 문장 · 해시태그 · SNS 트렌드 키워드 조립 (describe.js)

import { RawImage } from '@huggingface/transformers';
import { TAXONOMY, CATEGORY_ORDER, CONFIDENCE, OTHER_DETECT } from './taxonomy.js';
import { loadVisionEncoder, loadTextEncoder, flipHorizontal, normalize } from './encoders.js';
import { compose } from './describe.js';

export const DEFAULT_MODEL = 'Marqo/marqo-fashionSigLIP'; // 권장 기본 모델 (heads/ · embeddings/ 와 짝)
const LOGIT_SCALE = 100; // 제로샷 소프트맥스 온도 (CLIP 의 exp(logit_scale))

const SECONDARY_MIN = 0.25; // 2위 카테고리 확률이 이 이상이면 '함께 보이는 스타일'로 함께 설명

export async function createAnalyzer({
  model = DEFAULT_MODEL,
  device,          // 'webgpu' | 'wasm' | undefined(자동)
  dtype,           // 'q4' | 'q8' | 'fp16' | 'fp32' | undefined(자동)
  labelEmbeddings, // buildLabelIndex() 결과(JSON). 있으면 텍스트 모델을 내려받지 않는다
  heads,           // tools/train-heads.py 결과(JSON). 있으면 학습된 분류 헤드를 쓴다
  tta = false,     // true 면 좌우 반전 이미지까지 평균 (정확도 ↑, 시간 2배)
  regions,         // (source) => { face?, eye?, lip? : [x0, y0, x1, y1] (0~1 비율) } — 부위 잘라 보기 (없으면 전체 사진으로만 판단)
  onProgress,
} = {}) {
  const progress = (p) => onProgress?.(p);
  const hash = taxonomyHash();
  const usePrecomputed = labelEmbeddings && labelEmbeddings.hash === hash && labelEmbeddings.model === model;
  if (labelEmbeddings && !usePrecomputed) console.warn('[analyzer] 사전 계산 임베딩이 현재 속성 사전과 달라 직접 계산합니다.');
  const useHeads = heads && heads.hash === hash && heads.model === model;
  if (heads && !useHeads) console.warn('[analyzer] 학습된 헤드가 현재 속성 사전·모델과 달라 제로샷으로만 판단합니다.');

  const vision = await loadVisionEncoder(model, { device, dtype, progress_callback: progress });

  let index;
  if (usePrecomputed) index = decodeIndex(labelEmbeddings);
  else {
    progress({ status: 'embedding-labels' });
    index = (await buildLabelIndex({ model, onProgress })).index;
  }
  const headIndex = useHeads ? decodeHeads(heads) : {};
  // 확률 보정 온도 (학습 때 폴드 밖 예측으로 맞춘 값). 표시 확률이 실제 적중률에 가깝도록 한다
  const calib = useHeads ? heads.calib || {} : {};
  // 그룹 → 잘라 볼 부위 (예: 'makeup.eye' → 'eye'). 그 부위의 헤드 · 보정 온도는 '그룹@부위' 키로 저장돼 있다
  const regionOf = useHeads ? heads.regions || {} : {};
  const regionCats = new Set(Object.keys(regionOf).map((k) => k.split('.')[0]));
  progress({ status: 'ready' });

  async function embedImage(source) {
    const image = source instanceof RawImage ? source : await RawImage.read(source);
    const [v] = await vision.embed(image);
    if (!tta) return { image, vec: v };
    const [w] = await vision.embed(flipHorizontal(image));
    return { image, vec: normalize(v.map((x, i) => x + w[i])) };
  }

  // 한 그룹의 확률 분포: 학습 헤드가 있으면 (헤드와 제로샷을 alpha 로 섞어) 사용
  // regionVecs 에 이 그룹이 보는 부위의 임베딩이 있으면 그것으로 판단한다 (제로샷 · 헤드 · 보정 모두 부위 기준)
  function groupProbs(key, vec, textEmbs, regionVecs) {
    const reg = regionOf[key];
    let hk = key;
    if (reg && regionVecs?.[reg]) { vec = regionVecs[reg]; hk = `${key}@${reg}`; }
    const zs = softmax(textEmbs.map((e) => dot(vec, e) * LOGIT_SCALE));
    const h = headIndex[hk];
    let p = zs;
    if (h) {
      const hp = softmax(h.W.map((row, i) => dot(vec, row) + h.b[i]));
      p = hp.map((x, i) => h.alpha * x + (1 - h.alpha) * zs[i]);
    }
    const t = calib[hk];
    return t ? softmax(p.map((x) => Math.log(Math.max(x, 1e-12)) / t)) : p;
  }

  // 한 카테고리의 속성 그룹별 결과 (확률 높은 순 후보 · 신뢰도 단계)
  function attributesFor(cat, vec, topk, regionVecs) {
    const def = TAXONOMY[cat];
    const dist = {};
    for (const g of def.groups) dist[g.key] = groupProbs(`${cat}.${g.key}`, vec, index[cat].groups[g.key], regionVecs);
    fuseTone(def, dist);
    return def.groups.map((g) => {
      const items = g.labels
        .map((l, i) => ({ label: l.ko, label_en: l.en, score: dist[g.key][i], hidden: !!l.hidden, tone: l.tone }))
        .sort((a, b) => b.score - a.score);
      const top = items[0];
      const level = top.score >= CONFIDENCE.high ? 'high' : top.score >= CONFIDENCE.mid ? 'mid' : 'low';
      const reg = regionOf[`${cat}.${g.key}`];
      return { group: g.key, group_label: g.label, label: top.label, label_en: top.label_en, score: top.score, level,
        alternatives: items.slice(1, topk), all: items, ...(reg && regionVecs?.[reg] ? { region: reg } : {}) };
    });
  }

  // 부위 잘라 보기: 얼굴 · 눈 · 입술 상자(0~1 비율)를 받아 그 부분만 임베딩한다. 못 찾으면 null (전체 사진으로 판단)
  async function regionEmbeddings(source, image) {
    if (!regions) return null;
    let boxes = null;
    try { boxes = await regions(source); } catch (e) { console.warn('[analyzer] 부위를 찾지 못해 전체 사진으로 판단합니다', e); }
    if (!boxes) return null;
    const out = {};
    for (const [name, [x0, y0, x1, y1]] of Object.entries(boxes)) {
      const X0 = Math.max(0, Math.floor(x0 * image.width)), Y0 = Math.max(0, Math.floor(y0 * image.height));
      const X1 = Math.min(image.width, Math.ceil(x1 * image.width)), Y1 = Math.min(image.height, Math.ceil(y1 * image.height));
      if (X1 - X0 < 24 || Y1 - Y0 < 16) continue;
      const crop = await image.crop([X0, Y0, X1 - 1, Y1 - 1]);
      const [v] = await vision.embed(crop);
      out[name] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  async function analyze(source, { category = 'auto', topk = 3 } = {}) {
    const t0 = now();
    const { image, vec } = await embedImage(source);

    // 카테고리 판별 (학습 헤드 'category' 가 있으면 함께 사용)
    const detectSims = CATEGORY_ORDER.map((cat) => Math.max(...index[cat].detect.map((e) => dot(vec, e))));
    let catProbs = softmax(detectSims.map((s) => s * LOGIT_SCALE));
    const zsCatProbs = catProbs; // 제로샷 카테고리 확률 (함께 보이는 스타일 판단용: 카테고리마다 따로 보이는 정도)
    if (headIndex.category) {
      const h = headIndex.category;
      const hp = softmax(h.W.map((row, i) => dot(vec, row) + h.b[i]));
      catProbs = catProbs.map((p, i) => h.alpha * hp[i] + (1 - h.alpha) * p);
    }
    const catRanked = CATEGORY_ORDER.map((cat, i) => ({ key: cat, label: TAXONOMY[cat].label, score: catProbs[i] }))
      .sort((a, b) => b.score - a.score);
    // 뷰티 사진 여부: 가장 가까운 뷰티 카테고리 문장 vs '기타' 문장
    let beautyScore = 1;
    if (index.other?.length) {
      const otherSim = Math.max(...index.other.map((e) => dot(vec, e)));
      beautyScore = softmax([Math.max(...detectSims), otherSim].map((x) => x * LOGIT_SCALE))[0];
    }
    if (headIndex.beauty) { // 학습된 뷰티 판별 헤드 (뷰티 vs 기타)
      const h = headIndex.beauty;
      const hp = softmax(h.W.map((row, i) => dot(vec, row) + h.b[i]));
      beautyScore = h.alpha * hp[0] + (1 - h.alpha) * beautyScore;
    }
    const chosen = category === 'auto' ? catRanked[0].key : category;
    const def = TAXONOMY[chosen];
    // 부위 임베딩은 그것을 쓰는 카테고리(메이크업)가 주 · 보조 결과에 나올 때만 계산한다
    const second = CATEGORY_ORDER.map((key, i) => ({ key, score: zsCatProbs[i] })).filter((c) => c.key !== chosen)
      .sort((a, b) => b.score - a.score)[0];
    const needRegions = regionCats.has(chosen) || (category === 'auto' && second && second.score >= SECONDARY_MIN && regionCats.has(second.key));
    const regionVecs = needRegions ? await regionEmbeddings(source, image) : null;
    const attributes = attributesFor(chosen, vec, topk, regionVecs);
    const text = compose(chosen, attributes);
    const confidence = attributes.reduce((s, a) => s + a.score, 0) / attributes.length;

    // 함께 보이는 스타일: 얼굴 사진에는 헤어와 메이크업이 같이 나오는 경우가 많다.
    // 2위 카테고리도 충분히 뚜렷하면 같은 임베딩으로 한 번 더 분석한다 (추가 비용 거의 없음)
    let secondary = null;
    // 학습된 카테고리 헤드는 '주제 하나'를 고르도록 학습돼 2위 확률이 매우 낮다. 그래서 제로샷 확률로 판단한다
    if (category === 'auto' && second && second.score >= SECONDARY_MIN) {
      const attrs2 = attributesFor(second.key, vec, topk, regionVecs);
      const t2 = compose(second.key, attrs2);
      secondary = { category: second.key, category_label: TAXONOMY[second.key].label, score: second.score, attributes: attrs2,
        genre: t2.genre, headline: t2.headline, description_ko: t2.description, sentences: t2.sentences, paragraphs: t2.paragraphs, tags: t2.tags, trends: t2.trends };
    }
    // 사진 품질 안내: 너무 작은 사진은 세부 속성을 읽기 어렵다
    const warnings = [];
    if (Math.min(image.width, image.height) < 224) warnings.push('사진이 작아 세부 판단이 부정확할 수 있어요. 더 큰 사진을 권장합니다.');

    return {
      category: chosen,
      category_label: def.label,
      category_auto: category === 'auto',
      category_ranking: catRanked,
      is_beauty: beautyScore >= 0.5,
      beauty_score: beautyScore,
      attributes,
      headline: text.headline,
      genre: text.genre,
      description_ko: text.description,
      sentences: text.sentences,
      paragraphs: text.paragraphs,
      tags: text.tags,
      trends: text.trends,
      confidence,
      secondary,
      warnings,
      elapsed_ms: Math.round(now() - t0),
      image_size: { width: image.width, height: image.height },
      model,
      trained_heads: Object.keys(headIndex).length,
      regions_used: regionVecs ? Object.keys(regionVecs) : [],
      // 피드백 학습용 특징값 (사진 대신 저장한다). JSON 출력에는 넣지 않는다
      embedding: vec,
      taxonomy_hash: hash,
    };
  }

  return {
    analyze,
    model,
    precomputed: !!usePrecomputed,
    trainedHeads: Object.keys(headIndex).length,
    dispose: () => vision.dispose?.(),
  };
}

// 톤 판정 = 사진에서 직접 읽은 톤(제로샷) 50% + 컬러 라벨이 가진 톤 50%
// (헤어는 '컬러' 그룹, 메이크업은 '립 컬러' 그룹의 tone 정보를 쓴다)
const TONE_KEYS = { cool: '쿨톤', warm: '웜톤', neutral: '뉴트럴' };
export function fuseTone(def, dist) {
  const toneGroup = def.groups.find((g) => g.key === 'tone');
  if (!toneGroup) return;
  const src = def.groups.find((g) => g.key !== 'tone' && g.labels.some((l) => l.tone));
  if (!src) return;
  const prior = { 쿨톤: 0, 웜톤: 0, 뉴트럴: 0 };
  src.labels.forEach((l, i) => { if (l.tone) prior[TONE_KEYS[l.tone]] += dist[src.key][i]; });
  const zs = dist.tone;
  const fused = toneGroup.labels.map((l, i) => 0.5 * zs[i] + 0.5 * (prior[l.ko] ?? 0));
  const s = fused.reduce((a, b) => a + b, 0) || 1;
  dist.tone = fused.map((x) => x / s);
}

// ---- 라벨 임베딩 계산 (오프라인 사전 계산 스크립트와 브라우저 폴백이 공유) ------
export async function buildLabelIndex({ model = DEFAULT_MODEL, dtype = 'fp32', device, onProgress } = {}) {
  const text = await loadTextEncoder(model, { dtype, device, progress_callback: (p) => onProgress?.(p) });
  // 여러 템플릿 문장의 임베딩을 평균 → 정규화 (prompt ensembling)
  async function embedLabelSet(templates, labelsEn) {
    const prompts = [];
    for (const en of labelsEn) for (const t of templates) prompts.push(t.replace('{}', en));
    const embs = await text.embed(prompts);
    return labelsEn.map((_, i) => normalize(meanVec(embs.slice(i * templates.length, (i + 1) * templates.length))));
  }
  const index = {};
  for (const cat of CATEGORY_ORDER) {
    const def = TAXONOMY[cat];
    const groups = {};
    for (const g of def.groups) groups[g.key] = await embedLabelSet(g.templates, g.labels.map((l) => l.en));
    index[cat] = { detect: await text.embed(def.detect), groups };
  }
  index.other = await text.embed(OTHER_DETECT);
  await text.dispose?.();
  return { index, json: encodeIndex(index, model) };
}

// 속성 사전이 바뀌면 사전 계산 파일 · 학습 헤드를 무효화하기 위한 해시
export function taxonomyHash() {
  const src = JSON.stringify([OTHER_DETECT, CATEGORY_ORDER.map((c) => [TAXONOMY[c].detect, TAXONOMY[c].groups.map((g) => [g.key, g.templates, g.labels.map((l) => l.en)])])]);
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
    for (const g of TAXONOMY[cat].groups) { layout[cat].groups[g.key] = index[cat].groups[g.key].length; vecs.push(...index[cat].groups[g.key]); }
  }
  if (index.other) { layout.other = index.other.length; vecs.push(...index.other); } // 맨 끝에 붙인다
  const dim = vecs[0].length;
  const buf = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => buf.set(v, i * dim));
  return { model, hash: taxonomyHash(), dim, count: vecs.length, layout, data: toBase64(new Uint8Array(buf.buffer)) };
}
function decodeIndex(json) {
  const buf = f32FromBase64(json.data);
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
  if (json.layout.other) index.other = Array.from({ length: json.layout.other }, take);
  return index;
}
// 학습 헤드: { groups: { "hair.color": { rows, W(base64 f32 rows×dim), b:[...], alpha } } }
function decodeHeads(json) {
  const out = {};
  for (const [key, h] of Object.entries(json.groups)) {
    const buf = f32FromBase64(h.W);
    const W = Array.from({ length: h.rows }, (_, i) => Array.from(buf.subarray(i * json.dim, (i + 1) * json.dim)));
    out[key] = { W, b: h.b, alpha: h.alpha ?? 1, region: h.region };
  }
  return out;
}
function toBase64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function f32FromBase64(b64) {
  let u8;
  if (typeof Buffer !== 'undefined') u8 = new Uint8Array(Buffer.from(b64, 'base64'));
  else { const s = atob(b64); u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); }
  return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
}

// ---- 수학 유틸 ----------------------------------------------------------------
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
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
