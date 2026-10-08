// '비슷한 스타일' 추천용: 예시 사진(samples/manifest.json)의 특징값을 모델마다 미리 계산해 둔다.
//   node tools/make-similar.mjs                      # 두 모델 모두
//   node tools/make-similar.mjs Marqo/marqo-fashionSigLIP
// 출력: samples/similar/<모델 이름>.json  { model, dim, files, data(int8 base64), scale[] }
// 예시 사진을 바꾸면 (tools/make-samples.py) 이 스크립트도 다시 실행한다.
import fs from 'node:fs';
import path from 'node:path';
import { RawImage } from '@huggingface/transformers';
import { loadVisionEncoder } from '../encoders.js';
import { fileURLToPath } from 'node:url';   // 경로에 한글 · 공백이 있거나 Windows 여도 맞는 경로

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 앱이 실제로 쓰는 것과 같은 양자화 (브라우저 WASM 기준)
const MODELS = { 'Marqo/marqo-fashionSigLIP': 'q8', 'Xenova/siglip-large-patch16-384': 'q8' };
const only = process.argv[2];
const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/manifest.json'), 'utf8'));
fs.mkdirSync(path.join(ROOT, 'samples/similar'), { recursive: true });

for (const [model, dtype] of Object.entries(MODELS)) {
  if (only && only !== model) continue;
  const enc = await loadVisionEncoder(model, { dtype });
  const vecs = [];
  for (const s of list) {
    const [v] = await enc.embed(await RawImage.read(path.join(ROOT, s.file)));
    vecs.push(v);
  }
  await enc.dispose?.();
  // 벡터마다 int8 로 줄인다 (순위만 쓰므로 충분히 정확하고 파일이 1/4 로 작아진다)
  const dim = vecs[0].length;
  const q = new Int8Array(vecs.length * dim);
  const scale = vecs.map((v, i) => {
    const m = Math.max(...v.map(Math.abs)) || 1;
    v.forEach((x, j) => { q[i * dim + j] = Math.round((x / m) * 127); });
    return +(m / 127).toPrecision(6);
  });
  const out = { model, dim, files: list.map((s) => s.file), scale, data: Buffer.from(q.buffer).toString('base64') };
  const file = path.join(ROOT, 'samples/similar', `${model.split('/').pop()}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`${model}: ${list.length}장 → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
}
