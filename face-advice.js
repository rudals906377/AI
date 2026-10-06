// 내 얼굴 분석 결과 → 쉬운 설명 · 헤어 추천 · 메이크업 추천 · 지금 분석한 스타일과의 궁합
//
//   const rep = faceReport(face, styleResult);   // { headline, summary, measures, hair, makeup, match, zones }
//
// 얼굴형 하나로만 말하지 않고, 측정값마다 평균과 비교한 특징(이마가 넓은 편, 중안부가 긴 편 …)을 함께 써서 추천한다.
// 추천 커트 · 앞머리는 '이런 분께 잘 어울려요'(suits.js)와 같은 표를 써서 서로 말이 어긋나지 않게 한다.

import { NORM, SHAPES } from './face.js';
import { CUT_FACE, BANGS_FACE, CHEEK_FACE, EYE_LINE, LIP_SHAPE } from './suits.js';
import { josa } from './describe.js';

// suits.js 의 얼굴형 표현 ↔ 얼굴형 키
const ALIAS = {
  oval: ['계란형'], round: ['둥근 얼굴'], long: ['긴 얼굴'], square: ['각진 얼굴'],
  heart: ['역삼각형', '턱선이 갸름한 얼굴'], diamond: ['광대가 있는 얼굴'],
};
// 얼굴형별로 많이 권하는 앞머리 (이유는 suits.js 의 BANGS_FACE 문장)
const BANGS_BY_SHAPE = {
  oval: ['앞머리 없음', '시스루뱅', '커튼뱅'], round: ['시스루뱅', '사이드뱅', '애교머리'], long: ['풀뱅', '시스루뱅'],
  square: ['U뱅', '사이드뱅', '커튼뱅'], heart: ['시스루뱅', '커튼뱅', '사이드뱅'], diamond: ['커튼뱅', '시스루뱅', '애교머리'],
};
const SHORT = /픽시컷|빅시컷|투블럭컷|크롭컷|페이드컷|버즈컷|가일컷|아이비리그컷|댄디컷|모히칸|쉼표머리|가르마펌|애즈펌|리프컷|포마드/;

// ---- 측정값 → 특징 ----------------------------------------------------------------
const z = (k, x, i) => (i == null ? (x - NORM[k][0]) / NORM[k][1] : (x - NORM[k][i][0]) / NORM[k][i][1]);
function traits(f) {
  const m = f.m;
  const t = {
    long: z('ratio', m.ratio), foreheadW: z('forehead', m.forehead), jawW: z('jaw', m.jaw), chinW: z('chin', m.chin),
    jawSharp: -z('jawAngle', m.jawAngle), upper: z('thirds', m.thirds[0], 0), mid: z('thirds', m.thirds[1], 1), lower: z('thirds', m.thirds[2], 2),
    philtrum: z('philtrum', m.philtrum), eyeWide: z('eyeSpacing', m.eyeSpacing), eyeRound: z('eyeAspect', m.eyeAspect), eyeUp: z('eyeTilt', m.eyeTilt),
    browGap: z('browGap', m.browGap), browArch: z('browArch', m.browArch), noseW: z('nose', m.nose), mouthW: z('mouth', m.mouth),
    upperThin: z('lips', m.lips), lipFull: z('lipFull', m.lipFull),
  };
  if (!f.geo.hairlineFound) {
    // 헤어라인을 못 찾았으면 이마 높이 · 얼굴 길이는 말하지 않고, 중안부와 하안부만 서로 비교한다
    const r = m.thirds[2] / m.thirds[1], r0 = NORM.thirds[2][0] / NORM.thirds[1][0];
    t.upper = t.long = 0;
    t.lower = (r - r0) / 0.08; t.mid = 0;
    t.lowerOnly = r;
  }
  return t;
}
// z 값 → 말 (평균 ±0.8 표준편차 안이면 null = 평균)
const say = (x, lo, hi, strong = 1.6) => (x >= strong ? hi : x >= 0.8 ? `약간 ${hi}` : x <= -strong ? lo : x <= -0.8 ? `약간 ${lo}` : null);
// '이마가 약간 넓은 편' 처럼 주어 + 정도
const phrase = (subj, x, lo, hi) => { const a = say(x, lo, hi); return a && `${subj} ${a}`; };
const short = (label) => label.replace(/\(.*\)/, '');

