// 시술 요청서 — 분석 결과를 살롱 · 네일숍 · 타투숍에 그대로 보여 줄 수 있는 요약으로 바꾼다
//
//   const order = buildOrder(result, colors);
//   order.rows   : [{ label, value, alt, sure }]  확신이 있는 항목 (중간 확신은 alt 로 다른 후보를 함께 적는다)
//   order.checks : ['커트: 레이어드컷 또는 허쉬컷']  사진만으로 확실하지 않아 상담 때 정할 항목
//   order.notes  : 시술 전에 알아 두면 좋은 일반적인 안내
//   order.text   : 복사 · 공유용 글

import { CONFIDENCE } from './taxonomy.js';

// 카테고리마다 요청서에 넣는 항목과 순서 (label 이 없으면 속성 그룹 이름을 쓴다)
const FIELDS = {
  hair: [['cut'], ['length'], ['bangs'], ['perm'], ['color'], ['colorTech'], ['styling'], ['mood', '원하는 분위기']],
  nail: [['part'], ['shape'], ['length'], ['color'], ['design'], ['layout'], ['finish'], ['mood', '원하는 분위기']],
  makeup: [['mood', '무드'], ['base'], ['eye'], ['eyeLine'], ['lash'], ['brow'], ['lip'], ['lipTexture'], ['cheek'], ['detail'], ['tone']],
  tattoo: [['style'], ['subject'], ['color'], ['placement'], ['size']],
};
const TITLE = { hair: '헤어', nail: '네일', makeup: '메이크업', tattoo: '타투' };
const FOR = { hair: '디자이너', nail: '네일리스트', makeup: '아티스트', tattoo: '타투이스트' };

// 탈색 없이 어두운 모발에 바로 내기 어려운 밝은 색
const LIGHT_HAIR = new Set(['애쉬베이지', '애쉬블론드', '골드블론드', '애쉬그레이', '핑크·라벤더', '블루·퍼플', '그린·민트', '비비드 레드', '밀크브라운', '로즈골드', '플래티넘·화이트', '코퍼·오렌지']);
const NAIL_EXTRA = new Set(['파츠', '진주', '3D조형', '크롬하츠', '캐릭터', '드로잉', '자개', '레이스', '라인아트', '과일']);

export function buildOrder(r, colors = {}) {
  const cat = r.category;
  const by = Object.fromEntries(r.attributes.map((a) => [a.group, a]));
  const rows = [];
  const checks = [];
  for (const [key, name] of FIELDS[cat] || []) {
    let a = by[key];
    if (!a || a.all[0].hidden) continue;
    const label = name || a.group_label;
    // 계열로 더 확실하면 '단발 보브 계열 (A라인 보브 / 보브컷)'처럼 적고 세부는 상담 때 정한다
    if (a.family && a.family.score >= CONFIDENCE.mid) {
      rows.push({ key, label, value: a.family.label, alt: a.family.members.map((m) => m.label).slice(0, 3).join(' / '), sure: a.family.level === 'high', family: true });
      continue;
    }
    const alt = a.all.slice(1).find((x) => !x.hidden);
    if (a.score < CONFIDENCE.mid) {
      // 확신이 낮으면 표에 넣지 않고 '상담 때 정할 것'으로 돌린다
      checks.push(`${label}: ${alt ? `${a.label} 또는 ${alt.label}` : a.label}`);
      continue;
    }
    // 단정 기준은 그룹마다 다르다 (a.high: 그 그룹에서 95% 맞는 확률, 없으면 공통 기준)
    const high = a.high ?? CONFIDENCE.high;
    rows.push({ key, label, value: a.label, alt: a.score < high && alt && alt.score >= 0.15 ? alt.label : null, sure: a.score >= high });
  }

  // 타투: '도안'(큰 묶음) 아래 세부 모티브(장미 · 늑대 …)를 따로 적는다. 확신이 낮으면 상담 때 정할 것으로
  const mo = cat === 'tattoo' ? by.subject?.motifs || [] : [];
  if (mo.length) {
    const [m0, m1] = mo;
    const two = m1 && m1.score >= 0.15 ? `${m0.ko} · ${m1.ko}` : m0.ko;
    const at = rows.findIndex((x) => x.key === 'subject');
    if (m0.level !== 'low') rows.splice(at < 0 ? Math.min(1, rows.length) : at + 1, 0, { key: 'motif', label: '모티브', value: two, alt: null, sure: m0.level === 'high' });
    else checks.push(`모티브: ${m1 ? `${m0.ko} 또는 ${m1.ko}` : m0.ko}`);
  }

  // 헤어 컬러 행에 톤 · 사진에서 뽑은 실제 색을 붙인다
  const colorRow = rows.find((x) => x.key === 'color');
  if (cat === 'hair' && colorRow) {
    const tone = by.tone;
    if (tone && tone.score >= CONFIDENCE.mid && tone.label !== '뉴트럴') colorRow.extra = tone.label;
    if (colors.hair) colorRow.swatch = colors.hair;
  }
  if (cat === 'nail' && colorRow && colors.nail) colorRow.swatch = colors.nail;
  if (cat === 'makeup') {
    const lip = rows.find((x) => x.key === 'lip');
    if (lip && colors.lip) lip.swatch = colors.lip;
    const eye = rows.find((x) => x.key === 'eye');
    if (eye && colors.eye) eye.swatch = colors.eye;
  }

  // 분류 확신이 낮아 '상담 때 정할 것'으로 간 색 항목이라도, 사진에서 실제 색을 뽑았으면 그 색으로 적는다
  // (눈두덩 색은 피부와 섞여 덜 정확하므로 쓰지 않는다)
  const MEASURED = { hair: [['color', 'hair']], nail: [['color', 'nail']], makeup: [['lip', 'lip']] }[cat] || [];
  for (const [key, part] of MEASURED) {
    const sw = colors[part];
    if (!sw || rows.some((x) => x.key === key)) continue;
    const a = by[key];
    const label = (FIELDS[cat].find(([k]) => k === key) || [])[1] || a?.group_label;
    const at = checks.findIndex((c) => c.startsWith(`${label}:`));
    if (at >= 0) checks.splice(at, 1);
    const pos = FIELDS[cat].findIndex(([k]) => k === key);
    const row = { key, label, value: sw.name ? `${sw.name} 계열` : sw.hex, alt: null, sure: false, measured: true, swatch: sw };
    const after = rows.findIndex((x) => FIELDS[cat].findIndex(([k]) => k === x.key) > pos);
    rows.splice(after < 0 ? rows.length : after, 0, row);
  }

  const notes = notesFor(cat, by, colors);
  const genre = r.genre?.level !== 'low' ? r.genre?.name : null;
  const text = toText(cat, genre, rows, checks, notes);
  return { title: `시술 요청서 · ${TITLE[cat]}`, to: FOR[cat], genre, rows, checks, notes, text };
}

