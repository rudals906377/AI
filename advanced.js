// 고급 모드 — 소형 VLM(LFM2.5-VL-450M) 이 사진을 직접 보고 자유 서술한다.
// 기본 모드(CLIP 속성 분석)와 별개로, 사용자가 켰을 때만 로드된다.
//
// 이 모델은 영어로 쓸 때 가장 정확하고 자세하다. 그래서
//   1) 카테고리별 전문가 프롬프트로 영어 상세 서술을 받고
//   2) 뷰티 용어집으로 핵심 용어를 먼저 한국어로 바꾼 뒤, 문장 단위로 한국어 번역한다.
//
//   const describer = await createDescriber({ device: 'webgpu', onProgress });
//   const { en, ko } = await describer.describe(file, 'hair', { onEnglish, onKorean });

import {
  AutoProcessor,
  AutoModelForImageTextToText,
  RawImage,
  TextStreamer,
} from '@huggingface/transformers';

export const VLM_MODEL = 'onnx-community/LFM2.5-VL-450M-ONNX';

// 카테고리별 프롬프트 — 무엇을 순서대로 짚을지 명시하고, 옷·배경은 제외시킨다
export const VLM_PROMPTS = {
  hair: 'You are a professional hair stylist. Describe only the hairstyle in this photo in detail: length, curl or wave type, bangs, hair color and any dye technique, cut shape and layers, styling, and the overall vibe. Do not describe clothing, the face or the background. Write one paragraph of 4 to 6 sentences.',
  nail: 'You are a professional nail artist. Describe only the nail art in this photo in detail: nail shape and length, base color, techniques (such as french tips, ombre, glitter, chrome, rhinestones), patterns or motifs on specific nails, and the overall vibe. Do not describe the background. Write one paragraph of 4 to 6 sentences.',
  makeup: 'You are a professional makeup artist. Describe only the makeup in this photo in detail: skin finish, eyeshadow colors and placement, eyeliner, lashes, brows, blush and contour, lip color and texture, and the overall mood. Do not describe clothing, jewelry or the background. Write one paragraph of 4 to 6 sentences.',
  tattoo: 'You are a professional tattoo artist. Describe only the tattoo in this photo in detail: body placement, size, style (such as fine line, blackwork, realism, watercolor, traditional), use of color and shading, subject and composition, and the overall impression. Do not describe the background. Write one paragraph of 4 to 6 sentences.',
};

const TRANSLATE_SYSTEM =
  'You are a professional English-to-Korean translator for beauty content. Translate the user text into natural, fluent Korean. Keep any Korean words that are already in the text. Output only the Korean translation, nothing else.';