// ---- 측정 표 ------------------------------------------------------------------------
function measures(f, t) {
  const m = f.m, rows = [];
  const fx = (x, d = 2) => x.toFixed(d);
  const row = (key, label, value, avg, note, zz) => rows.push({ key, label, value, avg, note: note || '평균에 가까워요', z: zz });
  row('ratio', '얼굴 길이 : 너비', `${fx(m.ratio)} : 1`, `${NORM.ratio[0]} : 1`, f.geo.hairlineFound ? say(t.long, '짧은 편', '긴 편') && `얼굴이 ${say(t.long, '짧은 편', '긴 편')}이에요` : '헤어라인이 안 보여 이마 높이는 어림값이에요', t.long);
  row('widths', '이마 : 광대 : 턱 너비', `${fx(m.forehead)} : 1 : ${fx(m.jaw)}`, `${NORM.forehead[0]} : 1 : ${NORM.jaw[0]}`,
    [phrase('이마가', t.foreheadW, '좁은 편', '넓은 편'), phrase('턱이', t.jawW, '좁은 편', '넓은 편')].filter(Boolean).join(', ') + (Math.abs(t.foreheadW) >= 0.8 || Math.abs(t.jawW) >= 0.8 ? '이에요' : ''), Math.max(Math.abs(t.foreheadW), Math.abs(t.jawW)));
  row('jawAngle', '턱 모서리 각도', `${Math.round(m.jawAngle)}°`, `${NORM.jawAngle[0]}°`, say(t.jawSharp, '둥글고 완만한 편', '각진 편') && `턱선이 ${say(t.jawSharp, '둥글고 완만한 편', '각진 편')}이에요`, t.jawSharp);
  row('chin', '턱끝', `너비 ${fx(m.chin)} · ${Math.round(m.chinAngle)}°`, `${NORM.chin[0]}`, say(t.chinW, '뾰족한 편', '넓은 편') && `턱끝이 ${say(t.chinW, '뾰족한 편', '넓은 편')}이에요`, t.chinW);
  const th = m.thirds;
  if (t.lowerOnly) {
    row('thirds', '중안부 : 하안부', `1 : ${fx(t.lowerOnly)}`, `1 : ${fx(NORM.thirds[2][0] / NORM.thirds[1][0])}`,
      say(t.lower, '짧은 편', '긴 편') ? `하안부가 중안부보다 ${say(t.lower, '짧은 편', '긴 편')}이에요` : '중안부와 하안부 비율이 평균에 가까워요 (헤어라인이 안 보여 이마는 재지 않았어요)', t.lower);
  } else {
  const thNote = [['상안부', t.upper], ['중안부', t.mid], ['하안부', t.lower]].filter(([, x]) => Math.abs(x) >= 0.8).map(([n, x]) => `${n}가 ${say(x, '짧은 편', '긴 편')}`);
  row('thirds', '삼정 (이마 : 눈썹~코 : 코~턱)', th.map((x) => fx(x)).join(' : '), NORM.thirds.map((x) => x[0]).join(' : '), thNote.length ? `${thNote.join(', ')}이에요` : '세 부분이 평균처럼 고르게 나뉘어요', Math.max(Math.abs(t.upper), Math.abs(t.mid), Math.abs(t.lower)));
  }
  row('philtrum', '코 밑~입 : 입~턱끝', `1 : ${fx(1 / m.philtrum, 1)}`, `1 : ${fx(1 / NORM.philtrum[0], 1)}`, say(t.philtrum, '짧은 편', '긴 편') && `인중이 ${say(t.philtrum, '짧은 편', '긴 편')}이에요`, t.philtrum);
  row('eyeSpacing', '미간 : 눈 가로', `${fx(m.eyeSpacing)} : 1`, `${NORM.eyeSpacing[0]} : 1`, say(t.eyeWide, '좁은 편', '넓은 편') && `미간이 ${say(t.eyeWide, '좁은 편', '넓은 편')}이에요`, t.eyeWide);
  row('eyeTilt', '눈꼬리 각도', `${m.eyeTilt >= 0 ? '+' : ''}${fx(m.eyeTilt, 1)}°`, `+${NORM.eyeTilt[0]}°`, say(t.eyeUp, '내려간(순한) 편', '올라간 편') && `눈꼬리가 ${say(t.eyeUp, '내려간(순한) 편', '올라간 편')}이에요`, t.eyeUp);
  row('eyeAspect', '눈 세로 : 가로', `${fx(m.eyeAspect)}`, `${NORM.eyeAspect[0]}`, say(t.eyeRound, '가로로 긴 편', '동그란 편') && `눈매가 ${say(t.eyeRound, '가로로 긴 편', '동그란 편')}이에요`, t.eyeRound);
  row('browGap', '눈썹 ~ 눈 거리', `${fx(m.browGap)} (눈 가로 대비)`, `${NORM.browGap[0]}`, say(t.browGap, '가까운 편', '먼 편') && `눈썹과 눈 사이가 ${say(t.browGap, '가까운 편', '먼 편')}이에요`, t.browGap);
  row('nose', '콧볼 : 미간', `${fx(m.nose)} : 1`, `${NORM.nose[0]} : 1`, say(t.noseW, '좁은 편', '넓은 편') && `콧볼이 ${say(t.noseW, '좁은 편', '넓은 편')}이에요`, t.noseW);
  row('lips', '윗입술 : 아랫입술', `1 : ${fx(m.lips)}`, `1 : ${NORM.lips[0]}`, say(t.upperThin, '도톰한 편', '얇은 편') && `윗입술이 ${say(t.upperThin, '도톰한 편', '얇은 편')}이에요`, t.upperThin);
  row('mouth', '입 너비 : 콧볼 너비', `${fx(m.mouth)} : 1`, `${NORM.mouth[0]} : 1`, say(t.mouthW, '작은 편', '큰 편') && `입이 ${say(t.mouthW, '작은 편', '큰 편')}이에요`, t.mouthW);
  row('lipFull', '입술 두께 (입 너비 대비)', fx(m.lipFull), `${NORM.lipFull[0]}`, say(t.lipFull, '얇은 편', '도톰한 편') && `입술이 ${say(t.lipFull, '얇은 편', '도톰한 편')}이에요`, t.lipFull);
  return rows;
}

