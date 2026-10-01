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
// 파일 경로 → 벡터. 이전 결과를 모두 담고 시작해, 중간 저장 때도 아직 차례가 오지 않은 결과를 잃지 않는다.
const store = new Map([...cache].map(([f, v]) => [f, Array.from(v)]));
const listed = new Set(list.map((x) => x.file));
const t0 = Date.now();
let computed = 0;
function save() {
  const files = [...store.keys()].filter((f) => listed.has(f) || cache.has(f));
  if (!files.length) return;
  const dim = store.get(files[0]).length;
  const buf = new Float32Array(files.length * dim);
  files.forEach((f, i) => buf.set(store.get(f), i * dim));
  const pos = new Map(list.map((x, i) => [x.file, i]));
  fs.writeFileSync(`${outPrefix}.f32.tmp`, Buffer.from(buf.buffer));
  fs.writeFileSync(`${outPrefix}.json.tmp`, JSON.stringify({ model, dtype, flip, dim, count: files.length, index: files.map((f) => pos.get(f) ?? -1), files }));
  fs.renameSync(`${outPrefix}.f32.tmp`, `${outPrefix}.f32`);   // 원자적 교체 (중간에 멈춰도 파일이 깨지지 않게)
  fs.renameSync(`${outPrefix}.json.tmp`, `${outPrefix}.json`);
}
for (let i = 0; i < list.length; i++) {
  const f = list[i].file;
  if (store.has(f)) continue;
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
    store.set(f, vec); computed++;
  } catch (e) {
    console.warn('skip', f, e.message);
  }
  if (computed && computed % 200 === 0) { console.log(`${i + 1}/${list.length} (+${computed}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`); save(); }
}
save();
console.log(`done ${store.size} (new ${computed}) in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outPrefix}.f32`);
