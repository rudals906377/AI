// 타투 세부 모티브(motifs.js)의 문장 임베딩을 미리 계산해 embeddings/motifs-<모델>.json 으로 저장한다.
//   node tools/build-motifs.mjs [모델...]          (motifs.js 를 고쳤다면 다시 실행)
//   DESC_OUT=경로 를 주면 묘사(en)마다 따로 평균한 벡터도 저장한다 (평가 · 조정용)
// 모티브 하나 = (영어 묘사 여러 개 × 템플릿 여러 개) 문장 임베딩의 평균 → 정규화
import fs from 'node:fs';
import { loadTextEncoder } from '../encoders.js';
import { MOTIFS, MOTIF_TEMPLATES } from '../motifs.js';

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['Marqo/marqo-fashionSigLIP', 'Xenova/siglip-large-patch16-384'];
const outDir = process.env.OUT_DIR || new URL('../embeddings/', import.meta.url).pathname;
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const mean = (rows) => rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);

for (const model of MODELS) {
  const t0 = Date.now();
  const text = await loadTextEncoder(model, { dtype: 'fp32' });
  const desc = [];   // [motif index, 묘사 벡터]
  for (const [mi, m] of MOTIFS.entries()) {
    for (const en of m.en) {
      const embs = await text.embed(MOTIF_TEMPLATES.map((t) => t.replace('{}', en)));
      desc.push([mi, norm(mean(embs))]);
    }
  }
  const vecs = MOTIFS.map((_, mi) => norm(mean(desc.filter(([i]) => i === mi).map(([, v]) => v))));
  const dim = vecs[0].length;
  const buf = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => buf.set(v, i * dim));
  const json = { model, dim, count: vecs.length, names: MOTIFS.map((m) => m.ko), data: Buffer.from(buf.buffer).toString('base64') };
  const file = `${outDir}/motifs-${model.split('/').pop()}.json`;
  fs.writeFileSync(file, JSON.stringify(json));
  if (process.env.DESC_OUT) fs.writeFileSync(`${process.env.DESC_OUT}/desc-${model.split('/').pop()}.json`, JSON.stringify({ motif: desc.map(([i]) => i), vecs: desc.map(([, v]) => v) }));
  await text.dispose?.();
  console.log(`${model}: ${vecs.length} motifs × ${dim} → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
}