// ---- 헤어 추천 ---------------------------------------------------------------------
const HAIR = {
  oval: {
    tip: '어떤 커트도 무난해요.',
    idea: '비율이 고르게 잡힌 얼굴이라 대부분의 커트가 잘 어울려요. 얼굴선을 드러낼수록 장점이 살아나요.',
    length: '기장 제약이 거의 없어요. 단발부터 긴 머리까지, 숏컷도 잘 소화하는 얼굴형이에요.',
    part: '가운데 · 옆가르마 모두 잘 어울려요. 앞머리 없이 이마를 드러내도 좋아요.',
    avoid: ['얼굴을 전부 덮는 무거운 앞머리와 옆머리 (균형 잡힌 얼굴선을 가려요)'],
  },
  round: {
    tip: '얼굴선을 따라 층을 낸 레이어드컷이나 허쉬컷이 더 잘 어울려요.',
    idea: '세로 라인을 만들어 얼굴이 길고 갸름해 보이게 하는 것이 핵심이에요. 얼굴선을 따라 내려오는 층과 정수리 볼륨이 좋아요.',
    length: '턱선 아래, 쇄골~가슴 기장이 좋아요. 단발이라면 턱보다 조금 길게, 끝을 안으로 넣는 C컬로 볼을 감싸 주세요.',
    part: '옆가르마(6:4, 7:3)로 이마를 사선으로 드러내면 얼굴에 세로 · 대각선이 생겨 갸름해 보여요.',
    avoid: ['턱선에서 끊기는 일자 단발', '눈썹을 다 덮는 일자 풀뱅', '볼 높이에서 옆으로 퍼지는 볼륨'],
  },
  long: {
    tip: '앞머리를 내리고 턱~어깨 기장에 옆 볼륨을 주면 더 잘 어울려요.',
    idea: '가로 라인을 만들어 얼굴 길이를 줄여 보이게 하는 것이 핵심이에요. 앞머리와 옆 볼륨이 좋아요.',
    length: '턱~어깨 기장이 가장 좋아요. 긴 머리라면 볼 높이부터 웨이브를 넣어 옆 볼륨을 만들어 주세요.',
    part: '가운데 가르마보다 옆가르마, 또는 앞머리를 내려 이마를 가리면 얼굴이 짧아 보여요.',
    avoid: ['정수리를 높게 세우는 볼륨', '이마를 다 드러내는 올백', '옆을 납작하게 붙인 긴 생머리'],
  },
  square: {
    tip: '턱 높이에 층이나 웨이브를 넣으면 각이 부드러워 보여요.',
    idea: '곡선으로 턱 모서리의 각을 부드럽게 감싸는 것이 핵심이에요. 층과 웨이브가 잘 어울려요.',
    length: '턱선보다 길게, 쇄골 아래 기장이 좋아요. 턱 모서리 높이에 레이어나 컬이 오면 각이 부드러워 보여요.',
    part: '옆가르마나 사선으로 떨어지는 앞머리로 대각선을 만들어 주세요.',
    avoid: ['턱선에서 일자로 끊기는 칼단발', '눈썹 위 일자 앞머리', '옆머리를 바짝 짧게 친 커트 (턱 각이 강조돼요)'],
  },
  heart: {
    tip: '턱 주변에 볼륨이 오는 단발~중단발 C컬이 더 잘 어울려요.',
    idea: '넓은 이마는 가리고, 좁은 턱 주변에 볼륨을 채워 위아래 균형을 맞추는 것이 핵심이에요.',
    length: '턱~어깨 기장에서 끝을 바깥이나 안으로 말아 턱 옆을 채우면 좋아요. 긴 머리라면 턱 아래부터 웨이브를 넣어 주세요.',
    part: '옆가르마나 앞머리로 이마 폭을 줄여 주세요. 정수리 볼륨은 낮게 두는 편이 좋아요.',
    avoid: ['정수리를 높게 세우는 볼륨', '이마를 다 드러내는 올백 · 포마드', '턱 아래까지 매끈하게 붙는 긴 생머리'],
  },
  diamond: {
    tip: '광대를 감싸는 옆머리와 이마를 채우는 앞머리를 더하면 더 잘 어울려요.',
    idea: '튀어나온 광대는 옆머리로 감싸고, 좁은 이마와 턱 쪽에 볼륨을 주는 것이 핵심이에요.',
    length: '턱~어깨 기장, 또는 긴 머리에 턱 아래부터 볼륨을 주면 좋아요. 광대 높이에는 옆머리가 자연스럽게 떨어지게 해 주세요.',
    part: '앞머리로 이마를 채우거나, 가르마 쪽 머리를 살짝 띄워 이마 양옆을 채워 주세요.',
    avoid: ['광대 높이에서 옆으로 퍼지는 볼륨', '옆머리를 귀 뒤로 바짝 넘긴 스타일', '정수리만 높은 볼륨'],
  },
};
function hairAdvice(f, t) {
  const top = f.shape.probs[0].key, second = f.shape.probs[1];
  const keys = [top, ...(second.p > 0.25 ? [second.key] : [])];
  const aliases = keys.flatMap((k) => ALIAS[k]);
  if (t.upper >= 0.8 || t.foreheadW >= 0.8) aliases.push('이마가 넓은 얼굴');
  // 커트: suits.js 표에서 내 얼굴형이 들어간 커트
  const cuts = Object.entries(CUT_FACE).filter(([, [faces]]) => faces.some((x) => aliases.includes(x)))
    .map(([name, [faces, why]]) => ({ name, why, primary: faces.some((x) => ALIAS[top].includes(x)) }))
    .sort((a, b) => b.primary - a.primary);
  const longCuts = cuts.filter((c) => !SHORT.test(c.name)).slice(0, 4), shortCuts = cuts.filter((c) => SHORT.test(c.name)).slice(0, 4);
  // 앞머리
  const bangNames = [...new Set([...BANGS_BY_SHAPE[top], ...Object.entries(BANGS_FACE).filter(([, [faces]]) => aliases.some((a) => faces.includes(a))).map(([n]) => n)])];
  let bangs = bangNames.map((name) => ({ name, why: BANGS_FACE[name][1] }));
  if (t.upper >= 0.8) bangs = bangs.filter((b) => b.name !== '앞머리 없음');
  if (t.upper <= -0.8 && !bangs.some((b) => b.name === '앞머리 없음')) bangs.push({ name: '앞머리 없음', why: BANGS_FACE['앞머리 없음'][1] + ' 이마가 짧은 편이라 드러내면 비율이 좋아 보여요' });
  const H = HAIR[top];
  const extra = [];
  if (t.upper >= 0.8) extra.push(`상안부(이마)가 ${say(t.upper, '짧은 편', '긴 편')}이라 앞머리로 이마를 덮으면 얼굴 비율이 맞아 보여요.`);
  if (t.upper <= -0.8) extra.push('이마가 짧은 편이라 앞머리를 무겁게 내리기보다 이마를 드러내거나 시스루뱅처럼 가볍게 내리는 편이 좋아요.');
  if (t.mid >= 0.8) extra.push('중안부가 긴 편이라 눈썹~광대 높이에 앞머리 끝이나 옆머리 레이어가 오면 세로 길이가 끊겨 보여요.');
  if (t.lower >= 0.8 || t.chinW <= -0.8) extra.push(`${t.lower >= 0.8 ? '하안부가 긴 편' : '턱끝이 뾰족한 편'}이라 턱 높이에 컬이나 볼륨이 오는 기장(단발~중단발 C컬)이 아래 얼굴을 채워 줘요.`);
  if (t.jawW >= 0.8 && top !== 'square') extra.push('턱이 넓은 편이라 턱선에서 끊기는 기장보다 턱 아래로 내려오는 기장이 좋아요.');
  return [
    { key: 'idea', title: '핵심', text: [H.idea, ...extra].join(' ') },
    longCuts.length && { key: 'cuts', title: '추천 커트 · 긴 머리와 단발', list: longCuts.map((c) => ({ name: c.name, why: c.why })) },
    shortCuts.length && { key: 'short', title: '추천 커트 · 짧은 머리', list: shortCuts.map((c) => ({ name: c.name, why: c.why })) },
    bangs.length && { key: 'bangs', title: '추천 앞머리', list: bangs.slice(0, 4) },
    { key: 'length', title: '기장 · 볼륨 위치', text: H.length },
    { key: 'part', title: '가르마', text: H.part },
    { key: 'avoid', title: '피하면 좋은 스타일', list: H.avoid.map((x) => ({ name: x })) },
  ].filter(Boolean);
}

