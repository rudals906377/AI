// 사진 목록을 비전 모델로 임베딩해 학습·평가용 파일로 저장한다.
//   node tools/embed-images.mjs <list.json> <out-prefix> <model> [dtype] [--flip]
//   list.json : [{ "file": "경로" }, ...]
//   출력      : <out-prefix>.f32 (N×D float32, 정규화됨), <out-prefix>.json (메타)
// 같은 out-prefix 로 다시 실행하면 이미 계산한 사진은 건너뛰고 새 사진만 계산한다 (이어하기).
import fs from 'node:fs';
import { RawImage } from '@huggingface/transformers';
import { loadVisionEncoder, flipHorizontal } from '../encoders.js';

const [listPath, outPrefix, model, dtype = 'fp32', ...rest] = process.argv.slice(2);
const flip = rest.includes('--flip');
const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));

// 이전 결과 불러오기 (파일 경로 → 벡터)
const cache = new Map();
if (fs.existsSync(`${outPrefix}.json`) && fs.existsSync(`${outPrefix}.f32`)) {
  const meta = JSON.parse(fs.readFileSync(`${outPrefix}.json`, 'utf8'));
  if (meta.model === model && meta.dtype === dtype && meta.flip === flip && meta.files) {
    const buf = new Float32Array(fs.readFileSync(`${outPrefix}.f32`).buffer.slice(0));
    meta.files.forEach((f, i) => cache.set(f, buf.subarray(i * meta.dim, (i + 1) * meta.dim)));
    console.log(`resume: ${cache.size} cached`);
  }
}

let enc = null;
const vecs = [], ok = [], files = [];
const t0 = Date.now();
let computed = 0;
function save() {
  if (!vecs.length) return;
  const dim = vecs[0].length;
  const buf = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => buf.set(v, i * dim));
  fs.writeFileSync(`${outPrefix}.f32`, Buffer.from(buf.buffer));
  fs.writeFileSync(`${outPrefix}.json`, JSON.stringify({ model, dtype, flip, dim, count: vecs.length, index: ok, files }));
}
for (let i = 0; i < list.length; i++) {
  const f = list[i].file;
  if (cache.has(f)) { vecs.push(Array.from(cache.get(f))); ok.push(i); files.push(f); continue; }
  try {
    enc ??= await loadVisionEncoder(model, { dtype });
    const img = await RawImage.read(f);
    const [v] = await enc.embed(img);
    let vec = v;
    if (flip) {
      const [w] = await enc.embed(flipHorizontal(img));
      vec = v.map((x, k) => x + w[k]);
      const n = Math.hypot(...vec) || 1;
      vec = vec.map((x) => x / n);
    }
    vecs.push(vec); ok.push(i); files.push(f); computed++;
  } catch (e) {
    console.warn('skip', f, e.message);
  }
  if (computed && computed % 100 === 0) { console.log(`${i + 1}/${list.length} (+${computed}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`); save(); }
}
save();
console.log(`done ${vecs.length} (new ${computed}) in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outPrefix}.f32`);
