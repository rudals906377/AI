---
title: 뷰티 스타일 AI 설명기
emoji: 💇
colorFrom: red
colorTo: yellow
sdk: static
app_file: index.html
pinned: false
license: mit
---

# 뷰티 스타일 AI 설명기

헤어스타일 · 네일아트 · 메이크업 · 타투 사진을 올리면 **브라우저 안에서** AI가 스타일을 자세한 한국어 문장과 태그로 설명합니다.
서버 없음 · 사진 외부 전송 없음 · Transformers.js 로 모델을 브라우저에서 직접 실행합니다.

> **한 줄 정의** — 뷰티 사진을 넣으면, 어떤 스타일인지 항목별로 짚어 주는 상세 한국어 설명 + 속성 태그(JSON)가 나온다.

## 동작 구조

```
사진 ─▶ [1] 카테고리 판별 ─▶ [2] 속성 그룹별 제로샷 분류 ─▶ [3] 한국어 문장 조립 + 태그
          (CLIP)                (CLIP, 그룹당 1회)              (템플릿 + 신뢰도 규칙)
                                                        └▶ [고급 모드] 소형 VLM 이 사진을 보고 자유 서술
```

| 단계 | 모델 | 비고 |
|---|---|---|
| 기본 분석 | `Xenova/clip-vit-large-patch14` (정밀) 또는 `Xenova/clip-vit-base-patch16` (빠름) | Transformers.js · zero-shot-image-classification |
| 고급 모드 | `onnx-community/LFM2.5-VL-450M-ONNX` | 한국어 지원 VLM · WebGPU 권장 · 약 540MB |

- 모델 로드 시 속성 사전(약 130개 라벨)의 텍스트 임베딩을 **한 번만** 계산해 두고, 사진 1장당 비전 임베딩 **1번**만 수행합니다.
- 신뢰도 규칙: 60% 이상 단정 / 40~60% "~로 보이며, ~일 가능성도" / 40% 미만 "판단이 어려움 + 후보 나열".

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` · `style.css` · `app.js` | UI (업로드 · 예시 사진 · 결과 카드 · JSON) |
| `analyzer.js` | 핵심 분석 모듈 (UI 의존 없음, Node 에서도 동작) |
| `taxonomy.js` | 카테고리별 속성 사전 (라벨 · 영어 프롬프트 · 한국어 표시명) |
| `describe.js` | 한국어 문장 조립 (조사 처리 · 신뢰도별 어미 · 조합 코멘트) |
| `advanced.js` | 고급 모드 (VLM 자유 서술) |
| `samples/` | 예시 사진 (Wikimedia Commons, 출처는 `samples/CREDITS.md`) |
| `PLAN.md` | 개발 계획서 |

## 로컬 실행

정적 파일이므로 아무 정적 서버로 열면 됩니다.

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## Hugging Face Space 배포

Static Space 를 만들고 이 저장소의 파일을 그대로 올리면 됩니다 (`README.md` 의 front matter 가 Space 설정입니다).

```bash
git remote add space https://huggingface.co/spaces/<계정>/<스페이스이름>
git push space main
```