// ---- 메이크업 추천 ------------------------------------------------------------------
const MAKEUP = {
  oval: {
    shading: '윤곽을 크게 바꿀 필요가 없어요. 광대 아래와 턱선 끝에 아주 연하게만 넣어 주세요.',
    highlight: '이마 가운데 · 콧대 · 광대 위 · 턱끝에 가볍게 올려 입체감을 살려요.',
    blush: '웃을 때 올라오는 볼 가운데에 둥글게 넣어 주세요. 어떤 모양도 무난해요.',
    brow: '자연스러운 아치 눈썹과 일자 눈썹 모두 잘 어울려요.',
  },
  round: {
    shading: '관자놀이에서 광대 아래를 지나 턱선까지, 얼굴 바깥쪽을 따라 세로로 넣어 볼 폭을 줄여 주세요.',
    highlight: '이마 가운데에서 콧대까지 세로로 길게, 턱끝에도 살짝 올려 얼굴이 길어 보이게 해요.',
    blush: '볼 가운데보다 조금 바깥에서 관자놀이 쪽으로 사선으로 길게 올려 주세요.',
    brow: '눈썹 산이 살짝 있는 아치형으로, 꼬리를 너무 내리지 않게 그려 세로감을 주세요.',
  },
  long: {
    shading: '헤어라인(이마 위)과 턱끝 아래를 가로로 쉐딩해 위아래 길이를 줄여 주세요.',
    highlight: '눈 밑 광대 위에 가로로 짧게 올리고, 콧대 하이라이트는 짧게 끊어 주세요.',
    blush: '볼 가운데에서 바깥쪽으로 가로로 넓게 펴 바르면 얼굴 길이가 짧아 보여요.',
    brow: '산을 낮춘 일자 눈썹을 길게 그리면 가로 라인이 생겨요.',
  },
  square: {
    shading: '턱 모서리(귀 아래 각진 부분)와 이마 양쪽 모서리를 둥글게 깎듯이 쉐딩해 주세요.',
    highlight: '이마 가운데 · 콧대 · 턱끝에 올려 시선을 얼굴 가운데로 모아요.',
    blush: '광대 가운데에 둥글게 넣어 곡선을 더해 주세요.',
    brow: '각지지 않은 부드러운 아치 눈썹이 턱의 직선을 중화해요.',
  },
  heart: {
    shading: '이마 양옆(관자놀이)을 쉐딩해 이마 폭을 줄이고, 뾰족한 턱끝은 아주 살짝만 눌러 주세요.',
    highlight: '턱 양옆과 눈 밑에 하이라이트를 넣어 좁은 아래 얼굴을 채워 보이게 해요.',
    blush: '광대 바로 아래에 가로로 둥글게 넣어 얼굴 아래쪽에 시선이 가게 해 주세요.',
    brow: '산이 완만하고 둥근 눈썹이 좋아요. 너무 진하거나 각진 눈썹은 이마를 넓어 보이게 해요.',
  },
  diamond: {
    shading: '가장 튀어나온 광대 바깥쪽에 넣어 폭을 줄여 주세요. 턱 · 이마에는 넣지 않아요.',
    highlight: '이마 양옆과 턱 양옆을 밝혀 좁은 위아래를 넓어 보이게 해요.',
    blush: '광대 꼭대기보다 안쪽(눈 밑 앞쪽)에 가로로 넣어 광대가 덜 도드라져 보이게 해요.',
    brow: '길고 완만한 아치 눈썹으로 이마 폭이 넓어 보이게 해 주세요.',
  },
};
function makeupAdvice(f, t) {
  const M = MAKEUP[f.shape.probs[0].key];
  const eye = [], lip = [], base = [];
  // 눈매
  if (t.eyeUp >= 0.8) eye.push(`눈꼬리가 올라간 편이라 아이라인 꼬리를 수평이나 살짝 아래로 빼는 강아지 라인을 그리면 순한 인상이 돼요. ${EYE_LINE['강아지 라인']}`);
  else if (t.eyeUp <= -0.8) eye.push(`눈꼬리가 내려간 편이라 꼬리를 살짝 올려 빼는 캣아이라인이 또렷해 보여요. ${EYE_LINE['캣아이라인']}`);
  else eye.push('눈꼬리 각도가 평균이라 캣아이라인 · 강아지 라인 모두 잘 어울려요. 원하는 인상에 맞춰 골라 주세요.');
  if (t.eyeWide >= 0.8) eye.push('미간이 넓은 편이라 아이라인을 눈앞머리까지 이어 그리고, 눈앞머리 쪽 쌍꺼풀 라인에 음영을 넣으면 눈 사이가 가까워 보여요.');
  else if (t.eyeWide <= -0.8) eye.push('미간이 좁은 편이라 진한 섀도는 눈꼬리 쪽에, 눈앞머리에는 밝은 하이라이트를 올려 눈 사이를 넓어 보이게 해요.');
  if (t.eyeRound >= 0.8) eye.push('눈이 동그란 편이라 아이라인을 눈꼬리 밖으로 가로로 길게 빼면 성숙하고 길어 보여요.');
  else if (t.eyeRound <= -0.8) eye.push('눈이 가로로 긴 편이라 눈동자 위 가운데에 펄 · 밝은 섀도를 올리고 애교살을 살리면 눈이 커 보여요.');
  if (t.browGap >= 0.8) eye.push('눈썹과 눈 사이가 먼 편이라 눈썹 아래쪽을 채워 그리고 섀도를 눈두덩 넓게 펴 주세요.');
  else if (t.browGap <= -0.8) eye.push('눈썹과 눈 사이가 가까운 편이라 눈썹 아래 선을 정리하고 섀도는 쌍꺼풀 라인 근처에만 진하게 넣어 주세요.');
  // 입술
  if (t.upperThin >= 0.8) lip.push(`윗입술이 얇은 편이라 입술산을 살짝 넘겨 그리는 오버립이 잘 어울려요. ${LIP_SHAPE['오버립']}`);
  else if (t.upperThin <= -0.8) lip.push('윗입술이 도톰한 편이라 아랫입술을 조금 더 채우거나 안쪽을 진하게 하는 그라데이션립이 균형이 좋아요.');
  if (t.lipFull <= -0.8) lip.push(`입술이 얇은 편이라 글로시한 질감이 볼륨을 살려 줘요.`);
  else if (t.lipFull >= 0.8) lip.push(`입술이 도톰한 편이라 블러립이나 매트한 질감이 차분하게 정리해 줘요. ${LIP_SHAPE['블러립']}`);
  if (t.philtrum >= 0.8) lip.push('인중이 긴 편이라 윗입술을 살짝 오버해서 그리면 인중이 짧아 보여요.');
  if (t.mouthW >= 0.8) lip.push('입이 큰 편이라 입꼬리 끝은 비우고 가운데를 채우는 그라데이션이 자연스러워요.');
  if (!lip.length) lip.push('입술 비율이 평균에 가까워 오버립 · 그라데이션 · 풀립 모두 무난해요.');
  // 삼정 · 코
  if (t.mid >= 0.8) base.push(`중안부가 긴 편이라 블러셔를 눈 밑 가까이 가로로 넣고(숙취 블러셔) 애교살을 살리면 가운데 길이가 짧아 보여요. 콧대 하이라이트는 코끝까지 내리지 말고 짧게 끊어 주세요.`);
  if (t.lower >= 0.8) base.push('하안부가 긴 편이라 턱끝 아래를 쉐딩하고, 윗입술을 또렷하게 그려 시선을 위로 올려 주세요.');
  if (t.upper >= 0.8) base.push('이마가 긴 편이라 헤어라인을 따라 쉐딩을 가볍게 넣으면 이마가 줄어 보여요.');
  if (t.noseW >= 0.8) base.push('콧볼이 넓은 편이라 콧볼 양옆에 세로로 노즈 쉐딩을 넣고, 하이라이트는 콧대에 가늘게 올려 주세요.');
  // 피부 톤 (사진 조명 영향이 커서 참고용)
  const tone = f.skin && skinHint(f.skin);
  return [
    { key: 'shading', title: '쉐딩 (윤곽)', text: M.shading, zone: 'shade' },
    { key: 'highlight', title: '하이라이터', text: M.highlight, zone: 'light' },
    { key: 'blush', title: '블러셔', text: M.blush, zone: 'blush' },
    { key: 'brow', title: '눈썹', text: M.brow + (t.browArch >= 1 ? ' 원래 눈썹 산이 높은 편이라 산을 살짝 깎아 정리하면 부드러워 보여요.' : t.browArch <= -1 ? ' 원래 눈썹이 일자에 가까워 산을 그릴 때는 꼬리 쪽 1/3 지점만 살짝 올려 주세요.' : '') },
    { key: 'eyes', title: '아이라인 · 섀도', text: eye.join(' ') },
    { key: 'lips', title: '입술', text: lip.join(' ') },
    base.length && { key: 'balance', title: '비율 보정', text: base.join(' ') },
    tone && { key: 'tone', title: '색 고르기 (참고)', text: tone },
  ].filter(Boolean);
}
function skinHint({ lab, hue, chroma }) {
  const L = lab[0];
  const bright = L >= 70 ? '밝은 편' : L >= 55 ? '중간 밝기' : '어두운 편';
  const under = hue >= 62 ? 'yellow' : hue <= 50 ? 'red' : 'neutral';
  const t1 = `사진 속 피부는 ${bright}이고 ${under === 'yellow' ? '노란기가 도는' : under === 'red' ? '붉은기가 도는' : '노란기와 붉은기가 고른'} 편이에요.`;
  const t2 = under === 'yellow' ? '코랄 · 피치 · 오렌지 브라운 계열 블러셔와 립이 자연스럽게 어울릴 가능성이 커요.'
    : under === 'red' ? '로즈 · 핑크 · 베리 계열 블러셔와 립이 맑아 보일 가능성이 커요.'
    : 'MLBB · 말린장미처럼 중간 톤 컬러가 무난해요.';
  return `${t1} ${t2} 조명과 화이트밸런스에 따라 색이 크게 달라지니 자연광에서 직접 발라 보고 고르세요.`;
}

