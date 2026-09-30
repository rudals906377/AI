// 한국어 문장 조립기
// analyzer 가 뽑은 그룹별 속성(라벨 + 점수)을 받아 사람이 설명하듯 상세한 문장으로 만든다.
// - 신뢰도 high : 단정 ("~입니다")
// - 신뢰도 mid  : 완곡 ("~로 보입니다") + 2위 후보 병기
// - 신뢰도 low  : 유보 ("~로 추정됩니다") + 상위 후보 나열

import { TAXONOMY } from './taxonomy.js';

export function compose(category, attributes) {
  const a = Object.fromEntries(attributes.map((x) => [x.group, x]));
  const out = COMPOSERS[category](a);
  const tags = uniq([
    TAXONOMY[category].label,
    ...attributes.map((x) => x.label),
    ...attributes.filter((x) => x.level !== 'high' && x.alternatives[0]?.score >= 0.25).map((x) => x.alternatives[0].label),
  ]);
  return {
    headline: out.headline,
    sentences: out.sentences.filter(Boolean),
    description: out.sentences.filter(Boolean).join(' '),
    tags,
  };
}

// ---------------------------------------------------------------------------
// 헬퍼
const pct = (x) => `${Math.round(x * 100)}%`;
const L = (attr) => attr.label;

// 받침 유무 — 괄호·공백·기호는 건너뛰고 마지막 한글 글자로 판단
function lastJong(word) {
  const w = String(word).replace(/\([^)]*\)\s*$/, '').trim();
  for (let i = w.length - 1; i >= 0; i--) {
    const c = w.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
    if (/[0-9A-Za-z]/.test(w[i])) return /[013678LMNlmn]/.test(w[i]) ? 1 : 0;
  }
  return 0;
}
// 조사 붙이기: josa('중단발', '은/는') → '중단발은' (앞: 받침 있을 때, 뒤: 없을 때)
export function josa(word, pair) {
  const [withJong, noJong] = pair.split('/');
  const jong = lastJong(word);
  if (pair === '으로/로') return word + (jong === 0 || jong === 8 ? noJong : withJong); // ㄹ 받침은 '로'
  return word + (jong ? withJong : noJong);
}
// 형용사형: '시크' → '시크한', '단정한' → 그대로, '시즌·이벤트' → '시즌·이벤트 분위기의'
const adj = (label) => (/(한|는|있는|러운)$/.test(label) ? label : /[가-힣]·[가-힣]*(이벤트|테마)$/.test(label) ? `${label} 분위기의` : `${label}한`);

