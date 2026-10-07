// SNS 트렌드 이름 표 — 사진에서 읽은 라벨 조합 → 한국에서 실제로 쓰는 트렌드 이름
//
//   const list = matchTrends('hair', P);   // P(group, label) = 그 라벨의 확률
//   → [{ name, why, n }]  조건이 많은(더 구체적인) 것부터
//
// 각 항목: { name, why, when: [[그룹, [라벨...]], ...] }
//   when 의 모든 조건을 만족해야 한다. 한 조건 안의 라벨은 '그중 하나' (그 라벨들의 확률 합이 기준 이상)
// 이름 출처: 2024~2026년 매거진 · 뷰티 플랫폼 · SNS 조사 (docs/TREND_RESEARCH.md)

import { CONFIDENCE } from './taxonomy.js';

export const TREND_MIN = CONFIDENCE.mid;

export const TRENDS = {
  hair: [],
  nail: [],
  makeup: [],
  tattoo: [],
};

export function matchTrends(category, P, min = TREND_MIN) {
  const out = [];
  for (const t of TRENDS[category] || []) {
    let ok = true, low = 1;
    for (const [group, labels] of t.when) {
      const s = labels.reduce((sum, l) => sum + P(group, l), 0);
      if (s < min) { ok = false; break; }
      low = Math.min(low, s);
    }
    if (ok) out.push({ name: t.name, why: t.why, n: t.when.length, score: low });
  }
  return out.sort((a, b) => b.n - a.n || b.score - a.score);
}