// ---- 지금 분석한 스타일과의 궁합 ------------------------------------------------------
function matchStyle(f, style, t) {
  if (!style?.is_beauty) return null;
  const A = (g) => style.attributes.find((a) => a.group === g && a.score >= 0.5 && !a.all?.[0]?.hidden);
  const top = f.shape.probs[0].key, shapeName = short(SHAPES[top]);
  const near = f.shape.probs[1].p >= 0.25 ? f.shape.probs[1].key : null;
  const names = [...ALIAS[top], ...(near ? ALIAS[near] : [])];
  const genre = style.genre?.name ?? style.genre ?? '';
  if (style.category === 'hair') {
    const cut = A('cut'), bangs = A('bangs');
    const lines = [];
    let good = 0, bad = 0;
    if (cut && CUT_FACE[cut.label]) {
      const listed = CUT_FACE[cut.label][0].some((x) => names.includes(x));
      const ok = listed || top === 'oval'; // 계란형은 대부분의 커트를 소화한다
      ok ? good++ : bad++;
      lines.push(listed ? `${josa(cut.label, '은/는')} ${shapeName}에 잘 어울리는 커트예요. ${CUT_FACE[cut.label][1]}.`
        : ok ? `${josa(cut.label, '은/는')} 주로 ${CUT_FACE[cut.label][0].join(' · ')}에 추천하는 커트지만, ${shapeName}은 대부분의 커트가 잘 어울려요.`
        : `${josa(cut.label, '은/는')} 주로 ${CUT_FACE[cut.label][0].join(' · ')}에 추천하는 커트예요. ${josa(shapeName, '이라면/라면')} ${HAIR[top].tip}`);
    }
    if (bangs && BANGS_FACE[bangs.label]) {
      const ok = top === 'oval' || BANGS_BY_SHAPE[top].includes(bangs.label) || (near && BANGS_BY_SHAPE[near].includes(bangs.label))
        || names.some((x) => BANGS_FACE[bangs.label][0].includes(x)) || (bangs.label !== '앞머리 없음' && t.upper >= 0.8);
      ok ? good++ : bad++;
      const alt = hairAdvice(f, t).find((x) => x.key === 'bangs')?.list?.find((b) => b.name !== bangs.label)?.name;
      lines.push(ok ? `${bangs.label === '앞머리 없음' ? '이마를 드러내는 스타일' : bangs.label}도 잘 맞아요.`
        : `앞머리는 ${bangs.label === '앞머리 없음' ? '이마를 다 드러내기' : bangs.label}보다 ${alt ? josa(alt, '을/를') : '다른 앞머리를'} 추천해요.`);
    }
    if (!lines.length) return null;
    return { title: `지금 분석한 스타일 · ${genre}`, verdict: bad === 0 ? '잘 어울려요' : good ? '조금 바꾸면 더 좋아요' : '이렇게 바꾸면 더 잘 어울려요', good: bad === 0, text: lines.join(' ') };
  }
  if (style.category === 'makeup') {
    const cheek = A('cheek'), line = A('eyeLine'), lipT = A('lipTexture');
    const lines = [];
    let bad = 0;
    if (cheek && CHEEK_FACE[cheek.label]) {
      const faces = CHEEK_FACE[cheek.label][0];
      const ok = faces.includes('대부분') || names.some((x) => faces.includes(x.replace(' 얼굴', ''))) || faces.includes(shapeName);
      if (!ok) bad++;
      const how = cheek.label === '셰이딩' ? MAKEUP[top].shading : cheek.label === '하이라이터' ? MAKEUP[top].highlight : MAKEUP[top].blush;
      lines.push(`${cheek.label}: ${ok ? '얼굴형과 잘 맞아요.' : `주로 ${faces}에 추천해요. ${josa(shapeName, '이라면/라면')} ${how}`}`);
    }
    if (line && (line.label === '캣아이라인' || line.label === '강아지 라인')) {
      const ok = line.label === '캣아이라인' ? t.eyeUp < 0.8 : t.eyeUp > -0.8;
      if (!ok) bad++;
      lines.push(`${line.label}: ${ok ? '눈꼬리 각도와 잘 맞아요.' : line.label === '캣아이라인' ? '눈꼬리가 이미 올라간 편이라 꼬리를 덜 올리면 자연스러워요.' : '눈꼬리가 내려간 편이라 꼬리를 너무 내리면 처져 보일 수 있어요.'}`);
    }
    if (lipT && lipT.label === '오버립') {
      const ok = t.lipFull < 0.8;
      if (!ok) bad++;
      lines.push(`오버립: ${ok ? '입술 두께와 잘 맞아요.' : '입술이 도톰한 편이라 오버는 아주 살짝만 해 주세요.'}`);
    }
    if (!lines.length) return null;
    return { title: `지금 분석한 메이크업 · ${genre}`, verdict: bad ? '조금 바꾸면 더 좋아요' : '잘 어울려요', good: !bad, text: lines.join(' ') };
  }
  return null;
}

