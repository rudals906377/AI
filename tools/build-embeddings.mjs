// 속성 사전(taxonomy.js)의 라벨 텍스트 임베딩을 미리 계산해 embeddings/*.json 으로 저장한다.
// 브라우저는 이 파일을 읽으므로 텍스트 모델을 내려받지 않아도 된다 (로딩 시간 · 용량 절감).
// taxonomy.js 를 수정했다면 반드시 다시 실행:   node tools/build-embeddings.mjs [모델...]
import fs from 'node:fs';
import { buildLabelIndex } from '../analyzer.js';
import { fileURLToPath } from 'node:url';   // 경로에 한글 · 공백이 있거나 Windows 여도 맞는 경로

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Xenova/clip-vit-large-patch14', 'Xenova/clip-vit-base-patch16'];
const outDir = process.env.OUT_DIR || fileURLToPath(new URL('../embeddings/', import.meta.url));
fs.mkdirSync(outDir, { recursive: true });

for (const model of MODELS) {
  const t0 = Date.now();
  // 오프라인 계산이므로 가장 정확한 fp32 텍스트 모델을 쓴다
  const { json } = await buildLabelIndex({ model, dtype: 'fp32' });
  const file = `${outDir}/${model.split('/').pop()}.json`;
  fs.writeFileSync(file, JSON.stringify(json));
  console.log(`${model}: ${json.count} vectors × ${json.dim} → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
}
