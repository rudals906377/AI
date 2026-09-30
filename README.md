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

헤어스타일 · 네일아트 · 메이크업 · 타투 사진을 올리면 **브라우저 안에서** AI가 스타일을 한국어로 설명합니다.
서버가 없고 사진이 외부로 전송되지 않습니다. 모델은 Transformers.js 로 브라우저에서 직접 실행됩니다.

## 무엇이 나오나

| 출력 | 예시 (네일 사진) |
|---|---|
| 장르 카드 | **프렌치 네일** · 밀키화이트 · 스퀘어 · 미디엄 |
| 트렌드 키워드 | `오피스네일` `쇠맛 네일` `자석네일` 처럼 인스타그램 · 네이버에서 실제로 검색하는 말 |
| 설명 문장 | "적당한 미디엄 길이에 스퀘어 쉐입, 밀키화이트 컬러를 올린 프렌치 네일로 보입니다. 마감은 보송한 매트 마감이에요." |
| 속성별 근거 | 그룹마다 상위 후보와 확률 막대 |
| 해시태그 · JSON | `#프렌치네일 #오피스네일 …`, 앱 연동용 JSON |

- **분류명은 한국식**입니다. 헤어는 허쉬컷 · 태슬컷 · 히메컷 · 빌드펌 · 애쉬브라운, 네일은 자석 · 글레이즈드 · 시럽 · 치크, 메이크업은 물광 · 음영 · 과즙 · 말린장미 같은 이름을 씁니다.
- **트렌드 키워드는 속성 조합으로 만듭니다.** 예) 브라운 염색 + 쿨톤 → "차가운 애쉬브라운", 크롬 · 실버 · 메탈릭 → "쇠맛 네일", 태슬컷 + 생머리 → "칼단발".
- **타투는 트렌드 없이 장르 중심**입니다. 레터링 · 파인라인 · 블랙앤그레이 · 이레즈미 등 15개 장르와 장르 설명, 부위 · 크기 · 도안을 알려 줍니다.
- 뷰티 사진이 아니면 "뷰티 사진이 아닐 수 있어요" 경고를 띄웁니다.

## 동작 구조

```
사진 ─▶ 비전 인코더로 임베딩 1회 ─┬▶ 뷰티 사진 판별 (학습 헤드)
                                  ├▶ 카테고리 판별 (학습 헤드 + 제로샷)
                                  └▶ 속성 그룹 27개 분류 (학습 헤드 + 제로샷 혼합)
                                          ▼
                    장르 · 트렌드 키워드 · 한국어 문장 · 해시태그 · JSON
      └▶ [고급 모드] 소형 VLM 이 사진을 보고 영어로 서술 → 뷰티 용어집 + 한국어 번역
```

| 모드 | 모델 | 다운로드 | 라이선스 |
|---|---|---|---|
| 기본 (기본값) | `Marqo/marqo-fashionSigLIP` | 약 94MB (q8) | Apache-2.0 |
| 정밀 | `Xenova/siglip-large-patch16-384` | 약 208MB (WebGPU q4) · 329MB (CPU q8) | Apache-2.0 |
| 고급 모드 | `onnx-community/LFM2.5-VL-450M-ONNX` | 약 420~630MB | LFM Open License v1.0 |

- **라벨 임베딩 사전 계산**: 속성 라벨 215개의 문장 임베딩을 미리 계산해 `embeddings/` 에 넣었습니다. 브라우저는 비전 모델만 받습니다.
- **학습 헤드**: 라벨 문장 임베딩에서 출발해 손으로 확인한 사진으로 보정한 경량 분류기입니다 (`heads/`, 약 0.8MB). 그룹마다 제로샷과 섞는 비율을 교차 검증으로 정합니다.
- **신뢰도 규칙**: 60% 이상이면 단정합니다. 40~60%면 "~로 보입니다", 40% 미만이면 "추정됩니다"라고 쓰고 다른 후보를 함께 적습니다. 문장 속 불확실성 언급은 최대 2번입니다.
- **고급 모드**: 이 소형 VLM은 한국어로 직접 쓰면 옷 · 배경 이야기로 새는 경향이 있습니다. 그래서 영어로 먼저 관찰하게 한 뒤 문장 단위로 번역하고, 영어 원문도 함께 보여 줍니다.

## 정확도

### 모델 비교 (평가 세트: 사진 210장 · 속성 정답 218개, 제로샷)

| 모델 | 카테고리 | 속성 |
|---|---|---|
| CLIP ViT-L/14 (q8) | 90.5% | 61.0% |
| CLIP ViT-B/16 | 89.5% | 59.2% |
| SigLIP-base (q8) | 94.3% | 70.6% |
| SigLIP2-base | 84.8% | 51.4% |
| SigLIP-large/384 (q8) | 91.9% | 75.7% |
| **FashionSigLIP (q8)** | **92.9%** | **73.9%** |

FashionSigLIP 은 SigLIP-large 와 비슷한 정확도를 1/3 크기로 냅니다. 그래서 기본 모델로 골랐습니다.

### 학습 헤드 효과 (FashionSigLIP)

| 측정 | 제로샷 | 학습 헤드 |
|---|---|---|
| 평가 세트 속성 정확도 (218개) | 73.9% | **79.4%** |
| 뷰티 사진 판별 (평가 세트 + 일반 사진 97장) | 77.5% | **95.8%** |
| 손라벨 전체 5겹 교차 검증 (속성 1,535개) | 65.5% | **76.7%** |