// ---- 메이크업 위치 그리기용 영역 (얼굴 좌표: 가로 u, 세로 v · 광대 너비 CW 기준) -------------
// [이름, 가로 위치(광대 너비 대비, 바깥 +), 기준 높이, 세로 보정(광대 너비 대비, 위 +), 가로 반지름, 세로 반지름, 기울기(도, + 면 바깥쪽 끝이 위), 가운데 하나만]
const Z = {
  shade: {
    oval: [['under', 0.4, 'nose', -0.06, 0.12, 0.05, 25]],
    round: [['side', 0.47, 'eye', -0.05, 0.06, 0.2, 0], ['under', 0.38, 'nose', -0.08, 0.14, 0.05, 28], ['jaw', 0.38, 'mouth', -0.04, 0.1, 0.07, 30]],
    long: [['top', 0, 'hair', -0.02, 0.32, 0.05, 0, true], ['chin', 0, 'menton', 0.03, 0.14, 0.04, 0, true]],
    square: [['jaw', 0.4, 'mouth', -0.03, 0.09, 0.09, 30], ['fore', 0.36, 'hair', -0.08, 0.08, 0.08, -30]],
    heart: [['temple', 0.4, 'browTop', 0.12, 0.08, 0.14, 0], ['chin', 0, 'menton', 0.03, 0.08, 0.035, 0, true]],
    diamond: [['cheek', 0.46, 'eye', -0.07, 0.06, 0.12, 0]],
  },
  light: {
    oval: [['fore', 0, 'browTop', 0.15, 0.08, 0.07, 0, true], ['nose', 0, 'eye', -0.1, 0.025, 0.12, 0, true], ['cheek', 0.25, 'eye', -0.12, 0.06, 0.03, 15], ['chin', 0, 'menton', 0.06, 0.05, 0.03, 0, true]],
    round: [['fore', 0, 'browTop', 0.14, 0.05, 0.12, 0, true], ['nose', 0, 'eye', -0.08, 0.022, 0.15, 0, true], ['chin', 0, 'menton', 0.06, 0.04, 0.035, 0, true]],
    long: [['cheek', 0.22, 'eye', -0.12, 0.09, 0.03, 0], ['nose', 0, 'eye', -0.04, 0.022, 0.07, 0, true]],
    square: [['fore', 0, 'browTop', 0.14, 0.08, 0.07, 0, true], ['nose', 0, 'eye', -0.1, 0.022, 0.12, 0, true], ['chin', 0, 'menton', 0.06, 0.05, 0.03, 0, true]],
    heart: [['jawside', 0.33, 'mouth', -0.03, 0.06, 0.06, 0], ['under', 0.2, 'eye', -0.1, 0.07, 0.03, 0], ['nose', 0, 'eye', -0.1, 0.022, 0.12, 0, true]],
    diamond: [['foreside', 0.25, 'browTop', 0.12, 0.08, 0.06, 0], ['jawside', 0.3, 'mouth', -0.05, 0.06, 0.05, 0], ['nose', 0, 'eye', -0.1, 0.022, 0.12, 0, true]],
  },
  blush: {
    oval: [['apple', 0.27, 'nose', 0.02, 0.09, 0.07, 0]],
    round: [['diag', 0.33, 'eye', -0.1, 0.12, 0.05, 28]],
    long: [['wide', 0.27, 'nose', 0.04, 0.14, 0.05, 0]],
    square: [['apple', 0.28, 'nose', 0.02, 0.09, 0.08, 0]],
    heart: [['low', 0.29, 'nose', -0.02, 0.12, 0.05, 0]],
    diamond: [['inner', 0.2, 'eye', -0.13, 0.1, 0.045, 0]],
  },
};
export function zonesFor(shapeKey) {
  const out = [];
  for (const [kind, table] of Object.entries(Z)) {
    for (const [, u, at, dv, ru, rv, rot, center] of table[shapeKey]) out.push({ kind, u, at, dv, ru, rv, rot, center: !!center });
  }
  return out;
}