// 신뢰도에 따른 서술어
// 명사 + 신뢰도별 서술어 (받침에 맞춰 '로/으로' 선택): said('메이크업', a) → '메이크업으로 보입니다'
function said(noun, attr) {
  if (attr.level === 'high') return `${noun}입니다`;
  return `${josa(noun, '으로/로')} ${attr.level === 'mid' ? '보입니다' : '추정됩니다'}`;
}
function ending(attr, high = '입니다', mid = '로 보입니다', low = '로 추정됩니다') {
  if (attr.level === 'high') return high;
  if (attr.level === 'mid') return mid;
  return low;
}
// 신뢰도가 낮을 때 덧붙이는 보충 문장 (같은 항목을 두 번 단정하지 않도록 짧게)
// - mid : 2위가 1위에 근접(70% 이상)할 때만 언급
// - low : 상위 후보를 "A 또는 B" 로 제시
const SKIP_ALT = new Set(['확인 불가']);
function hedge(attr) {
  const alts = attr.alternatives.filter((x) => !SKIP_ALT.has(x.label));
  const alt = alts[0];
  if (!alt) return '';
  if (attr.level === 'mid') {
    if (alt.score < attr.score * 0.7) return '';
    return `${alt.label}일 가능성도 있습니다(${pct(attr.score)} 대 ${pct(alt.score)}).`;
  }
  if (attr.level === 'low') {
    const cands = alts.slice(0, 2).map((x) => x.label).join(' 또는 ');
    return `다만 ${josa(attr.group_label, '은/는')} 사진만으로 단정하기 어려워 ${cands}일 수도 있습니다.`;
  }
  return '';
}
const sure = (attr) => attr.level !== 'low';
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// ---------------------------------------------------------------------------
// 카테고리별 조립기
const COMPOSERS = {
  hair(a) {
    const { length, texture, bangs, color, style, mood } = a;
    const s = [];
    s.push(`전체적으로 ${L(length)} 길이에 ${L(texture)} 질감이 특징인 ${said('헤어스타일', length)}.`);
    s.push(hedge(length));
    s.push(hedge(texture));
    if (L(bangs) === '확인 불가') s.push('뒷모습 위주의 사진이라 앞머리 형태는 확인되지 않습니다.');
    else if (L(bangs) === '앞머리 없음') s.push(`앞머리는 내지 않고 이마를 드러낸 ${said('형태', bangs)}.`);
    else s.push(`앞머리는 ${josa(L(bangs), '으로/로')} 정리되어 얼굴 라인을 감싸 줍니다${bangs.level === 'high' ? '' : ' (추정)'}.`);
    if (L(bangs) !== '확인 불가') s.push(hedge(bangs));
    s.push(`머리 색상은 ${L(color)} ${said('계열', color)}.`);
    s.push(hedge(color));
    s.push(`커트 형태는 ${josa(L(style), '과/와')} 가장 가깝습니다(${pct(style.score)}).`);
    s.push(hedge(style));
    s.push(`전체적인 인상은 ${adj(L(mood))} 분위기${ending(mood, '입니다', '에 가깝습니다', '에 가까워 보입니다')}.`);
    s.push(comboHair(a));
    return {
      headline: `${L(color)} ${L(length)} ${L(texture)}${L(bangs) === '확인 불가' ? '' : ` · ${L(bangs)}`} · ${L(style)}`,
      sentences: s,
    };
  },

  nail(a) {
    const { shape, length, color, technique, mood } = a;
    const s = [];
    s.push(`${L(length)} 길이의 ${L(shape)} 셰이프 ${said('네일', shape)}.`);
    s.push(hedge(shape));
    s.push(hedge(length));
    s.push(`베이스 컬러는 ${L(color)} ${said('계열', color)}.`);
    s.push(hedge(color));
    if (L(technique) === '원컬러') s.push(`별도의 아트 없이 한 가지 색으로 깔끔하게 마감한 원컬러 ${said('디자인', technique)}.`);
    else s.push(`디자인 기법은 ${josa(L(technique), '이/가')} 핵심 ${said('포인트', technique)}.`);
    s.push(hedge(technique));
    s.push(`전체적으로 ${adj(L(mood))} 느낌을 주는 ${said('네일', mood)}.`);
    s.push(comboNail(a));
    return {
      headline: `${L(color)} ${L(shape)} ${L(length)} 네일 · ${L(technique)}`,
      sentences: s,
    };
  },

  makeup(a) {
    const { mood, base, eye, lip, lipTexture, point } = a;
    const s = [];
    s.push(`전체적으로 ${L(mood)} 무드의 ${said('메이크업', mood)}.`);
    s.push(hedge(mood));
    s.push(`피부 표현은 ${L(base)} 타입${ending(base, '으로 마무리되어 있습니다', '으로 보입니다', '으로 추정됩니다')}.`);
    s.push(hedge(base));
    s.push(`아이 메이크업은 ${josa(L(eye), '이/가')} 두드러집니다(${pct(eye.score)}).`);
    s.push(hedge(eye));
    s.push(`립은 ${L(lip)} 컬러에 ${L(lipTexture)} ${said('질감', lip)}.`);
    s.push(hedge(lip));
    s.push(hedge(lipTexture));
    if (L(point) === '미니멀') s.push(`블러셔나 컨투어 같은 추가 포인트는 최소화한 편입니다.`);
    else s.push(`포인트로는 ${josa(L(point), '이/가')} 눈에 띕니다.`);
    s.push(hedge(point));
    s.push(comboMakeup(a));
    return {
      headline: `${L(mood)} 메이크업 · ${L(eye)} · ${L(lip)} ${L(lipTexture)} 립`,
      sentences: s,
    };
  },

  tattoo(a) {
    const { style, color, subject, placement, size } = a;
    const s = [];
    s.push(`${L(placement)} 부위에 새긴 ${L(size)} 사이즈의 ${said('타투', placement)}.`);
    s.push(hedge(placement));
    s.push(hedge(size));
    s.push(`스타일은 ${josa(L(style), '으로/로')} 분류되며(${pct(style.score)}), 색은 ${L(color)} ${said('방식', color)}.`);
    s.push(hedge(style));
    s.push(hedge(color));
    s.push(`주요 소재는 ${L(subject)} ${said('계열', subject)}.`);
    s.push(hedge(subject));
    s.push(comboTattoo(a));
    return {
      headline: `${L(placement)} ${L(size)} ${L(style)} 타투 · ${L(subject)} · ${L(color)}`,
      sentences: s,
    };
  },
};

