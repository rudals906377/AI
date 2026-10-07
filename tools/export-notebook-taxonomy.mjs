// 파이썬 노트북(notebook/beauty_style_ai.ipynb)이 읽는 속성 사전 JSON 을 만든다.
//   node tools/export-notebook-taxonomy.mjs > notebook/taxonomy.json
import { TAXONOMY, CATEGORY_ORDER, CONFIDENCE } from '../taxonomy.js';
import { taxonomyHash } from '../analyzer.js';
const out = { hash: taxonomyHash(), categories: CATEGORY_ORDER, confidence: CONFIDENCE, tax: {} };
for (const c of CATEGORY_ORDER) {
  const t = TAXONOMY[c];
  out.tax[c] = {
    label: t.label,
    detect: t.detect.length,
    groups: t.groups.map((g) => ({
      key: g.key, label: g.label,
      labels: g.labels.map((l) => ({ ko: l.ko, en: l.en, ...(l.hidden ? { hidden: true } : {}), ...(l.tone ? { tone: l.tone } : {}), ...(l.def ? { def: l.def } : {}) })),
    })),
  };
}
console.log(JSON.stringify(out));
