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
const SHORT = /픽시컷|빅시컷|투블럭컷|크롭컷|페이드컷|버즈컷|가일컷|아이비리그컷|댄디컷|모히칸|쉼표머리|가르마펌|애즈펌|리프컷|포마드|머쉬룸컷|레이어드 숏컷|언더컷|테이퍼컷/;

// ---- 추천과 '피하면 좋은 스타일'이 서로 어긋나지 않게 ------------------------------------
// 커트 · 앞머리마다 모양 특징을 붙이고, 얼굴형마다 피할 특징을 정해 겹치는 추천은 뺀다
// sideShort: 옆머리를 짧게 치거나 민다 · bluntBangs: 눈썹 위 일자 앞머리 · heavyBangs: 이마 · 눈썹을 덮는 무거운 앞머리
// highTop: 윗머리를 높이 세운다 · allBack: 이마를 다 드러내 넘긴다 · chinBlunt: 턱선에서 일자로 끊긴다 · flatLong: 층 없이 매끈하게 떨어지는 긴 생머리
// 추천 기준별로 먼저 보여 줄 커트 (목록에서 빼지는 않고 순서만 바꾼다)
const MEN_FIRST = /댄디컷|투블럭컷|가일컷|리프컷|아이비리그컷|크롭컷|페이드컷|버즈컷|쉼표머리|가르마펌|애즈펌|포마드|언더컷|테이퍼컷|머쉬룸컷|레이어드 숏컷|울프컷|멀릿컷|레이어드컷|허쉬컷/;
const WOMEN_FIRST = /픽시컷|빅시컷|레이어드 숏컷|숏 보브|보브컷|A라인 보브|칼단발|태슬컷|히메컷|레이어드컷|허쉬컷|원랭스|V라인컷|울프컷/;
const SHAPE_TAGS = {
  투블럭컷: ['sideShort'], 언더컷: ['sideShort', 'highTop'], 페이드컷: ['sideShort'], 버즈컷: ['sideShort'], 모히칸: ['sideShort', 'highTop'],
  멀릿컷: ['sideShort'], 원랭스: ['flatLong'], 크롭컷: ['sideShort', 'bluntBangs'], 머쉬룸컷: ['heavyBangs'], 댄디컷: ['heavyBangs'],
  '포마드·슬릭백': ['allBack', 'highTop'], 울프컷: ['highTop'], '레이어드 숏컷': ['highTop'], 칼단발: ['chinBlunt'],
  풀뱅: ['bluntBangs', 'heavyBangs'], 처피뱅: ['bluntBangs'],
};
// 얼굴형별 피할 특징 (HAIR / HAIR_M 의 avoid 문장과 같은 내용)
const AVOID_TAGS = {
  f: { oval: ['heavyBangs'], round: ['chinBlunt', 'bluntBangs'], long: ['highTop', 'allBack', 'flatLong'], square: ['chinBlunt', 'bluntBangs', 'heavyBangs', 'sideShort'], heart: ['highTop', 'allBack', 'flatLong'], diamond: ['highTop', 'allBack'] },
  m: { oval: ['heavyBangs'], round: ['heavyBangs', 'bluntBangs'], long: ['highTop', 'allBack', 'sideShort'], square: ['sideShort', 'heavyBangs'], heart: ['allBack', 'highTop'], diamond: ['sideShort', 'highTop'] },
};
const clashes = (name, avoid) => (SHAPE_TAGS[name] || []).some((t) => avoid.includes(t));

