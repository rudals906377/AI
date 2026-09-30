// 속성 사전 (Taxonomy)
// - 각 카테고리는 여러 "속성 그룹"으로 구성되고, 그룹마다 독립적인 제로샷 분류를 수행한다.
// - ko: 화면 표시명 / en: CLIP 에 넣는 영어 설명 (구체적일수록 정확도 ↑)
// - templates: 라벨(en)을 감싸는 문장 틀. 여러 개를 평균내면(prompt ensembling) 안정적이다.

export const CATEGORY_ORDER = ['hair', 'nail', 'makeup', 'tattoo'];

export const TAXONOMY = {
  hair: {
    label: '헤어스타일',
    icon: '💇',
    detect: [
      'a photo of a person showing their hairstyle',
      "a photo of someone's hair and haircut",
      'a portrait photo where the hair is the main subject',
    ],
    groups: [
      {
        key: 'length', label: '길이',
        templates: ['a photo of a person with {}', 'a hairstyle photo showing {}'],
        labels: [
          { ko: '숏컷', en: 'very short cropped hair, a pixie cut or buzz cut' },
          { ko: '단발', en: 'chin-length bob hair that ends around the jaw' },
          { ko: '중단발', en: 'shoulder-length hair that ends at the shoulders' },
          { ko: '장발', en: 'long hair that falls well below the shoulders' },
        ],
      },
      {
        key: 'texture', label: '질감·컬',
        templates: ['a photo of a person with {}', 'a close-up photo of {}'],
        labels: [
          { ko: '스트레이트', en: 'sleek straight hair with no curls' },
          { ko: 'C컬', en: 'straight hair whose ends curl gently inward, a c-curl blowout' },
          { ko: 'S컬 웨이브', en: 'loose flowing s-shaped waves through the hair' },
          { ko: '굵은 웨이브', en: 'big bouncy voluminous curls' },
          { ko: '촘촘한 펌', en: 'tight small perm curls all over the hair' },
          { ko: '내추럴 곱슬', en: 'natural curly or coily textured hair' },
        ],
      },
      {
        key: 'bangs', label: '앞머리',
        templates: ['a photo of a person with {}', 'a hairstyle with {}'],
        labels: [
          { ko: '앞머리 없음', en: 'no bangs, hair swept away from the forehead' },
          { ko: '풀뱅', en: 'full thick blunt bangs covering the forehead' },
          { ko: '시스루뱅', en: 'thin wispy see-through bangs' },
          { ko: '사이드뱅', en: 'side-swept bangs brushed to one side' },
          { ko: '커튼뱅', en: 'curtain bangs parted in the middle framing the face' },
          { ko: '확인 불가', en: 'the back of the head seen from behind, the forehead and bangs are not visible' },
        ],
      },
      {
        key: 'color', label: '색상',
        templates: ['a photo of a person with {}', 'a photo of {}'],
        labels: [
          { ko: '블랙', en: 'natural jet black hair' },
          { ko: '다크 브라운', en: 'dark brown hair' },
          { ko: '브라운', en: 'light brown or chestnut brown hair' },
          { ko: '애쉬', en: 'ash grey toned hair, a muted ash brown or ash blonde' },
          { ko: '블론드', en: 'blonde hair' },
          { ko: '레드·오렌지', en: 'red, copper or orange dyed hair' },
          { ko: '핑크·파스텔', en: 'pink, lavender or pastel dyed hair' },
          { ko: '블루·퍼플', en: 'vivid blue or purple dyed hair' },
          { ko: '투톤·하이라이트', en: 'two-tone hair with highlights, balayage or ombre' },
          { ko: '그레이·화이트', en: 'silver grey or white hair' },
        ],
      },
      {
        key: 'style', label: '커트·스타일',
        templates: ['a photo of a person with a {}', 'a {} hairstyle'],
        labels: [
          { ko: '레이어드컷', en: 'layered haircut with soft layers throughout' },
          { ko: '허쉬컷', en: 'hush cut, a soft shaggy layered cut with face-framing pieces' },
          { ko: '울프컷', en: 'wolf cut, a choppy shag with a mullet-like shape and volume on top' },
          { ko: '원랭스 보브', en: 'blunt one-length bob cut' },
          { ko: '포니테일', en: 'ponytail tied back' },
          { ko: '업스타일·번', en: 'updo with the hair tied up in a bun' },
          { ko: '땋은 머리', en: 'braided hairstyle with braids' },
          { ko: '반묶음', en: 'half-up half-down hairstyle' },
          { ko: '슬릭백', en: 'slicked back hair combed straight back' },
          { ko: '투블럭·언더컷', en: 'undercut with shaved short sides and longer hair on top' },
          { ko: '댄디컷', en: 'neat short side-parted men\'s haircut' },
          { ko: '리젠트·포마드', en: "men's pompadour, short hair on the sides with the front swept up and slicked back with pomade" },
        ],
      },
      {
        key: 'mood', label: '분위기',
        templates: ['a photo of a {} hairstyle', 'a {} hair look'],
        labels: [
          { ko: '내추럴', en: 'natural effortless everyday' },
          { ko: '단정한', en: 'neat tidy polished' },
          { ko: '러블리', en: 'cute lovely feminine' },
          { ko: '시크', en: 'chic edgy stylish' },
          { ko: '글래머러스', en: 'glamorous voluminous' },
          { ko: '개성 있는', en: 'bold unconventional punk' },
        ],
      },
    ],
  },

  nail: {
    label: '네일아트',
    icon: '💅',
    detect: [
      'a close-up photo of fingernails with nail polish',
      'a photo of a manicure with nail art',
      'a photo of a hand showing painted nails',
    ],
    groups: [
      {
        key: 'shape', label: '모양',
        templates: ['a close-up photo of {} nails', 'a manicure with {} nail shape'],
        labels: [
          { ko: '스퀘어', en: 'square shaped flat-tipped' },
          { ko: '라운드', en: 'round shaped' },
          { ko: '오벌', en: 'oval shaped' },
          { ko: '아몬드', en: 'almond shaped tapered' },
          { ko: '코핀·발레리나', en: 'coffin ballerina shaped with a squared-off tapered tip' },
          { ko: '스틸레토', en: 'sharp pointed stiletto' },
        ],
      },
      {
        key: 'length', label: '길이',
        templates: ['a close-up photo of {}', 'a manicure on {}'],
        labels: [
          { ko: '숏', en: 'short natural-length nails' },
          { ko: '미디엄', en: 'medium length nails' },
          { ko: '롱', en: 'very long extended acrylic nails' },
        ],
      },
      {
        key: 'color', label: '베이스 컬러',
        templates: ['a close-up photo of {} nails', 'a manicure in {}'],
        labels: [
          { ko: '누드·베이지', en: 'nude beige' },
          { ko: '화이트·밀키', en: 'white or milky sheer' },
          { ko: '핑크', en: 'pink' },
          { ko: '레드·와인', en: 'red or burgundy wine' },
          { ko: '블랙·그레이', en: 'black or dark grey' },
          { ko: '파스텔', en: 'soft pastel mint lavender or baby blue' },
          { ko: '비비드', en: 'bright vivid yellow orange or green' },
          { ko: '블루·네이비', en: 'blue or navy' },
          { ko: '퍼플', en: 'purple or violet' },
          { ko: '브라운·테라코타', en: 'brown or terracotta' },
        ],
      },
      {
        key: 'technique', label: '기법·디자인',
        templates: ['a close-up photo of {}', 'nail art with {}'],
        labels: [
          { ko: '원컬러', en: 'plain solid one-color nails' },
          { ko: '프렌치', en: 'french tip nails with white tips' },
          { ko: '그라데이션', en: 'ombre gradient nails fading between two colors' },
          { ko: '글리터', en: 'sparkling glitter nails' },
          { ko: '마블', en: 'marble pattern nails with swirls' },
          { ko: '크롬·미러', en: 'chrome mirror metallic nails' },
          { ko: '오로라·캣아이', en: 'holographic aurora or magnetic cat-eye nails' },
          { ko: '파츠·스톤', en: 'nails decorated with rhinestones, gems and 3D charms' },
          { ko: '아트 드로잉', en: 'hand-painted nail art with detailed drawings' },
          { ko: '패턴', en: 'checkered, striped or polka dot patterned nails' },
          { ko: '플라워', en: 'floral flower pattern nails' },
          { ko: '매트', en: 'matte finish nails with no shine' },
        ],
      },
      {
        key: 'mood', label: '분위기',
        templates: ['a photo of {} nails', 'a {} manicure'],
        labels: [
          { ko: '심플·데일리', en: 'simple minimal everyday' },
          { ko: '화려한', en: 'glamorous elaborate bling' },
          { ko: '러블리', en: 'cute lovely girly' },
          { ko: '시크', en: 'chic dark edgy' },
          { ko: '시즌·이벤트', en: 'seasonal holiday themed christmas or halloween' },
        ],
      },
    ],
  },

  makeup: {
    label: '메이크업',
    icon: '💄',
    detect: [
      'a close-up photo of a face wearing makeup',
      'a beauty photo showing eye makeup and lipstick',
      'a portrait photo focusing on the makeup look',
    ],
    groups: [
      {
        key: 'mood', label: '전체 무드',
        templates: ['a photo of a face with {} makeup', 'a {} makeup look'],
        labels: [
          { ko: '내추럴·데일리', en: 'natural minimal no-makeup style everyday' },
          { ko: '글램', en: 'glamorous full-coverage evening' },
          { ko: '스모키', en: 'dark dramatic smokey eye' },
          { ko: '파티·아트', en: 'bold artistic party stage makeup with glitter and bright colors' },
          { ko: '청순·소프트', en: 'soft romantic pink-toned innocent' },
          { ko: '클래식', en: 'classic elegant makeup with red lips' },
          { ko: '브라이덜', en: 'bridal wedding' },
        ],
      },
      {
        key: 'base', label: '베이스',
        templates: ['a close-up photo of a face with {}', 'makeup with {}'],
        labels: [
          { ko: '매트', en: 'a matte powdered skin finish' },
          { ko: '세미매트', en: 'a natural semi-matte skin finish' },
          { ko: '글로우', en: 'a dewy glowing luminous skin finish' },
        ],
      },
      {
        key: 'eye', label: '아이 메이크업',
        templates: ['a close-up photo of eyes with {}', 'eye makeup with {}'],
        labels: [
          { ko: '내추럴 음영', en: 'subtle neutral brown eyeshadow' },
          { ko: '스모키', en: 'dark smokey black eyeshadow' },
          { ko: '글리터·펄', en: 'sparkly glitter shimmer eyeshadow' },
          { ko: '윙 아이라인', en: 'bold winged eyeliner' },
          { ko: '컬러 포인트', en: 'colorful blue purple or green eyeshadow' },
          { ko: '속눈썹 강조', en: 'dramatic long false lashes' },
          { ko: '핑크·코랄 섀도', en: 'pink or coral toned eyeshadow' },
        ],
      },
      {
        key: 'lip', label: '립 컬러',
        templates: ['a close-up photo of lips with {}', 'makeup with {}'],
        labels: [
          { ko: '레드', en: 'red lipstick' },
          { ko: '코랄·오렌지', en: 'coral orange lipstick' },
          { ko: '핑크', en: 'pink lipstick' },
          { ko: '누드·MLBB', en: 'nude natural my-lips-but-better lipstick' },
          { ko: '딥·버건디', en: 'deep burgundy plum lipstick' },
        ],
      },
      {
        key: 'lipTexture', label: '립 질감',
        templates: ['a close-up photo of {}', 'lips with {}'],
        labels: [
          { ko: '매트', en: 'matte velvet lipstick' },
          { ko: '글로시', en: 'shiny glossy lips' },
          { ko: '틴트', en: 'sheer tinted stained lips' },
        ],
      },
      {
        key: 'point', label: '포인트',
        templates: ['a photo of a face with {}', 'makeup featuring {}'],
        labels: [
          { ko: '블러셔 강조', en: 'visible rosy pink blush on the cheeks' },
          { ko: '하이라이터', en: 'glowing highlighter on the cheekbones' },
          { ko: '컨투어링', en: 'sculpted contoured cheekbones' },
          { ko: '또렷한 눈썹', en: 'defined bold eyebrows' },
          { ko: '미니멀', en: 'minimal makeup with almost no blush or contour' },
        ],
      },
    ],
  },

  tattoo: {
    label: '타투',
    icon: '🖋️',
    detect: [
      'a photo of a tattoo on skin',
      'a close-up photo of tattooed skin',
      'a photo of a person showing their tattoo',
    ],
    groups: [
      {
        key: 'style', label: '스타일',
        templates: ['a photo of a {} tattoo', 'a {} style tattoo on skin'],
        labels: [
          { ko: '파인라인·미니멀', en: 'fine line minimalist thin single-needle' },
          { ko: '블랙워크', en: 'bold solid blackwork' },
          { ko: '올드스쿨', en: 'american traditional old school with bold outlines and limited colors' },
          { ko: '뉴스쿨', en: 'new school cartoon-like exaggerated colorful' },
          { ko: '리얼리즘', en: 'photorealistic realism' },
          { ko: '수채화', en: 'watercolor splash painterly' },
          { ko: '레터링', en: 'lettering script calligraphy text' },
          { ko: '일러스트', en: 'illustrative sketch-like drawing' },
          { ko: '트라이벌', en: 'tribal polynesian black pattern' },
          { ko: '이레즈미', en: 'japanese irezumi traditional with waves, koi or dragons' },
          { ko: '지오메트릭·도트워크', en: 'geometric dotwork mandala' },
        ],
      },
      {
        key: 'color', label: '색',
        templates: ['a photo of a {} tattoo', 'a {} tattoo on skin'],
        labels: [
          { ko: '블랙&그레이', en: 'black and grey shaded monochrome' },
          { ko: '컬러', en: 'fully colored vibrant' },
          { ko: '블랙 + 포인트 컬러', en: 'mostly black with a small accent of color' },
        ],
      },
      {
        key: 'subject', label: '소재',
        templates: ['a photo of a tattoo of {}', 'a {} tattoo'],
        labels: [
          { ko: '꽃·식물', en: 'flowers, leaves or plants' },
          { ko: '동물', en: 'an animal such as a lion, wolf, cat or bird' },
          { ko: '문자·숫자', en: 'words, letters or numbers' },
          { ko: '기하학 도형', en: 'geometric shapes and lines' },
          { ko: '인물·얼굴', en: 'a human face or portrait' },
          { ko: '자연·우주', en: 'the moon, stars, sun, waves or mountains' },
          { ko: '사물', en: 'an object such as a clock, key, anchor or knife' },
          { ko: '신화·판타지', en: 'a dragon, phoenix, skull or mythical creature' },
          { ko: '캐릭터', en: 'a cartoon or anime character' },
        ],
      },
      {
        key: 'placement', label: '위치',
        templates: ['a photo of a tattoo on the {}', 'a {} tattoo'],
        labels: [
          { ko: '전완(팔뚝)', en: 'forearm' },
          { ko: '상완·어깨', en: 'upper arm and shoulder' },
          { ko: '손·손목·손가락', en: 'hand, wrist or fingers' },
          { ko: '등', en: 'back' },
          { ko: '가슴·쇄골', en: 'chest or collarbone' },
          { ko: '다리·허벅지', en: 'leg, thigh or calf' },
          { ko: '발목·발', en: 'ankle or foot' },
          { ko: '목·귀 뒤', en: 'neck or behind the ear' },
          { ko: '옆구리·갈비', en: 'ribcage or side of the torso' },
        ],
      },
      {
        key: 'size', label: '크기',
        templates: ['a photo of a {}', '{} on skin'],
        labels: [
          { ko: '미니', en: 'tiny small tattoo' },
          { ko: '중간', en: 'medium sized tattoo' },
          { ko: '대형', en: 'large full sleeve or full back tattoo covering a big area' },
        ],
      },
    ],
  },
};

// 그룹별 신뢰도 문구 규칙
export const CONFIDENCE = {
  high: 0.6,   // 이 이상이면 단정
  mid: 0.4,    // 이 이상이면 "~로 보이며, ~일 가능성도"
};
