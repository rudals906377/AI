// 손톱형 → 어울리는 네일 쉐입 · 길이 · 디자인 (규칙표)
//
//   const rep = nailReport(type, { life, length, curve, natural });   // nail.js nailType 결과 + 사용자가 고른 답
//
// 근거: 네일 전문 매체 · 브랜드 교육 자료 · 국내 네일샵 가이드에서 여러 곳이 같은 말을 하는 규칙만 점수로 쓴다
// (조사 노트: 짧은 손가락 · 넓은 손톱 → 오벌 · 아몬드 · 라운드, 각진 스퀘어는 피함 / 길고 가는 손가락 → 스퀘어 계열 /
//  짧은 손톱 → 라운드 · 숏 오벌 · 라운드스퀘어 / 손을 많이 쓰면 모서리 · 뾰족한 끝이 없는 모양 / 프리엣지는 바탕 길이의 절반 이하).
// 출처끼리 엇갈리는 규칙(스틸레토가 어울리는 손, 스퀘어의 내구성)은 점수에 넣지 않는다. 의학적 판단은 하지 않는다.
export const SHAPES = {
  라운드: { en: 'round', d: '끝을 손가락 끝선처럼 둥글게 다듬은 모양' },
  오벌: { en: 'oval', d: '옆선을 살짝 좁혀 달걀처럼 둥근 끝' },
  라운드스퀘어: { en: 'squoval', d: '끝은 일자, 모서리만 둥글린 모양 (스퀘어 오벌)' },
  스퀘어: { en: 'square', d: '끝과 모서리를 각지게 자른 모양' },
  아몬드: { en: 'almond', d: '옆선을 좁혀 끝을 부드럽게 뾰족하게 모은 모양' },
  코핀: { en: 'coffin', d: '끝을 좁히고 일자로 자른 발레리나 모양' },
  스틸레토: { en: 'stiletto', d: '끝을 뾰족하게 세운 모양' },
};
// 모양이 제대로 나오려면 필요한 최소 길이 (0 숏 · 1 미디엄 · 2 롱)
const NEED_LEN = { 라운드: 0, 오벌: 0, 라운드스퀘어: 0, 스퀘어: 0, 아몬드: 1, 코핀: 2, 스틸레토: 2 };