// ---- 한데 모으기 ----------------------------------------------------------------------
export function faceReport(f, style = null) {
  const t = traits(f);
  const p = f.shape.probs;
  const near = p[1].p >= 0.2 ? p[1] : null;
  // 요약: 가장 두드러진 특징 3가지
  const notable = [
    [t.long, phrase('얼굴 길이가', t.long, '짧은 편', '긴 편')],
    [t.foreheadW, phrase('이마가', t.foreheadW, '좁은 편', '넓은 편')],
    [t.jawW, phrase('턱이', t.jawW, '좁은 편', '넓은 편')],
    [t.jawSharp, phrase('턱선이', t.jawSharp, '둥근 편', '각진 편')],
    [t.chinW, phrase('턱끝이', t.chinW, '뾰족한 편', '넓은 편')],
    [t.mid, phrase('중안부가', t.mid, '짧은 편', '긴 편')],
    [t.upper, phrase('이마 높이가', t.upper, '낮은 편', '높은 편')],
    [t.lower, phrase('하안부가', t.lower, '짧은 편', '긴 편')],
  ].filter(([, x]) => x).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 3).map(([, x]) => x);
  const a0 = short(p[0].label), a1 = near && short(near.label);
  const tie = near && p[0].p - near.p < 0.12;
  const headline = tie ? `${josa(a0, '과/와')} ${a1}의 중간` : p[0].label;
  const lead = tie ? `${josa(a0, '과/와')} ${a1}의 중간이에요 (${Math.round(p[0].p * 100)}% · ${Math.round(near.p * 100)}%).`
    : `${a0}에 가장 가까워요 (${Math.round(p[0].p * 100)}%${near ? ` · 다음은 ${a1} ${Math.round(near.p * 100)}%` : ''}).`;
  const summary = [lead, notable.length ? `${notable.join(', ')}이에요.` : '이마 · 광대 · 턱 너비와 길이가 평균에 가까운 고른 비율이에요.'];
  return {
    shape: p[0], near, headline, summary,
    measures: measures(f, t),
    hair: hairAdvice(f, t),
    makeup: makeupAdvice(f, t),
    match: matchStyle(f, style, t),
    zones: zonesFor(p[0].key),
    traits: t,
  };
}