// ---------------------------------------------------------------------------
// 조합 코멘트 — 두 속성이 모두 확실할 때만 한 줄 덧붙인다 (디테일용)
function comboHair(a) {
  const { length, texture, color, style, bangs } = a;
  if (sure(length) && sure(texture)) {
    if (L(length) === '장발' && /웨이브|C컬/.test(L(texture))) return '긴 기장에 컬이 더해져 부드럽고 볼륨감 있는 실루엣을 만듭니다.';
    if (L(length) === '숏컷') return '짧은 기장이라 얼굴형과 목선이 또렷하게 드러나는 스타일입니다.';
    if (L(length) === '단발' && L(texture) === '스트레이트') return '깔끔한 기장과 직모가 만나 단정하고 모던한 인상을 줍니다.';
    if (L(length) === '중단발' && L(texture) === 'C컬') return '어깨에 닿는 기장에 안으로 말린 끝머리가 얼굴을 갸름해 보이게 하는 조합입니다.';
  }
  if (sure(color) && /핑크|블루|레드/.test(L(color))) return '비비드한 염색 컬러라 스타일 자체가 강한 포인트가 됩니다.';
  if (sure(bangs) && L(bangs) === '시스루뱅') return '가벼운 시스루뱅이 답답하지 않으면서도 이마를 자연스럽게 가려 줍니다.';
  if (sure(style) && /포니테일|업스타일|땋은/.test(L(style))) return '묶음 스타일이라 옆·뒤에서 본 실루엣이 포인트입니다.';
  return '';
}
function comboNail(a) {
  const { shape, length, technique, color } = a;
  if (sure(length) && L(length) === '롱' && sure(shape) && /스틸레토|코핀/.test(L(shape))) return '긴 길이와 뾰족한 셰이프가 만나 손가락이 길어 보이는 드라마틱한 실루엣입니다.';
  if (sure(length) && L(length) === '숏' && sure(technique) && L(technique) === '원컬러') return '짧은 길이에 원컬러라 실용적이면서도 손이 깔끔해 보이는 데일리 네일입니다.';
  if (sure(technique) && /파츠|글리터|크롬/.test(L(technique))) return '빛을 받을 때 반짝임이 살아나는 디자인이라 파티나 특별한 날에 어울립니다.';
  if (sure(technique) && L(technique) === '프렌치') return '끝부분만 포인트를 준 프렌치라 어떤 옷차림에도 무난하게 어울립니다.';
  if (sure(color) && /누드|화이트|파스텔/.test(L(color))) return '차분한 베이스 컬러라 손톱이 자연스럽고 정돈된 인상을 줍니다.';
  return '';
}
function comboMakeup(a) {
  const { mood, eye, lip, base } = a;
  if (sure(eye) && sure(lip) && /스모키/.test(L(eye)) && /누드/.test(L(lip))) return '눈을 강조하고 입술은 누드로 눌러 준 전형적인 아이 포인트 메이크업입니다.';
  if (sure(lip) && L(lip) === '레드' && sure(eye) && /내추럴/.test(L(eye))) return '눈은 절제하고 레드 립으로 시선을 모은 립 포인트 메이크업입니다.';
  if (sure(base) && L(base) === '글로우') return '광이 도는 베이스 덕분에 전체적으로 생기 있고 촉촉한 인상을 줍니다.';
  if (sure(mood) && /파티|글램/.test(L(mood))) return '조명 아래에서 존재감이 커지는 스타일이라 행사나 촬영용으로 적합합니다.';
  if (sure(mood) && /내추럴|청순/.test(L(mood))) return '과하지 않게 결점만 보정한 느낌이라 일상에서 소화하기 좋은 메이크업입니다.';
  return '';
}
function comboTattoo(a) {
  const { style, color, size, subject } = a;
  if (sure(size) && L(size) === '대형') return '넓은 면적을 채운 작업이라 여러 세션에 걸쳐 완성했을 가능성이 높은 대작입니다.';
  if (sure(style) && /파인라인/.test(L(style))) return '가는 선 위주의 작업이라 은은하고 절제된 느낌을 줍니다.';
  if (sure(color) && L(color) === '컬러' && sure(style) && /수채화|뉴스쿨/.test(L(style))) return '선명한 색 사용이 스타일의 핵심이라 멀리서도 눈에 띄는 타투입니다.';
  if (sure(subject) && /꽃/.test(L(subject))) return '꽃 소재는 곡선이 많아 부드럽고 여성스러운 인상을 주는 대표적인 도안입니다.';
  if (sure(subject) && /문자/.test(L(subject))) return '문구가 중심이라 의미를 담은 기념 타투일 가능성이 큽니다.';
  return '';
}