// 소형 모델이 자주 틀리는 뷰티 용어는 번역 전에 한국어로 고정한다 (긴 표현부터 치환)
const GLOSSARY = [
  ['hairstyle', '헤어스타일'], ['haircut', '헤어컷'], ['nail art', '네일아트'], ['nails', '손톱'], ['makeup', '메이크업'], ['make-up', '메이크업'],
  ['tattoo', '타투'], ['thumbnail', '엄지 손톱'], ['thumb', '엄지'], ['index finger', '검지'], ['middle finger', '중지'],
  ['ring finger', '약지'], ['pinky', '새끼손가락'], ['bicep', '이두근'], ['shoulder-length', '어깨 길이'],
  ['French manicure', '프렌치 네일'], ['French tips', '프렌치 팁'], ['French tip', '프렌치 팁'],
  ['cat-eye', '캣아이'], ['cat eye', '캣아이'], ['ombre', '옴브레(그라데이션)'], ['gradient', '그라데이션'],
  ['rhinestones', '큐빅 스톤'], ['rhinestone', '큐빅 스톤'], ['glitter', '글리터'], ['chrome', '크롬'],
  ['almond-shaped', '아몬드형'], ['almond shaped', '아몬드형'], ['coffin', '코핀'], ['stiletto', '스틸레토'],
  ['cuticle', '큐티클'], ['acrylic', '아크릴'], ['gel', '젤'], ['manicure', '매니큐어'],
  ['curtain bangs', '커튼뱅'], ['see-through bangs', '시스루뱅'], ['bangs', '앞머리'], ['fringe', '앞머리'],
  ['bob', '보브'], ['pixie cut', '픽시컷'], ['layers', '레이어드'], ['layered', '레이어드'], ['balayage', '발레아쥬'],
  ['highlights', '하이라이트'], ['ponytail', '포니테일'], ['updo', '업스타일'], ['braids', '땋은 머리'], ['braid', '땋은 머리'],
  ['waves', '웨이브'], ['wavy', '웨이브'], ['curls', '컬'], ['curly', '곱슬'],
  ['eyeshadow', '아이섀도'], ['eyeliner', '아이라인'], ['winged', '윙'], ['lashes', '속눈썹'], ['brows', '눈썹'], ['eyebrows', '눈썹'],
  ['blush', '블러셔'], ['contour', '컨투어'], ['highlighter', '하이라이터'], ['foundation', '파운데이션'],
  ['matte', '매트'], ['glossy', '글로시'], ['dewy', '촉촉한 광'], ['lipstick', '립스틱'], ['lip gloss', '립글로스'], ['smokey', '스모키'], ['smoky', '스모키'],
  ['fine line', '파인라인'], ['fine-line', '파인라인'], ['blackwork', '블랙워크'], ['linework', '라인워크'], ['dotwork', '도트워크'],
  ['realism', '리얼리즘'], ['realistic', '사실적인'], ['watercolor', '수채화'], ['old school', '올드스쿨'], ['traditional', '트래디셔널'],
  ['shading', '음영'], ['grayscale', '흑백'], ['black and grey', '블랙앤그레이'], ['black and gray', '블랙앤그레이'],
  ['sleeve', '슬리브'], ['forearm', '팔뚝'], ['upper arm', '윗팔'], ['wrist', '손목'],
  ['wolf', '늑대'], ['lion', '사자'], ['tiger', '호랑이'], ['phoenix', '불사조'], ['dragon', '용'], ['koi', '잉어'], ['rose', '장미'], ['roses', '장미'],
];
function applyGlossary(text) {
  let out = text;
  for (const [en, ko] of [...GLOSSARY].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`\\b${en.replace(/[-]/g, '[- ]')}\\b`, 'gi'), ko);
  }
  return out;
}
// 소형 모델이 번역 대신 "주어진 텍스트는…" 같은 말을 하거나 영어를 그대로 두는 경우 걸러낸다
function looksTranslated(ko, en) {
  if (!ko) return false;
  if (/번역|주어진|텍스트|원문|translat/i.test(ko)) return false;
  const hangul = (ko.match(/[가-힣]/g) || []).length;
  const latin = (ko.match(/[A-Za-z]/g) || []).length;
  if (hangul < 5 || latin > hangul * 0.3) return false;
  if (ko.length > en.length * 1.6) return false; // 없는 내용을 지어낸 경우
  return true;
}
function splitSentences(text) {
  return text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

export async function createDescriber({ device = 'webgpu', onProgress } = {}) {
  const progress_callback = (p) => onProgress?.(p);
  const dtype = device === 'webgpu'
    ? { embed_tokens: 'fp16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' }
    : { embed_tokens: 'q8', vision_encoder: 'q8', decoder_model_merged: 'q4' };

  const processor = await AutoProcessor.from_pretrained(VLM_MODEL, { progress_callback });
  const model = await AutoModelForImageTextToText.from_pretrained(VLM_MODEL, { device, dtype, progress_callback });

  async function generate(messages, image, { maxTokens, onToken }) {
    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = image
      ? await processor(image, prompt, { add_special_tokens: false })
      : processor.tokenizer(prompt, { add_special_tokens: false });
    const streamer = onToken
      ? new TextStreamer(processor.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onToken })
      : undefined;
    const out = await model.generate({
      ...inputs,
      max_new_tokens: maxTokens,
      do_sample: false,
      repetition_penalty: 1.1,
      no_repeat_ngram_size: 4,
      streamer,
    });
    return processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0].trim();
  }

  async function describe(source, category, { onEnglish, onKorean, translate = true } = {}) {
    const image = source instanceof RawImage ? source : await RawImage.read(source);
    const t0 = Date.now();

    // 1) 영어 상세 서술
    const en = await generate(
      [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: VLM_PROMPTS[category] ?? VLM_PROMPTS.hair }] }],
      image,
      { maxTokens: 240, onToken: onEnglish },
    );
    const t1 = Date.now();

    // 2) 문장 단위 한국어 번역 (짧게 끊어야 소형 모델이 덜 틀린다)
    let ko = '';
    if (translate) {
      for (const sentence of splitSentences(en)) {
        const part = await generate(
          [{ role: 'system', content: TRANSLATE_SYSTEM }, { role: 'user', content: applyGlossary(sentence) }],
          null,
          { maxTokens: 160 },
        );
        const clean = part.split('\n')[0].trim();
        if (!looksTranslated(clean, sentence)) continue; // 번역 실패·메타 발언은 버린다 (영어 원문은 따로 보여 줌)
        ko += (ko ? ' ' : '') + clean;
        onKorean?.(ko);
      }
    }
    return { en, ko, elapsed_ms: Date.now() - t0, en_ms: t1 - t0, ko_ms: Date.now() - t1, model: VLM_MODEL, device };
  }

  return { describe, model: VLM_MODEL, device, dispose: () => model.dispose?.() };
}