그룹별로 크게 오른 곳은 메이크업 무드 63.6% → 90.9%, 메이크업 눈 37.5% → 68.8%, 네일 길이 42.9% → 71.4%, 헤어 컬러 63.2% → 73.7% 입니다.

**배운 점**: 검색어나 분류명으로 자동으로 붙인 라벨 1만 장은 효과가 없었습니다 (출처 단위 교차 검증 73.9% → 73.4%). 손으로 확인한 라벨은 280장만으로 +5.9%p 가 올랐고, 564장으로 늘리자 교차 검증에서 +2.2%p 가 더 올랐습니다.

## 학습 데이터와 라이선스

- **출처**: Wikimedia Commons 와 Openverse(Flickr 등)에서 상업적 이용이 허용된 자유 라이선스 사진만 모았습니다. 핀터레스트 같은 SNS 는 이용약관이 자동 수집을 금지하고 사진마다 저작권자가 따로 있어 쓰지 않았습니다.
- **배포되는 헤드의 학습 사진**: CC0 · 퍼블릭 도메인 · CC BY · CC BY-SA 만 씁니다. 개작 금지(ND) · 비영리(NC) 사진은 `train-heads.py --commercial` 로 뺍니다.
- **평가 세트**: 비영리 라이선스 사진이 섞여 있어 측정에만 쓰고 학습에는 쓰지 않습니다.
- **출처 기록**: `data/labels_clean.jsonl` 에 손라벨 564장의 정답 · 원본 페이지 · 작성자 · 라이선스를 모두 남겼습니다. 사진 파일 자체는 저장소에 넣지 않습니다.
- **라벨 규칙**: 정답 후보가 여러 개면 모두 적습니다 (예: 아몬드 또는 오벌). 헤어 사진에 염색 기법 · 묶음 표시가 없으면 전체 염색 · 풀어내린 머리로 봅니다.

## 상업적 이용 시 확인할 것

| 항목 | 상태 |
|---|---|
| 기본 · 정밀 모델 | Apache-2.0. 상업 이용 가능 |
| 고급 모드 모델 (LFM2.5-VL) | LFM Open License v1.0. 연 매출 1천만 달러 미만 기업만 무료로 상업 이용 가능. 그 이상이면 Liquid AI 와 별도 계약 필요 |
| 학습 사진 | 상업 이용 · 개작 허용 라이선스만 사용. CC BY · BY-SA 는 출처 표시 의무가 있어 `data/labels_clean.jsonl` 로 남김 |
| 예시 사진 | Wikimedia Commons 자유 라이선스. `samples/CREDITS.md` |

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` · `style.css` · `app.js` | UI (업로드 · 붙여넣기 · 예시 사진 · 장르 카드 · 트렌드 칩 · JSON) |
| `analyzer.js` · `encoders.js` | 핵심 분석 모듈 (UI 의존 없음, Node 에서도 동작) |
| `taxonomy.js` | 속성 사전 (헤어 9 · 네일 6 · 메이크업 7 · 타투 5 그룹, 라벨 215개) |
| `describe.js` | 한국어 문장 조립 (장르 · 트렌드 키워드 · 받침에 따른 조사 · 신뢰도별 어미) |
| `advanced.js` | 고급 모드 (VLM 서술 + 용어집 번역) |
| `embeddings/` · `heads/` | 사전 계산된 라벨 임베딩 · 학습 헤드 |
| `data/labels_clean.jsonl` | 손라벨과 출처 · 라이선스 |
| `tools/` | 임베딩 생성 · 사진 임베딩 · 데이터 정리 · 헤드 학습 스크립트 |
| `samples/` | 예시 사진과 출처 |

## URL 옵션

| 옵션 | 뜻 |
|---|---|
| `?model=large` | 정밀 모델로 시작 |
| `?device=wasm` | WebGPU 대신 CPU 강제 |
| `?dtype=q8` | 비전 모델 정밀도 강제 |

## 로컬 실행

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## 속성 사전을 고치거나 다시 학습하려면

```bash
npm i @huggingface/transformers
node tools/build-embeddings.mjs                      # taxonomy.js 수정 후 라벨 임베딩 재생성
node tools/embed-images.mjs list.json out Marqo/marqo-fashionSigLIP q8   # 사진 임베딩
python3 tools/train-heads.py --commercial --tax taxonomy.json --labels embeddings/marqo-fashionSigLIP.json \
    --train out.f32 --train-meta out.json --train-list train_list.json \
    --eval eval.f32 --eval-meta eval.json --eval-list eval_list.json --out heads/marqo-fashionSigLIP.json
```

속성 사전을 바꾸면 해시가 달라져 기존 헤드는 자동으로 꺼지고 제로샷으로 동작합니다. 다시 학습하면 켜집니다.

## Hugging Face Space 배포

1. Hugging Face 에서 **New Space** 를 누르고 SDK 로 **Static** 을 고릅니다.
2. 이 저장소의 파일을 그대로 올립니다. `README.md` 맨 위의 설정 블록이 Space 설정입니다.

```bash
git remote add space https://huggingface.co/spaces/<계정>/<스페이스이름>
git push space claude/inspiring-faraday-1o6w9q:main
```