// ---- 측정값 → 특징 ----------------------------------------------------------------
const z = (k, x, i) => (i == null ? (x - NORM[k][0]) / NORM[k][1] : (x - NORM[k][i][0]) / NORM[k][i][1]);
// 귀: 정면(고개 8° 이내)에서 두 귀가 모두 보일 때만 돌출 정도를 말한다. 기준은 시험 사진 60장으로 정했다 (face.js 의 m.ears)
// out = 귀가 얼굴 윤곽 밖으로 보이는 폭 (광대 너비 대비). 두 쪽 평균과 작은 쪽을 같이 봐서, 한쪽만 손 · 배경이 잡힌 경우는 빼낸다
function earState(f) {
  const e = f.m.ears;
  if (!e) return null;
  if (e.shown < 0.1 && e.hair >= 0.4) return 'hidden';
  const each = e.each || [];
  const minOut = Math.min(...each.map((x) => x.out)), minShown = Math.min(...each.map((x) => x.shown));
  if (Math.abs(f.pose?.yaw ?? 0) > 8 || minShown < 0.2) return null;   // 고개를 돌렸거나 한쪽 귀가 잘 안 보이면 말하지 않는다
  if (e.out >= 0.125 && minOut >= 0.1) return 'out';
  if (e.out >= 0.115 && minOut >= 0.095) return 'slight';
  return 'normal';
}
function traits(f) {
  const m = f.m;
  const t = {
    long: z('ratio', m.ratio), foreheadW: z('forehead', m.forehead), jawW: z('jaw', m.jaw), chinW: z('chin', m.chin),
    jawSharp: -z('jawAngle', m.jawAngle), upper: z('thirds', m.thirds[0], 0), mid: z('thirds', m.thirds[1], 1), lower: z('thirds', m.thirds[2], 2),
    philtrum: z('philtrum', m.philtrum), eyeWide: z('eyeSpacing', m.eyeSpacing), eyeRound: z('eyeAspect', m.eyeAspect), eyeUp: z('eyeTilt', m.eyeTilt),
    browGap: z('browGap', m.browGap), browArch: z('browArch', m.browArch), noseW: z('nose', m.nose), mouthW: z('mouth', m.mouth),
    upperThin: z('lips', m.lips), lipFull: z('lipFull', m.lipFull),
  };
  t.ears = earState(f);
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
  if (t.ears) {
    const e = f.m.ears;
    const EAR = { hidden: ['머리카락에 가려 보이지 않음', '귀 모양은 보지 않았어요'], out: [`옆으로 보이는 폭 ${fx(e.out)}`, '귀가 옆으로 잘 보이는 편이에요'],
      slight: [`옆으로 보이는 폭 ${fx(e.out)}`, '귀가 옆으로 약간 보이는 편이에요'], normal: [`옆으로 보이는 폭 ${fx(e.out)}`, null] };
    row('ears', '귀 (정면)', EAR[t.ears][0], '0.09', EAR[t.ears][1], t.ears === 'out' ? 1.6 : t.ears === 'slight' ? 0.9 : 0);
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
// 남성 헤어 (추천 기준을 '남성'으로 골랐을 때). 커트 이름은 suits.js 표와 같은 것을 쓴다
const HAIR_M = {
  oval: {
    idea: '비율이 고른 얼굴이라 대부분의 남자 커트가 잘 어울려요. 이마를 드러내는 스타일로 얼굴선을 보여 주면 장점이 살아나요.',
    length: '옆 · 뒤를 짧게 정리한 투블럭부터 윗머리를 길게 남긴 스타일까지 기장 제약이 거의 없어요.',
    part: '가르마 없이 내린 앞머리, 6:4 가르마, 넘긴 머리 모두 잘 어울려요.',
    avoid: ['얼굴을 다 덮는 무거운 덮머 (고른 얼굴선을 가려요)'],
  },
  round: {
    idea: '윗머리에 높이를 주고 옆은 짧고 납작하게 정리해 세로 라인을 만드는 것이 핵심이에요.',
    length: '옆 · 뒤는 짧게(투블럭 · 페이드), 윗머리는 길게 남겨 볼륨을 세워 주세요.',
    part: '6:4나 7:3 가르마로 이마를 사선으로 드러내거나, 앞머리를 올려 넘기면 얼굴이 길어 보여요.',
    avoid: ['옆머리가 부푸는 스타일', '이마를 일자로 덮는 무거운 덮머', '전체를 같은 길이로 둥글게 자른 커트'],
  },
  long: {
    idea: '윗머리 높이는 낮추고 옆에 볼륨을 남겨 가로 폭을 만드는 것이 핵심이에요. 앞머리로 이마를 덮으면 얼굴이 짧아 보여요.',
    length: '옆머리를 너무 짧게 치지 말고 귀를 살짝 덮는 기장을 남겨 주세요. 윗머리는 높이 세우지 않아요.',
    part: '앞머리를 내리는 덮머 · 시스루 스타일이 잘 어울려요. 가르마를 탄다면 낮게 옆으로 흘려 주세요.',
    avoid: ['윗머리를 높이 세우는 포마드 · 리젠트', '옆을 바짝 민 투블럭 · 페이드', '이마를 다 드러내는 올백'],
  },
  square: {
    idea: '턱 각이 강조되지 않게 윗머리에 부드러운 결과 볼륨을 주고, 옆은 너무 짧게 치지 않는 것이 핵심이에요.',
    length: '옆 · 뒤는 적당히 짧게 하되 귀 위를 바짝 밀지 않고, 윗머리에 펌이나 결을 살려 주세요.',
    part: '가르마를 사선으로 타거나 앞머리를 자연스럽게 흘려 직선을 줄여 주세요.',
    avoid: ['옆을 바짝 민 각진 투블럭 (턱 각이 강조돼요)', '일자로 떨어지는 무거운 덮머', '버즈컷처럼 전체를 짧게 민 스타일'],
  },
  heart: {
    idea: '넓은 이마는 앞머리로 덮고, 윗머리 높이는 낮춰 위아래 균형을 맞추는 것이 핵심이에요.',
    length: '옆머리는 너무 짧지 않게 남겨 턱 쪽이 허전해 보이지 않게 해 주세요.',
    part: '앞머리를 내리거나 이마를 사선으로 살짝만 드러내는 가르마가 좋아요.',
    avoid: ['이마를 다 드러내는 올백 · 포마드', '윗머리를 높이 세우는 스타일'],
  },
  diamond: {
    idea: '광대 옆이 튀어 보이지 않게 옆머리를 살짝 남기고, 이마는 앞머리로 채우는 것이 핵심이에요.',
    length: '옆머리를 바짝 밀기보다 광대 높이까지 자연스럽게 덮는 기장이 좋아요.',
    part: '앞머리를 내리거나 가르마 쪽 머리를 살짝 띄워 이마 양옆을 채워 주세요.',
    avoid: ['옆을 바짝 민 투블럭 · 페이드 (광대가 강조돼요)', '윗머리만 높이 세우는 스타일'],
  },
};
// 추천 기준(성별)은 보여 주는 순서와 설명만 바꾼다. 남자 장발 · 여자 숏컷도 있으므로 긴 머리 · 짧은 머리 추천을 모두 보여 준다
function hairAdvice(f, t, gender = null) {
  const top = f.shape.probs[0].key, second = f.shape.probs[1];
  const keys = [top, ...(second.p > 0.25 ? [second.key] : [])];
  const aliases = keys.flatMap((k) => ALIAS[k]);
  if (t.upper >= 0.8 || t.foreheadW >= 0.8) aliases.push('이마가 넓은 얼굴');
  // 화면에 두 가지(긴 머리 · 짧은 머리) 피할 스타일을 모두 보여 주므로, 추천은 두 쪽 피할 특징과 모두 겹치지 않아야 한다
  const avoidTags = [...new Set([...AVOID_TAGS.f[top], ...AVOID_TAGS.m[top], ...(t.ears === 'out' ? ['sideShort'] : [])])];
  // 커트: suits.js 표에서 내 얼굴형이 들어간 커트
  const cuts = Object.entries(CUT_FACE).filter(([, [faces]]) => faces.some((x) => aliases.includes(x)))
    .map(([name, [faces, why]]) => ({ name, why, primary: faces.some((x) => ALIAS[top].includes(x)) }))
    .filter((c) => !clashes(c.name, avoidTags))
    .map((c) => ({ ...c, pref: gender && (gender === 'm' ? MEN_FIRST : WOMEN_FIRST).test(c.name) ? 1 : 0 }))
    .sort((a, b) => b.pref - a.pref || b.primary - a.primary);   // 고른 기준에서 흔한 커트를 먼저 (빼지는 않는다)
  const longCuts = cuts.filter((c) => !SHORT.test(c.name)).slice(0, 4), shortCuts = cuts.filter((c) => SHORT.test(c.name)).slice(0, 4);
  // 앞머리
  const bangNames = [...new Set([...BANGS_BY_SHAPE[top], ...Object.entries(BANGS_FACE).filter(([, [faces]]) => aliases.some((a) => faces.includes(a))).map(([n]) => n)])];
  let bangs = bangNames.map((name) => ({ name, why: BANGS_FACE[name][1] }));
  if (t.upper >= 0.8) bangs = bangs.filter((b) => b.name !== '앞머리 없음');
  if (t.upper <= -0.8 && !bangs.some((b) => b.name === '앞머리 없음')) bangs.push({ name: '앞머리 없음', why: BANGS_FACE['앞머리 없음'][1] + ' 이마가 짧은 편이라 드러내면 비율이 좋아 보여요' });
  bangs = bangs.filter((b) => !clashes(b.name, avoidTags));
  const L = HAIR[top], S = HAIR_M[top];            // 긴 머리 · 단발 기준 표, 짧은 머리 기준 표
  const extra = [];
  if (t.upper >= 0.8) extra.push(`상안부(이마)가 ${say(t.upper, '짧은 편', '긴 편')}이라 앞머리로 이마를 덮으면 얼굴 비율이 맞아 보여요.`);
  if (t.upper <= -0.8) extra.push('이마가 짧은 편이라 앞머리를 무겁게 내리기보다 이마를 드러내거나 시스루뱅처럼 가볍게 내리는 편이 좋아요.');
  if (t.mid >= 0.8) extra.push('중안부가 긴 편이라 눈썹~광대 높이에 앞머리 끝이나 옆머리 레이어가 오면 세로 길이가 끊겨 보여요.');
  if (t.lower >= 0.8 || t.chinW <= -0.8) extra.push(`${t.lower >= 0.8 ? '하안부가 긴 편' : '턱끝이 뾰족한 편'}이라 머리를 기른다면 턱 높이에 컬이나 볼륨이 오는 기장이 아래 얼굴을 채워 줘요.`);
  if (t.jawW >= 0.8 && top !== 'square') extra.push('턱이 넓은 편이라 턱선에서 끊기는 기장보다 턱 아래로 내려오는 기장이 좋아요.');
  if (t.ears === 'out') extra.push('귀가 옆으로 잘 보이는 편이라 옆머리를 바짝 치거나 귀 뒤로 넘기기보다, 귀를 반쯤 덮는 옆머리 기장이나 귀 높이의 볼륨이 시선을 부드럽게 분산해 줘요.');
  else if (t.ears === 'slight') extra.push('귀가 옆으로 약간 보이는 편이라 짧은 머리라면 귀 윗부분을 살짝 덮는 기장을 남기면 옆선이 정돈돼 보여요.');
  else if (t.ears === 'normal') extra.push('정면에서 귀가 크게 두드러지지 않는 편이라 귀를 드러내는 스타일(귀 뒤로 넘기기 · 짧은 옆머리)도 부담 없어요. 귀걸이로 포인트를 주기에도 좋아요.');
  const shortFirst = gender === 'm';
  const longSec = longCuts.length && { key: 'cuts', title: gender === 'm' ? '추천 커트 · 긴 머리 · 장발' : '추천 커트 · 긴 머리와 단발', list: longCuts.map((c) => ({ name: c.name, why: c.why })) };
  const shortSec = shortCuts.length && { key: 'short', title: '추천 커트 · 짧은 머리', list: shortCuts.map((c) => ({ name: c.name, why: c.why })) };
  const two = (a, b) => (shortFirst ? [b, a] : [a, b]);
  const [lenA, lenB] = two(`긴 머리 · 단발이라면 ${L.length}`, `짧은 머리라면 ${S.length}`);
  const [partA, partB] = two(`긴 머리 · 단발: ${L.part}`, `짧은 머리: ${S.part}`);
  const avoid = two(L.avoid.map((x) => ({ name: `(긴 머리 · 단발) ${x}` })), S.avoid.map((x) => ({ name: `(짧은 머리) ${x}` }))).flat();
  if (t.ears === 'out') avoid.push({ name: '(귀) 옆머리를 바짝 쳐서 귀가 다 드러나는 스타일 · 귀 뒤로 꽉 넘겨 고정하는 스타일' });
  return [
    { key: 'idea', title: '핵심', text: [(shortFirst ? S : L).idea, ...extra].join(' ') },
    ...two(longSec, shortSec),
    bangs.length && { key: 'bangs', title: '추천 앞머리', list: bangs.slice(0, 4) },
    { key: 'length', title: '기장 · 볼륨 위치', text: `${lenA} ${lenB}` },
    { key: 'part', title: '가르마', text: `${partA} ${partB}` },
    { key: 'avoid', title: '피하면 좋은 스타일', list: avoid },
  ].filter(Boolean);
}

// ---- 메이크업 추천 ------------------------------------------------------------------
const MAKEUP = {
  oval: {
    idea: '균형이 좋은 얼굴형이라 윤곽을 바꾸기보다 입체감만 살리면 돼요. 어떤 메이크업도 잘 받는 편이에요.',
    shading: '윤곽을 크게 바꿀 필요가 없어요. 광대 아래와 턱선 끝에 아주 연하게만 넣어 주세요.',
    highlight: '이마 가운데 · 콧대 · 광대 위 · 턱끝에 가볍게 올려 입체감을 살려요.',
    blush: '웃을 때 올라오는 볼 가운데에 둥글게 넣어 주세요. 어떤 모양도 무난해요.',
    brow: '자연스러운 아치 눈썹과 일자 눈썹 모두 잘 어울려요.',
  },
  round: {
    idea: '세로 라인을 만들어 얼굴이 길고 갸름해 보이게 하는 것이 핵심이에요. 얼굴 바깥은 어둡게, 가운데는 세로로 밝게 해 주세요.',
    shading: '관자놀이에서 광대 아래를 지나 턱선까지, 얼굴 바깥쪽을 따라 세로로 넣어 볼 폭을 줄여 주세요.',
    highlight: '이마 가운데에서 콧대까지 세로로 길게, 턱끝에도 살짝 올려 얼굴이 길어 보이게 해요.',
    blush: '볼 가운데보다 조금 바깥에서 관자놀이 쪽으로 사선으로 길게 올려 주세요.',
    brow: '눈썹 산이 살짝 있는 아치형으로, 꼬리를 너무 내리지 않게 그려 세로감을 주세요.',
  },
  long: {
    idea: '가로 라인을 만들어 얼굴 길이를 줄여 보이게 하는 것이 핵심이에요. 위아래 끝은 어둡게, 볼은 가로로 넓게 채워 주세요.',
    shading: '헤어라인(이마 위)과 턱끝 아래를 가로로 쉐딩해 위아래 길이를 줄여 주세요.',
    highlight: '눈 밑 광대 위에 가로로 짧게 올리고, 콧대 하이라이트는 짧게 끊어 주세요.',
    blush: '볼 가운데에서 바깥쪽으로 가로로 넓게 펴 바르면 얼굴 길이가 짧아 보여요.',
    brow: '산을 낮춘 일자 눈썹을 길게 그리면 가로 라인이 생겨요.',
  },
  square: {
    idea: '곡선으로 턱 모서리의 각을 부드럽게 만드는 것이 핵심이에요. 모서리는 어둡게, 블러셔와 눈썹은 둥글게 해 주세요.',
    shading: '턱 모서리(귀 아래 각진 부분)와 이마 양쪽 모서리를 둥글게 깎듯이 쉐딩해 주세요.',
    highlight: '이마 가운데 · 콧대 · 턱끝에 올려 시선을 얼굴 가운데로 모아요.',
    blush: '광대 가운데에 둥글게 넣어 곡선을 더해 주세요.',
    brow: '각지지 않은 부드러운 아치 눈썹이 턱의 직선을 중화해요.',
  },
  heart: {
    idea: '넓은 이마는 줄여 보이게 하고 좁은 턱 쪽은 밝게 채워 위아래 균형을 맞추는 것이 핵심이에요.',
    shading: '이마 양옆(관자놀이)을 쉐딩해 이마 폭을 줄이고, 뾰족한 턱끝은 아주 살짝만 눌러 주세요.',
    highlight: '턱 양옆과 눈 밑에 하이라이트를 넣어 좁은 아래 얼굴을 채워 보이게 해요.',
    blush: '광대 바로 아래에 가로로 둥글게 넣어 얼굴 아래쪽에 시선이 가게 해 주세요.',
    brow: '산이 완만하고 둥근 눈썹이 좋아요. 너무 진하거나 각진 눈썹은 이마를 넓어 보이게 해요.',
  },
  diamond: {
    idea: '튀어나온 광대는 줄여 보이게 하고 좁은 이마와 턱 쪽은 밝게 넓혀 주는 것이 핵심이에요.',
    shading: '가장 튀어나온 광대 바깥쪽에 넣어 폭을 줄여 주세요. 턱 · 이마에는 넣지 않아요.',
    highlight: '이마 양옆과 턱 양옆을 밝혀 좁은 위아래를 넓어 보이게 해요.',
    blush: '광대 꼭대기보다 안쪽(눈 밑 앞쪽)에 가로로 넣어 광대가 덜 도드라져 보이게 해요.',
    brow: '길고 완만한 아치 눈썹으로 이마 폭이 넓어 보이게 해 주세요.',
  },
};
// 남성: 색조 대신 그루밍 위주 (피부 · 눈썹 · 가벼운 윤곽 · 입술 보습)
function groomingAdvice(f, t) {
  const M = MAKEUP[f.shape.probs[0].key];
  const extra = [];
  if (t.browGap <= -0.8) extra.push('눈썹과 눈 사이가 가까운 편이라 눈썹 아래 잔털을 정리하면 눈매가 시원해 보여요.');
  if (t.eyeWide >= 0.8) extra.push('미간이 넓은 편이라 눈썹 앞머리를 살짝 안쪽까지 채우면 인상이 또렷해져요.');
  return [
    { key: 'idea', title: `그루밍 핵심 · ${short(f.shape.probs[0].label)}`, text: '피부 결을 정리하고 눈썹 모양을 다듬는 것만으로 인상이 가장 크게 달라져요. 색조보다 자연스러움이 먼저예요.' },
    { key: 'base', title: '피부', text: '톤업 크림이나 비비는 얇게, 잡티 · 붉은기만 컨실러로 가려 주세요. 번들거리는 T존은 파우더로 가볍게 눌러 주면 깔끔해요.' },
    { key: 'brow', title: '눈썹', text: [M.brow.replace('아치 눈썹과 일자 눈썹', '일자 눈썹과 살짝 각진 눈썹'), ...extra].join(' ') },
    { key: 'shading', title: '윤곽 (선택)', text: `쉐딩은 얼굴형 보정이 필요할 때만 아주 연하게: ${M.shading}`, zone: 'shade' },
    { key: 'lips', title: '입술', text: '각질을 정리하고 립밤으로 보습해 주세요. 혈색이 필요하면 색이 살짝 도는 틴티드 립밤 정도가 자연스러워요.' },
  ];
}
function makeupAdvice(f, t) {
  const M = MAKEUP[f.shape.probs[0].key];
  const near = f.shape.probs[1];
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
  const topKey = f.shape.probs[0].key;
  // 둥근 얼굴은 블러셔를 사선으로 올리라고 했으므로, 중안부 보정에서 '가로 블러셔'를 다시 말하지 않는다
  if (t.mid >= 0.8) base.push(topKey === 'round' ? '중안부가 긴 편이라 애교살을 살리고 콧대 하이라이트를 코끝까지 내리지 말고 짧게 끊으면 가운데 길이가 짧아 보여요.'
    : `중안부가 긴 편이라 블러셔를 눈 밑 가까이 가로로 넣고(숙취 블러셔) 애교살을 살리면 가운데 길이가 짧아 보여요. 콧대 하이라이트는 코끝까지 내리지 말고 짧게 끊어 주세요.`);
  if (t.lower >= 0.8) base.push('하안부가 긴 편이라 턱끝 아래를 쉐딩하고, 윗입술을 또렷하게 그려 시선을 위로 올려 주세요.');
  if (t.upper >= 0.8) base.push('이마가 긴 편이라 헤어라인을 따라 쉐딩을 가볍게 넣으면 이마가 줄어 보여요.');
  if (t.noseW >= 0.8) base.push('콧볼이 넓은 편이라 콧볼 양옆에 세로로 노즈 쉐딩을 넣고, 하이라이트는 콧대에 가늘게 올려 주세요.');
  // 얼굴형 이름만으로는 빠지는 특징 (예: 계란형인데 턱이 넓은 편)
  const top = f.shape.probs[0].key, shapeExtra = [];
  if (t.foreheadW >= 0.8 && top !== 'heart') shapeExtra.push('이마가 넓은 편이라 이마 양옆 헤어라인을 따라 쉐딩을 조금 더해 주세요.');
  if (t.jawW >= 0.8 && top !== 'square') shapeExtra.push('턱이 넓은 편이라 귀 아래 턱선 바깥에 쉐딩을 조금 더해 주세요.');
  if (t.chinW <= -0.8 && top !== 'heart') shapeExtra.push('턱끝이 뾰족한 편이라 턱끝 쉐딩은 빼고 턱 양옆을 밝게 해 주세요.');
  if (t.long >= 0.8 && top !== 'long') shapeExtra.push('얼굴이 긴 편이라 블러셔를 가로로 넣으면 길이가 짧아 보여요.');
  else if (t.long <= -0.8 && top !== 'round') shapeExtra.push('얼굴이 짧은 편이라 콧대와 이마 가운데 하이라이트를 세로로 길게 올려 주세요.');
  const BLUSH_SHORT = { oval: '볼 가운데 둥근 블러셔', round: '관자놀이 쪽으로 올리는 사선 블러셔', long: '가로로 넓게 펴는 블러셔', square: '광대 가운데 둥근 블러셔', heart: '광대 아래 가로 블러셔', diamond: '눈 밑 안쪽 가로 블러셔' };
  // 두 번째 얼굴형의 블러셔가 1위 얼굴형과 반대 방향이면(가로 ↔ 사선) 말하지 않는다
  const BLUSH_DIR = { oval: 'round', round: 'up', long: 'flat', square: 'round', heart: 'flat', diamond: 'flat' };
  const dirClash = (a, b) => (a === 'up' && b === 'flat') || (a === 'flat' && b === 'up');
  if (near && near.p >= 0.25 && !dirClash(BLUSH_DIR[top], BLUSH_DIR[near.key])) shapeExtra.push(`${short(near.label)}에도 가까워서 ${BLUSH_SHORT[near.key]}도 잘 어울려요.`);
  // 피부 톤 (사진 조명 영향이 커서 참고용)
  const tone = f.skin && skinHint(f.skin);
  return [
    { key: 'idea', title: `얼굴형 메이크업 핵심 · ${short(f.shape.probs[0].label)}`, text: [M.idea, ...shapeExtra].join(' ') },
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

// ---- 원하는 스타일 여러 장 → 내 얼굴 기준 순위 ------------------------------------------
// 사진마다 스타일 분석 결과(커트 · 앞머리 · 기장 · 연출 / 블러셔 · 아이라인 · 입술)를 내 얼굴 측정과 맞춰 점수를 매긴다.
// 점수는 '추천표와 얼마나 맞는지'의 합이라 절대적인 평가가 아니고, 고른 사진들끼리 비교하는 용도다.
const EAR_OPEN = /포니테일|똥머리|슬릭번|업스타일|올백|스페이스번/;
function scoreStyle(f, style, t, gender) {
  const A = (g) => style.attributes.find((a) => a.group === g && a.score >= 0.4 && !a.all?.[0]?.hidden);
  const top = f.shape.probs[0].key, shapeName = short(SHAPES[top]);
  const near = f.shape.probs[1].p >= 0.25 ? f.shape.probs[1].key : null;
  const names = [...ALIAS[top], ...(near ? ALIAS[near] : [])];
  const reasons = [];
  // 근거마다 그 속성을 얼마나 확신하는지(0.4~1)만큼 반영한다 → 같은 커트라도 더 또렷한 사진이 위로
  let c = 1;
  const conf = (a) => (c = 0.6 + 0.4 * Math.min(1, (a.score - 0.4) / 0.5));
  const add = (pts, text) => reasons.push({ pts: pts * c, text });
  if (style.category === 'hair') {
    const avoidTags = [...new Set([...AVOID_TAGS.f[top], ...AVOID_TAGS.m[top], ...(t.ears === 'out' ? ['sideShort'] : [])])];
    const cut = A('cut'), bangs = A('bangs'), len = A('length'), styling = A('styling'), perm = A('perm');
    if (cut) {
      conf(cut);
      const faces = CUT_FACE[cut.label]?.[0] || [];
      if (clashes(cut.label, avoidTags)) add(-20, `${josa(cut.label, '은/는')} ${shapeName}에서 피하면 좋은 모양이 들어 있어요`);
      else if (faces.some((x) => ALIAS[top].includes(x))) add(22, `${josa(cut.label, '은/는')} ${shapeName}에 추천하는 커트예요`);
      else if (near && faces.some((x) => ALIAS[near].includes(x))) add(12, `${josa(cut.label, '은/는')} 가까운 얼굴형(${short(SHAPES[near])})에 추천하는 커트예요`);
      else if (top === 'oval') add(10, `${shapeName}은 ${josa(cut.label, '을/를')} 포함해 대부분의 커트를 소화해요`);
      else if (faces.length) add(-8, `${josa(cut.label, '은/는')} 주로 ${faces.join(' · ')}에 추천하는 커트예요`);
    }
    if (bangs && bangs.label !== '확인 불가' && BANGS_FACE[bangs.label]) {
      conf(bangs);
      const ok = BANGS_BY_SHAPE[top].includes(bangs.label) || (near && BANGS_BY_SHAPE[near].includes(bangs.label)) || names.some((x) => BANGS_FACE[bangs.label][0].includes(x));
      if (clashes(bangs.label, avoidTags)) add(-12, `${josa(bangs.label, '은/는')} ${shapeName}에서 피하면 좋은 앞머리예요`);
      else if (bangs.label === '앞머리 없음' && t.upper >= 0.8) add(-10, '이마가 긴 편이라 이마를 다 드러내기보다 앞머리가 있으면 좋아요');
      else if (bangs.label !== '앞머리 없음' && t.upper >= 0.8) add(10, `이마가 긴 편이라 ${josa(bangs.label, '이/가')} 비율을 맞춰 줘요`);
      else if (ok) add(10, `${bangs.label === '앞머리 없음' ? '이마를 드러내는 스타일' : bangs.label}도 얼굴형과 잘 맞아요`);
    }
    if (len) {
      conf(len);
      if (top === 'long' && len.label === '긴머리' && (!perm || /생머리|매직/.test(perm.label))) add(-8, '긴 얼굴형에 층 없는 긴 생머리는 얼굴이 더 길어 보일 수 있어요');
      if (top === 'long' && (len.label === '단발' || len.label === '중단발')) add(6, '턱~어깨 기장이라 얼굴 길이가 짧아 보여요');
      if (top === 'round' && len.label === '중단발') add(5, '턱 아래로 내려오는 기장이 얼굴을 갸름해 보이게 해요');
      if ((t.lower >= 0.8 || t.chinW <= -0.8) && (len.label === '단발' || len.label === '중단발') && perm && !/생머리|매직/.test(perm.label)) add(6, '턱 높이의 컬이 아래 얼굴을 채워 줘요');
    }
    if (perm && conf(perm) && top === 'long' && /S컬|물결|빌드|히피|글램|셋팅/.test(perm.label)) add(5, `${perm.label}의 옆 볼륨이 얼굴 길이를 줄여 보이게 해요`);
    c = 1;
    if (t.ears === 'out') {
      if ((cut && clashes(cut.label, ['sideShort'])) || (styling && EAR_OPEN.test(styling.label))) add(-10, '귀가 옆으로 잘 보이는 편이라 귀가 다 드러나는 스타일은 귀가 더 강조될 수 있어요');
      else if (len && len.label !== '숏컷') add(5, '귀를 덮는 기장이라 옆선이 부드러워 보여요');
    } else if (t.ears === 'normal' && styling && EAR_OPEN.test(styling.label)) add(4, '귀가 크게 두드러지지 않아 귀를 드러내는 연출도 부담 없어요');
  } else if (style.category === 'makeup') {
    const cheek = A('cheek'), line = A('eyeLine'), lipT = A('lipTexture'), brow = A('brow');
    if (cheek && CHEEK_FACE[cheek.label]) {
      conf(cheek);
      const faces = CHEEK_FACE[cheek.label][0];
      const ok = faces.includes('대부분') || names.some((x) => faces.includes(x.replace(' 얼굴', ''))) || faces.includes(shapeName);
      ok ? add(14, `${josa(cheek.label, '이/가')} 얼굴형과 잘 맞아요`) : add(-10, `${josa(cheek.label, '은/는')} 주로 ${faces}에 추천해요`);
    }
    if (line && (line.label === '캣아이라인' || line.label === '강아지 라인')) {
      conf(line);
      const ok = line.label === '캣아이라인' ? t.eyeUp < 0.8 : t.eyeUp > -0.8;
      ok ? add(10, `${josa(line.label, '이/가')} 눈꼬리 각도와 잘 맞아요`) : add(-10, line.label === '캣아이라인' ? '눈꼬리가 이미 올라간 편이라 캣아이라인은 날카로워 보일 수 있어요' : '눈꼬리가 내려간 편이라 강아지 라인은 처져 보일 수 있어요');
    }
    if (lipT && lipT.label === '오버립' && conf(lipT)) t.lipFull < 0.8 ? add(6, '입술 두께에 오버립이 잘 맞아요') : add(-8, '입술이 도톰한 편이라 오버립은 아주 살짝만 하는 게 좋아요');
    if (brow) {
      conf(brow);
      if (brow.label === '일자 눈썹' && top === 'long') add(8, '일자 눈썹이 긴 얼굴형에 가로 라인을 만들어 줘요');
      if (brow.label === '아치 눈썹' && (top === 'round' || top === 'square')) add(8, `아치 눈썹이 ${shapeName}의 윤곽을 부드럽게 해 줘요`);
      if (brow.label === '일자 눈썹' && top === 'round') add(-5, '둥근 얼굴형은 일자 눈썹보다 살짝 아치가 있는 눈썹이 갸름해 보여요');
    }
  }
  const sum = reasons.reduce((a, r) => a + r.pts, 0);
  // 근거가 없으면 60점(중간)에서 시작해 근거마다 더하고 뺀다
  const score = Math.max(5, Math.min(98, Math.round(60 + sum)));
  return { score, raw: sum, reasons: reasons.sort((a, b) => b.pts - a.pts), basis: reasons.length };
}
export function rankStyles(f, items, { purpose = 'hair', gender = null } = {}) {
  const t = traits(f);
  const out = items.map((it) => {
    const r = it.result;
    if (!r) return { ...it, skip: '분석하지 못했어요' };
    if (r.many) return { ...it, skip: '여러 사람이 함께 나온 사진이라 뺐어요' };
    if (!r.is_beauty) return { ...it, skip: '뷰티 사진이 아니라서 뺐어요' };
    if (r.category !== purpose) return { ...it, skip: `${r.category === 'hair' ? '헤어' : r.category === 'makeup' ? '메이크업' : r.category === 'nail' ? '네일' : '타투'} 사진이라 ${purpose === 'hair' ? '헤어' : '메이크업'} 비교에서 뺐어요` };
    const s = scoreStyle(f, r, t, gender);
    if (!s.basis) return { ...it, skip: '얼굴형과 맞춰 볼 단서(커트 · 앞머리 · 블러셔 등)를 찾지 못했어요' };
    return { ...it, ...s, name: r.genre?.name ?? r.headline };
  });
  const ranked = out.filter((x) => !x.skip).sort((a, b) => b.raw - a.raw || b.basis - a.basis);
  return { ranked, skipped: out.filter((x) => x.skip) };
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
// 얼굴형마다 장점을 살려 주는 한마디 (재치 + 바로 쓸 수 있는 팁)
const SHAPE_QUIP = {
  oval: ['어떤 스타일도 잘 받는 얼굴이라 오히려 고르는 게 고민인, 행복한 고민형이에요. 이번엔 평소 안 해 본 스타일에 도전해 보세요.',
    '교과서에 예시로 실릴 법한 균형이에요. 실패 걱정이 적으니 유행 스타일을 먼저 시험해 보기 좋아요.',
    '디자이너가 반가워하는 얼굴이에요. 머리보다 분위기와 컬러로 변화를 줘 보세요.'],
  round: ['부드럽고 어려 보이는 인상이 강점이에요. 세로 라인 하나만 더하면 분위기가 확 달라져요.',
    '첫인상에서 친근함 점수를 먼저 따고 들어가는 얼굴이에요. 정수리 볼륨만 살려도 얼굴이 길어 보여요.',
    '나이보다 어려 보인다는 말을 자주 듣는 얼굴이에요. 옆선은 가볍게, 위는 높게가 공식이에요.'],
  long: ['시원하고 성숙한 인상이에요. 앞머리 하나로 동안 효과까지 챙길 수 있는 얼굴이에요.',
    '세련된 분위기가 기본으로 깔린 얼굴이에요. 옆으로 볼륨을 넣으면 비율이 한결 편안해져요.',
    '모델 화보에서 자주 보이는 비율이에요. 정수리는 차분하게, 귀 옆에 볼륨을 주세요.'],
  square: ['또렷하고 신뢰감 있는 윤곽이에요. 곡선 하나만 더하면 부드러움까지 챙기는 반전 매력이 생겨요.',
    '사진에서 윤곽이 살아나는, 카메라가 좋아하는 얼굴이에요. 턱선 아래로 떨어지는 웨이브가 잘 어울려요.',
    '단단하고 믿음직한 인상이에요. 옆머리에 층을 살짝 넣으면 턱선이 부드러워져요.'],
  heart: ['이마는 시원하고 턱선은 갸름한, 사진발 좋은 비율이에요. 턱 주변에 볼륨을 주면 균형이 완성돼요.',
    '셀카 각도를 이미 타고난 얼굴이에요. 턱선 길이의 단발이 특히 잘 받아요.',
    '이목구비가 위쪽에서 시선을 모으는 얼굴이에요. 시스루 앞머리로 이마를 살짝 덮으면 균형이 좋아져요.'],
  diamond: ['광대가 입체감을 만들어 주는, 조명이 좋아하는 얼굴이에요. 옆머리로 광대를 살짝 감싸면 더 부드러워져요.',
    '조각 같은 입체감이 있는 얼굴이에요. 이마와 턱 쪽에 볼륨을 주면 전체가 한결 둥글게 보여요.',
    '화보 조명 아래에서 진가가 나오는 윤곽이에요. 광대 높이에서 끝나는 앞머리는 피하고 그 아래로 내려 주세요.'],
};
export function faceReport(f, style = null, { gender = null } = {}) {
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
    shape: p[0], near, headline, summary, quip: (SHAPE_QUIP[p[0].key] || SHAPE_QUIP.oval)[Math.round(p[0].p * 1000 + (p[1]?.p || 0) * 100) % 3],
    measures: measures(f, t),
    hair: hairAdvice(f, t, gender),
    makeup: gender === 'm' ? groomingAdvice(f, t) : makeupAdvice(f, t),
    gender,
    match: matchStyle(f, style, t),
    zones: zonesFor(p[0].key).filter((z) => gender !== 'm' || z.kind !== 'blush'), // 남성(그루밍)은 블러셔 위치를 그리지 않는다
    traits: t,
  };
}
