// taxonomy.js 를 파이썬 학습 스크립트가 읽을 수 있는 JSON 으로 내보낸다.
//   node tools/export-taxonomy.mjs > taxonomy.json
import { TAXONOMY, CATEGORY_ORDER } from '../taxonomy.js';
import { taxonomyHash } from '../analyzer.js';
const out = { hash: taxonomyHash(), categories: CATEGORY_ORDER, groups: {} };
for (const c of CATEGORY_ORDER) {
  out.groups[c] = TAXONOMY[c].groups.map((g) => ({ key: g.key, labels: g.labels.map((l) => l.ko) }));
  out[`detect_${c}`] = TAXONOMY[c].detect.length;
}
console.log(JSON.stringify(out));