export function nailReport(type, { life = 'normal', length = 'any', curve = null, natural = 'any' } = {}) {
  const S = Object.fromEntries(Object.keys(SHAPES).map((k) => [k, { score: 50, why: [], warn: [] }]));
  const add = (k, d, why, warn = false) => { S[k].score += d; if (why) (warn ? S[k].warn : S[k].why).push(why); };
  // 손가락 길이
  if (type.finger === 'short') {
    add('오벌', 14, '손가락이 짧은 편이라 끝이 둥글게 모이는 모양이 손가락을 길어 보이게 해요');
    add('아몬드', 14, '끝을 모아 주는 아몬드는 손가락을 길고 가늘어 보이게 해요');
    add('라운드', 6, '둥근 끝선이 손끝을 자연스럽게 이어 줘요');
    add('스퀘어', -14, '일자 끝선이 손가락이 끝나는 자리를 강조해 짧아 보일 수 있어요', true);
  } else if (type.finger === 'long') {
    add('스퀘어', 12, '손가락이 긴 편이라 일자 끝선이 균형을 잡아 줘요');
    add('라운드스퀘어', 12, '긴 손가락에 일자 끝 + 둥근 모서리가 안정감을 줘요');
    add('코핀', 8, '길이가 있는 손가락에 코핀이 세련되게 어울려요');
  }
  // 손톱 가로세로
  if (type.width === 'wide') {
    add('아몬드', 14, '손톱이 가로로 넓은 편이라 옆선을 모으는 아몬드가 손톱을 갸름해 보이게 해요');
    add('오벌', 14, '넓은 손톱은 오벌로 옆선을 살짝 좁히면 갸름해 보여요');
    add('라운드', 6, '넓은 손톱에 둥근 끝이 부드럽게 어울려요');
    add('라운드스퀘어', 3, '각진 느낌을 원하면 모서리를 둥글린 라운드스퀘어가 무난해요');
    add('스퀘어', -14, '각진 일자 끝선이 넓은 손톱 너비를 그대로 보여 줘 더 넓어 보일 수 있어요', true);
  } else if (type.width === 'long') {
    add('스퀘어', 10, '손톱이 세로로 긴 편이라 일자 끝선을 살려도 길쭉함이 유지돼요');
    add('라운드스퀘어', 10, '긴 손톱에 라운드스퀘어가 단정하게 어울려요');
    add('코핀', 6, '세로로 긴 손톱은 코핀처럼 끝이 넓은 모양도 소화하기 좋아요');
  }
  // 큐티클 라인: 끝 모양을 큐티클 곡선과 비슷하게 맞추면 자연스럽다
  if (type.base === 'flat') { add('라운드스퀘어', 6, '큐티클 라인이 평평한 편이라 끝도 일자에 가까운 모양이 손톱과 잘 이어져요'); add('스퀘어', 4); }
  if (type.base === 'round') { add('라운드', 6, '큐티클 라인처럼 둥근 끝이 손톱 모양과 자연스럽게 이어져요'); add('오벌', 4); }
  if (type.base === 'u') { add('오벌', 6, '큐티클 라인이 깊게 둥근 편이라 오벌 · 아몬드 끝이 곡선을 이어 줘요'); add('아몬드', 6); }
  // 끝이 퍼지는 손톱: 옆선을 무리하게 깎으면 약해진다
  if (type.spread === 'fan') {
    add('라운드', 5, '끝이 퍼지는 손톱은 둥근 끝으로 퍼짐을 부드럽게 정리하기 좋아요');
    add('오벌', 3);
    add('스퀘어', -6, '일자 끝선이 끝쪽 퍼짐을 더 넓어 보이게 할 수 있어요', true);
  }
  // 생활 · 길이 · 자연 손톱
  if (life === 'hands') {
    for (const k of ['라운드', '라운드스퀘어']) add(k, 10, '타이핑 · 손을 많이 쓰면 뾰족하거나 각진 모서리가 없는 모양이 덜 부러지고 걸리지 않아요');
    add('오벌', 5);
    add('스틸레토', -25, '뾰족한 끝은 손을 많이 쓰면 잘 부러져요', true);
    add('코핀', -10, '길고 가는 끝은 손을 많이 쓰면 쉽게 깨져요', true);
  }
  const want = { short: 0, mid: 1, long: 2 }[length];
  if (want != null) for (const [k, need] of Object.entries(NEED_LEN)) if (need > want) add(k, -18 * (need - want), length === 'short' ? '짧은 길이로는 모양이 제대로 나오지 않아요' : '이 길이로는 모양이 충분히 나오지 않아요', true);
  if (length === 'short') { add('라운드', 6, '짧은 손톱엔 라운드 · 숏 오벌 · 라운드스퀘어가 가장 무난해요'); add('라운드스퀘어', 5); add('오벌', 4); }
  if (natural === 'natural') { add('코핀', -12, '코핀 · 스틸레토는 보통 젤 · 연장으로 만드는 모양이라 자연 손톱으로는 유지가 어려워요', true); add('스틸레토', -12); }
  // 기본: 라운드 · 라운드스퀘어는 누구에게나 무난
  add('라운드', 2); add('라운드스퀘어', 2);
  const list = Object.entries(S).map(([k, v]) => ({ key: k, ...SHAPES[k], ...v, score: Math.max(0, Math.min(100, Math.round(v.score))) })).sort((a, b) => b.score - a.score);
  // 위쪽 3개는 경고(길이가 모자람 · 피할 이유)가 없는 모양에서 고른다. 모자라면 점수 순으로 채운다
  const clean = list.filter((x) => !x.warn.length);
  const top = [...clean, ...list.filter((x) => x.warn.length)].slice(0, 3);
  for (const t of top) if (!t.why.length) t.why.push(k0(t.key));
  const avoid = list.filter((x) => x.score < 40 && x.warn.length).slice(0, 3);

  // 길이 · 디자인
  const lengthTip = [
    '하얀 끝(프리엣지)은 분홍빛 손톱 바탕 길이의 절반 이하가 가장 균형 있어 보이고 잘 부러지지 않아요.',
    type.finger === 'short' ? '손가락이 짧은 편이면 너무 짧게 깎기보다 1~2mm 정도 길이를 남기면 손가락이 길어 보여요.' : null,
    life === 'hands' ? '손을 많이 쓰면 손끝 살짝 위까지의 짧은 길이가 편해요.' : null,
  ].filter(Boolean);
  const design = [];
  if (type.width === 'wide') design.push({ k: '옆 여백 · 세로 라인', t: '양옆을 살짝 남기고 칠하거나 세로 라인 · 스트라이프를 넣으면 손톱이 갸름해 보여요. 가로 라인 · 두꺼운 일자 프렌치는 넓어 보일 수 있어요.' });
  if (type.width === 'wide' || type.finger === 'short') design.push({ k: '누드 · 파스텔', t: '피부톤과 비슷한 누드 · 연한 색은 손가락이 이어져 보여 길어 보여요.' });
  if (type.width === 'long' || (type.finger === 'long' && type.width !== 'wide')) design.push({ k: '프렌치 · 가로 포인트', t: '길쭉한 손톱은 프렌치 · 가로 포인트로 분위기를 바꿔도 균형이 무너지지 않아요.' });
  if (length === 'any' ? type.length === 'short' : length === 'short') design.push({ k: '마이크로 프렌치 · 원포인트', t: '짧은 손톱엔 얇은 곡선 프렌치(마이크로 프렌치)나 한 손가락에만 파츠를 올리는 원포인트가 깔끔해요.' });
  if (!design.length) design.push({ k: '원컬러 · 프렌치', t: '균형 잡힌 손톱이라 원컬러부터 프렌치 · 그라데이션까지 무난하게 어울려요.' });

  // 상담 카드 (네일샵에 보여 줄 문장)
  const card = [
    `손톱: ${TYPE_LINE(type)}`,
    `원하는 모양: ${top.map((t) => t.key).join(' · ')} 중에서 상담하고 싶어요`,
    avoid.length ? `피하고 싶은 모양: ${avoid.map((t) => t.key).join(' · ')}` : null,
    length !== 'any' ? `원하는 길이: ${{ short: '짧게', mid: '중간', long: '길게' }[length]}` : null,
    life === 'hands' ? '타이핑 · 손을 많이 써요 (튼튼한 모양 선호)' : null,
    curve ? `C커브: ${{ flat: '평평한 편', mid: '보통', strong: '많이 휜 편' }[curve]} (제가 느끼기에)` : null,
    natural === 'natural' ? '자연 손톱으로 유지하고 싶어요' : natural === 'ext' ? '젤 · 연장도 괜찮아요' : null,
  ].filter(Boolean);
  return { top, avoid, list, lengthTip, design, card };
}
const k0 = (k) => ({ 라운드: '누구에게나 무난하고 가장 튼튼한 모양이에요', 라운드스퀘어: '단정하고 튼튼해서 오래 유지하기 좋아요', 오벌: '손가락을 길어 보이게 하는 무난한 모양이에요' }[k] || '손톱 모양과 무난하게 어울려요');
const TYPE_LINE = (t) => [
  { wide: '가로로 넓은 편', long: '세로로 긴 편', mid: '가로세로 균형' }[t.width],
  { fan: '끝이 퍼지는 편', narrow: '끝이 좁아지는 편', straight: '옆선 일자' }[t.spread],
  { flat: '큐티클 라인 평평', round: '큐티클 라인 둥긂', u: '큐티클 라인 깊은 U자' }[t.base],
  { short: '손가락 짧은 편', long: '손가락 긴 편', mid: '손가락 보통' }[t.finger],
].join(' · ');
export { TYPE_LINE };
