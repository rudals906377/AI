// 사진 속 주인공이 사람인지, 동물 · 인형인지 알아보는 문장 임베딩을 미리 계산해 embeddings/<모델>.json 의 guard 에 넣는다.
// 사람이 아니어도 분석은 그대로 하고, 결과 위에 "어머나, 사람이 아니라 강아지네요…?" 한마디를 붙이는 데 쓴다.
// 속성 사전 해시와 무관하므로 학습 헤드는 그대로 쓸 수 있다.   node tools/build-guard.mjs [모델...]
import fs from 'node:fs';
import { loadTextEncoder } from '../encoders.js';

export const GUARD = {
  person: [
    'a photo of a person', "a close-up photo of a person's face", "a photo of a person's hairstyle", "a photo of a woman's or a man's hair",
    'a close-up photo of a human hand with manicured nails', 'a photo of human feet with painted toenails', 'a photo of a tattoo on human skin',
    'a portrait photo of a person wearing makeup',
  ],
  kinds: [
    ['강아지', ['a photo of a dog', 'a photo of a puppy']],
    ['고양이', ['a photo of a cat', 'a photo of a kitten']],
    ['새', ['a photo of a bird', 'a photo of a parrot']],
    ['말', ['a photo of a horse', 'a photo of a pony']],
    ['토끼', ['a photo of a rabbit']],
    ['햄스터', ['a photo of a hamster or a guinea pig']],
    ['물고기', ['a photo of a fish in water']],
    ['파충류', ['a photo of a lizard, a snake or a turtle']],
    ['동물', ['a photo of a wild animal', 'a photo of a farm animal like a cow, a pig or a sheep', 'a photo of a monkey']],
    ['곰인형', ['a photo of a teddy bear', 'a photo of a stuffed animal plush toy']],
    ['인형', ['a photo of a doll', 'a photo of a ball-jointed doll', 'a photo of a fashion doll toy']],
    ['피규어', ['a photo of an action figure or a figurine', 'a photo of an anime figure toy']],
    ['마네킹', ['a photo of a mannequin', 'a photo of a mannequin head wearing a wig']],
    // 이름 없이(한마디 없이) 넘기는 사진: 풍경 · 음식 · 물건 · 그림
    ['', ['a photo of a landscape, a street or a building', 'a photo of food or a drink', 'a photo of a car, furniture or an everyday object', 'a product photo of a cosmetic bottle or a package', 'a cartoon, a drawing or a painting']],
  ],
};
const DOLLS = new Set(['곰인형', '인형', '피규어', '마네킹']);
const MARGIN = { 'Marqo/marqo-fashionSigLIP': { animal: 0.035, doll: 0.07 }, 'Xenova/siglip-large-patch16-384': { animal: 0.025, doll: 0.06 } };
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['Marqo/marqo-fashionSigLIP', 'Xenova/siglip-large-patch16-384'];
const dir = new URL('../embeddings/', import.meta.url).pathname;
const vec = (v) => Array.from(v, (x) => +x.toFixed(5));
for (const model of MODELS) {
  const text = await loadTextEncoder(model, { dtype: 'fp32' });
  const guard = { person: (await text.embed(GUARD.person)).map(vec), kinds: [] };
  for (const [ko, prompts] of GUARD.kinds) guard.kinds.push({ ko, type: !ko ? '' : DOLLS.has(ko) ? 'doll' : 'animal', vecs: (await text.embed(prompts)).map(vec) });
  await text.dispose?.();
  // 기준값: (가장 가까운 종류의 유사도 − 사람 문장 유사도)가 이만큼 넘으면 한마디. 동물 사진 80장 · 인형 사진 20장 · 뷰티 사진 약 2,500장으로 정함
  // 인형류는 인형 같은 차림의 사람을 인형이라 부르지 않도록 뷰티 사진의 최대값보다 높게 잡는다
  guard.margin = MARGIN[model];
  const file = `${dir}/${model.split('/').pop()}.json`;
  const j = JSON.parse(fs.readFileSync(file));
  j.guard = guard;
  fs.writeFileSync(file, JSON.stringify(j));
  console.log(model, guard.kinds.length, 'kinds →', file);
}
