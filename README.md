---
title: 뷰티 스타일 AI 설명기
emoji: 💇
colorFrom: red
colorTo: yellow
sdk: static
app_file: index.html
pinned: false
license: mit
custom_headers:
  cross-origin-embedder-policy: require-corp
  cross-origin-opener-policy: same-origin
  cross-origin-resource-policy: cross-origin
---

# 뷰티 스타일 AI 설명기

헤어스타일 · 네일아트 · 메이크업 · 타투 사진을 올리면 **브라우저 안에서** AI가 스타일을 자세한 한국어 문장과 태그로 설명합니다.
서버가 없고 사진이 외부로 전송되지 않습니다. 모델은 Transformers.js 로 브라우저에서 직접 실행됩니다.

> **무엇을 넣으면 무엇이 나오나** — 뷰티 사진을 넣으면, 스타일을 항목별로 짚은 상세 한국어 설명 · 속성별 신뢰도 · 해시태그 · JSON 이 나온다.
> 예) 네일 사진 → "롱 길이의 아몬드 셰이프 네일… 베이스 컬러는 누드·베이지… 디자인 기법은 프렌치…"

## 동작 구조

```
사진 ─▶ ① 카테고리 판별 ─▶ ② 속성 그룹별 제로샷 분류 ─▶ ③ 한국어 문장 조립 + 태그 + JSON
          (CLIP)              (CLIP, 이미지 임베딩 1회)        (조사 처리 · 신뢰도별 어미)
      └▶ [고급 모드] 소형 VLM 이 사진을 직접 보고 전문가처럼 영어로 서술 → 용어집 + 한국어 번역
```

| 단계 | 모델 (모두 Transformers.js 태그) | 다운로드 |
|---|---|---|
| 기본 · 정밀 (기본값) | `Xenova/clip-vit-large-patch14` | 약 194MB (WebGPU, q4) / 307MB (CPU, q8) |
| 기본 · 빠름 | `Xenova/clip-vit-base-patch16` | 약 88MB (q8) |
| 고급 모드 | `onnx-community/LFM2.5-VL-450M-ONNX` | 약 420MB (WebGPU) ~ 640MB (CPU) |

- **라벨 임베딩 사전 계산**: 속성 사전의 라벨 157개 문장 임베딩을 fp32 텍스트 모델로 미리 계산해 `embeddings/` 에 넣었습니다. 브라우저는 비전 모델만 받으면 됩니다.
- **프롬프트 앙상블**: 라벨마다 문장 틀 2개를 평균해 정확도를 높였습니다.
- **신뢰도 규칙**: 60% 이상이면 단정합니다. 40~60%면 "~로 보입니다"라고 쓰고, 2위가 가까우면 함께 적습니다. 40% 미만이면 "추정됩니다"라고 쓰고 다른 후보를 제시합니다. 설명문 속 불확실성 언급은 최대 2번이며, 나머지는 막대그래프로 보여 줍니다.
- **고급 모드**: 이 소형 VLM은 한국어로 직접 쓰면 옷·배경 이야기로 새는 경향이 있습니다. 그래서 영어로 먼저 자세히 관찰하게 한 뒤 문장 단위로 번역합니다. 영어 원문도 함께 보여 줍니다.

## 측정 결과 (예시 사진 33장, Node · CPU)

| 모델 · 정밀도 | 카테고리 정확도 | fp32 대비 속성 일치율 | 브라우저 CPU 분석 시간 |
|---|---|---|---|
| ViT-L/14 · q4 | 30/33 | 88% | 약 5초 |
| ViT-L/14 · q8 | 30/33 | 83% | 약 2.5초 |
| ViT-B/16 · q8 | 31/33 | 77% | 약 1.5초 |

틀린 경우는 헤어 사진인데 얼굴이 크게 나온 사진이 메이크업으로 분류된 경우입니다. 화면의 카테고리 버튼으로 직접 고를 수 있습니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` · `style.css` · `app.js` | UI (업로드 · 붙여넣기 · 예시 사진 · 결과 카드 · JSON) |
| `analyzer.js` | 핵심 분석 모듈 (UI 의존 없음, Node 에서도 동작) |
| `taxonomy.js` | 카테고리별 속성 사전 (헤어 6 · 네일 5 · 메이크업 6 · 타투 5 그룹) |
| `describe.js` | 한국어 문장 조립 (받침에 따른 조사 · 신뢰도별 어미 · 조합 코멘트) |
| `advanced.js` | 고급 모드 (VLM 서술 + 용어집 번역) |
| `embeddings/` | 사전 계산된 라벨 임베딩 |
| `tools/build-embeddings.mjs` | `taxonomy.js` 수정 후 임베딩 재생성 |
| `samples/` | 예시 사진 (Wikimedia Commons 자유 라이선스, 출처는 `samples/CREDITS.md`) |
| `REPORT.md` | 제출용 보고서 1장 초안 |

## URL 옵션

| 옵션 | 뜻 |
|---|---|
| `?model=base` | 빠름 모델로 시작 (느린 PC · 느린 인터넷용) |
| `?device=wasm` | WebGPU 대신 CPU 강제 |
| `?dtype=q8` | 비전 모델 정밀도 강제 |

## 로컬 실행

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## 속성 사전을 고쳤다면

```bash
npm i @huggingface/transformers
node tools/build-embeddings.mjs
```

재생성하지 않아도 동작합니다. 이 경우 브라우저가 텍스트 모델을 추가로 받아 직접 계산하므로 로딩이 느려집니다.

## Hugging Face Space 배포

1. Hugging Face 에서 **New Space** 를 누르고 SDK 로 **Static** 을 고릅니다.
2. 이 저장소의 파일을 그대로 올립니다. `README.md` 맨 위의 설정 블록이 Space 설정입니다.

```bash
git remote add space https://huggingface.co/spaces/<계정>/<스페이스이름>
git push space claude/inspiring-faraday-1o6w9q:main
```