function notesFor(cat, by, colors) {
  const n = [];
  const sure = (key) => by[key] && by[key].score >= CONFIDENCE.mid ? by[key].label : null;
  if (cat === 'hair') {
    const color = sure('color');
    if (color && LIGHT_HAIR.has(color)) n.push('밝은 색이라 지금 모발 색에 따라 탈색이 먼저 필요할 수 있어요.');
    if (['하이라이트', '발레아쥬', '옴브레', '브릿지', '이너컬러', '투톤'].includes(sure('colorTech'))) n.push('부분 염색 기법은 넣을 위치와 폭을 사진으로 함께 짚어 주면 정확해요.');
    if (['히피펌', 'S컬펌', '빌드펌', '물결펌'].includes(sure('perm'))) n.push('펌의 컬 크기는 지금 기장과 모발 굵기에 따라 달라질 수 있어요.');
    if (colors.hair) n.push('사진 속 색은 조명 영향을 받아요. 실제 색은 컬러 차트로 다시 맞춰 보세요.');
  }
  if (cat === 'nail') {
    if (sure('length') === '롱네일') n.push('손톱이 짧다면 연장이 필요할 수 있어요.');
    if (NAIL_EXTRA.has(sure('design'))) n.push('파츠 · 그림 · 조형 같은 아트는 매장마다 추가 금액이 다르니 미리 확인해 보세요.');
    if (sure('layout') === '오마카세') n.push('오마카세는 손가락마다 디자인이 달라서 사진을 그대로 보여 주는 게 가장 정확해요.');
    if (colors.nail) n.push('사진 속 색은 조명 영향을 받아요. 컬러 샘플로 다시 맞춰 보세요.');
  }
  if (cat === 'makeup') {
    if (sure('lash') === '인형 속눈썹') n.push('인조 속눈썹을 붙일지 마스카라로만 할지 정해 두면 좋아요.');
    if (colors.lip || colors.eye) n.push('사진 속 색은 조명 영향을 받아요. 실제 제품 색은 손등에 발라 비교해 보세요.');
  }
  if (cat === 'tattoo') {
    n.push('크기는 사진만으로 정확하지 않아요. 원하는 크기를 cm 로 정해 주세요.');
    n.push('다른 작가의 작업을 그대로 따라 하기보다 작가와 상의해 내 도안으로 바꾸는 걸 권해요.');
    if (['풀컬러', '포인트컬러', '레드', '파스텔'].includes(sure('color'))) n.push('컬러 타투는 피부 톤에 따라 발색이 달라 보일 수 있어요.');
  }
  return n;
}

export function swatchText(s) {
  if (!s) return '';
  const parts = [s.hex];
  if (s.name) parts.push(`${s.name} 계열`);
  if (s.level) parts.push(`약 ${s.level}레벨`);
  return parts.join(' · ');
}

function toText(cat, genre, rows, checks, notes) {
  const L = [`[시술 요청서 · ${TITLE[cat]}]`];
  if (genre) L.push(`원하는 스타일: ${genre}`);
  for (const x of rows) {
    let v = x.value;
    if (x.extra) v += ` (${x.extra})`;
    if (x.alt) v += ` / ${x.alt}일 수도 있음`;
    if (x.swatch) v += x.measured ? ` (사진 속 색 ${swatchText({ ...x.swatch, name: null })})` : ` · 사진 속 색 ${swatchText(x.swatch)}`;
    L.push(`${x.label}: ${v}`);
  }
  if (checks.length) L.push('', '상담 때 정할 것', ...checks.map((c) => `- ${c}`));
  if (notes.length) L.push('', '참고', ...notes.map((c) => `- ${c}`));
  L.push('', '사진을 AI 로 분석한 참고용 요약입니다. 실제 시술은 상담 후 정해 주세요.');
  return L.join('\n');
}
