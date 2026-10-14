# FINDE 실험실 — 전체 구성 (모델 · 데이터 · 화면 · 운영)

2026-10-14 기준. 자세한 성능 수치와 학습 과정은 [MODEL_CARD.md](MODEL_CARD.md), 기능별 설명은 [README](../README.md) 참고.

## 1. 한 줄 요약

브라우저 안에서만 도는 뷰티 AI 실험실. 서버 없이 정적 파일(HTML · JS)로 배포되고, 사진은 기기 밖으로 나가지 않는다.
주력 4분야: **헤어 · 네일아트 · 메이크업 · 타투**. 기능은 ① 스타일 사진 분석 ② 내 얼굴 분석 ③ 내 손톱 분석 ④ 내 기록.

## 2. 사용한 모델

| 용도 | 모델 | 형식 · 크기 | 실행 | 비고 |
|---|---|---|---|---|
| 스타일 사진 임베딩 (기본) | `Marqo/marqo-fashionSigLIP` (ViT-B/16) | ONNX q8 · 약 94MB | Transformers.js 4.3.0 + ONNX Runtime Web (WebGPU 또는 WASM) | 비전 인코더만 내려받음. 라벨 문장 임베딩은 미리 계산해 둠(`embeddings/`) |
| 스타일 사진 임베딩 (정밀, 선택) | `Xenova/siglip-large-patch16-384` | WebGPU q4 208MB · CPU q8 329MB | 같은 방식 | 기본 모델과 함께 돌려 확률 평균. PC 전용 |
| 속성 분류 헤드 | 직접 학습한 선형 헤드 35개 + 부위 헤드 9개 | JSON (`heads/*.json`, 약 8MB) | JS 행렬곱 | 그룹마다 하나. 임베딩 → 라벨 확률 |
| 타투 세부 모티브 | 직접 학습한 헤드 (156개 모티브) | `embeddings/motifs-*.json` | JS | 도안 라벨 아래 세부 모티브 |
| 비슷한 학습 사진 | 학습 사진 임베딩 kNN (15장 투표) | JSON | JS | 헤드 확률과 섞어 보정 |
| 얼굴 랜드마크 478점 · 표정 | MediaPipe `face_landmarker.task` | 3.8MB | MediaPipe Tasks Vision 1.0.1 (WASM, CPU delegate) | 얼굴형 · 비율 측정, 메이크업 부위 자르기 |
| 얼굴 · 머리카락 · 몸 분할 | MediaPipe `selfie_multiclass_256x256.tflite` | 16MB | 같은 방식 | 헤어라인 · 귀 · 피부 톤 · 헤어 컬러 입히기 |
| 머리카락 분할 (색 뽑기) | MediaPipe `hair_segmenter.tflite` | 0.8MB | 같은 방식 | 사진 속 머리 색 |
| 손 랜드마크 21점 | MediaPipe `hand_landmarker.task` | 7.8MB | 같은 방식 | 손가락별 끝마디 자르기 |
| 손톱 분할 | 직접 학습한 `models/nail/nail_seg.onnx` (MobileNetV3-small 인코더 + 작은 U-Net) | 5.5MB | onnxruntime-web 1.22 (WASM) | 손가락 크롭에서 손톱 윤곽 |
| 여러 사람 · 반려동물 감지 | MediaPipe `efficientdet_lite0.tflite` | 4.6MB | 같은 방식 | 사람 수 세기, 동물 사진 안내 |

모델은 처음 한 번 내려받아 브라우저 캐시(Cache API)에 두고 다시 쓴다. 외부 서버로 보내는 것은 없다.

## 3. 분류 사전 · 규칙 데이터

| 자료 | 수 | 설명 |
|---|---|---|
| 속성 라벨 (`taxonomy.js`) | 406 (헤어 122 · 네일 99 · 메이크업 102 · 타투 83) | 그룹별 라벨 + 영어 묘사(제로샷용) + 한국어 뜻풀이 |
| 타투 세부 모티브 (`motifs.js`) | 156 | 도안 라벨 아래 세부 모티브 |
| 트렌드 이름 (`trends.js`) | 210 | 웹 조사로 모은 한국 트렌드 키워드 + 이유 |
| 학습 사진 | 2,197 + 추가 372 | 자유 라이선스(Openverse · Wikimedia Commons) 2,099 + 사용자 제공 98 + 7 · 9 · 10차 추가. 출처 · 라이선스 기록 |
| 평가 세트 | 812 속성 · 210 카테고리 | 학습에 안 쓴 사진. 기본 80.2% · 정밀 82.4% (속성), 카테고리 93.8% |
| 얼굴 기준값 (`face-advice.js` NORM) | 실제 얼굴 311장 | 얼굴형 · 삼정 · 눈 · 코 · 입 비율의 평균 · 표준편차 (여성 · 남성 기준 따로) → "100명 중 몇 번째" |
| 손톱 기준값 (`nail.js`) | 맨손톱 851개 | 너비 ÷ 길이 · 끝 퍼짐 · 큐티클 깊이 중앙값 |
| 커트 · 앞머리 효과표 (`face-advice.js` CUT_FX · BANG_FX) | 커트 37 · 앞머리 다수 | 얼굴 측정값에서 필요한 효과(가로선 · 세로선 · 광대 감싸기 …) → 커트별 점수 |
| 미용실 시술 지시서 (`salon-spec.js`) | 커트 37 | 기장 cm · 레이어 · 가르마 · 펌 · 홈케어 + 얼굴 조정 |
| 헤어 컬러 (`hair-color.js`) | 15 | 머리카락 영역에 입혀 보기 |
| 퍼스널 컬러 (`color-season.js`) | 4계절 × 세부 톤 8 | 피부 · 머리카락 Lab 색으로 판정 + 가상 드레이프 |
| 안경 · 귀걸이 (`accessory-advice.js`) | 얼굴형 · 측정값 규칙 | |
| 손톱 쉐입 (`nail-advice.js`) | 7 | 라운드 · 오벌 · 라운드스퀘어 · 스퀘어 · 아몬드 · 코핀 · 스틸레토, 입혀 보기 색 8 |
| 타투 상담 표 (`tattoo-advice.js`) | 장르 27 · 부위 21 · 컬러 7 · 크기 8 | 예상 시간 · 회차, 통증 참고, 알아 둘 것, 니들 메모 |
| 전문가 한마디 (`expert-quips.js`) | 180 (헤어 60 · 메이크업 60 · 그루밍 60) | 칭찬 쪽으로만, 디자이너 모드에선 숨김 |
| 예시 사진 (`samples/`) | 106 + 커트 예시 43 | 권리 확인된 사진만. 출처는 `samples/CREDITS.md` |

## 4. 분석 흐름

### 4-1. 스타일 사진 분석 (`app.js` · `analyzer.js` · `colors.js`)
1. 사진을 긴 변 1024px(휴대폰 896)로 줄여 디코딩 (`device.js` `decodeScaled`, 아이폰 48MP 도 통째로 풀지 않음)
2. (PC) 여러 사람 · 동물 감지 → 안내
3. 카테고리 판별(헤어 · 네일 · 메이크업 · 타투) → 그 카테고리의 그룹이 쓰는 부위만 MediaPipe 로 잘라 임베딩 (메이크업: 얼굴 · 눈 · 입술, 헤어: 머리카락 · 앞머리 · 머리 전체)
4. 그룹마다: 학습 헤드 확률 + 비슷한 학습 사진 투표 → 보정 → 그룹별 단정 기준으로 확신 등급(high · mid · low) · 계열(family) 결정
5. 설명 문장(`describe.js`) · 트렌드(`trends.js`) · 에디터 한마디(`quips.js`) · 어울리는 분(`suits.js`) · 시술 요청서(`order.js`) · 타투 상담 카드(`tattoo-advice.js`) · 눈여겨본 디테일 · 가장 헷갈린 것
6. (PC 자동 · 휴대폰 버튼) 사진 속 실제 색: 머리카락 · 입술 · 눈 · 손톱 영역의 대표색 → 요청서 색 견본
7. 내 기록 저장, 결과 이미지 · 공유 이미지 · 요청서 이미지

### 4-2. 내 얼굴 분석 (`face.js` · `face-advice.js` · `face-ui.js`)
1. 셀카(또는 웹캠 5장 중앙값) → 랜드마크 478점 + 분할 마스크 → 이마 · 광대 · 턱 · 턱끝 너비, 얼굴 길이, 삼정, 턱 각도, 눈 · 코 · 입 비율, 귀 노출, 피부 톤(Lab)
2. 얼굴형 6종 확률(계란 · 둥근 · 각진 · 긴 · 하트 · 마름모), 측정값 z 점수 → 백분위 → **FINDE 가 알아챈 것 3가지**(거울 확인 힌트 + 그래서)
3. 헤어: 필요한 효과 12가지(짧아 보이기 · 길어 보이기 · 이마 덮기 · 광대 감싸기 · 턱 부드럽게 …) 점수 → 커트 · 앞머리 · 기장 · 가르마 추천, 피할 스타일, 근거 그림, 시술 지시서, 예시 사진
4. 메이크업 · 그루밍: 쉐딩 · 하이라이터 · 블러셔 위치(사진 위에 그림), 눈썹 · 아이라인 · 입술 · 색 고르기, 핵심 포인트
5. 퍼스널 컬러 · 안경 · 귀걸이, 헤어 컬러 입혀 보기, 스타일 사진과의 궁합, 베스트 스타일 갤러리, 결과지 PDF · 이미지, 기억해 둔 얼굴형(측정값만 저장)

### 4-3. 내 손톱 분석 (`nail.js` · `nail-advice.js` · `nail-ui.js`)
손 랜드마크 → 손가락별 끝마디 회전 크롭 → 손톱 분할 → 너비 ÷ 길이 · 끝 퍼짐 · 큐티클 라인 · 하얀 끝 · 손가락 길이 → 손톱형 + 쉐입 7종 점수(손 쓰는 정도 · 원하는 길이 · 자연 손톱 · C커브 답변 반영) → 피할 모양 · 길이 · 디자인 팁 · 상담 카드, 쉐입 입혀 보기, 카드 이미지

### 4-4. 내 기록 (`history.js`)
결과마다 제목 · 요약 · 글 · 160px 썸네일 · 480px 사진 · 요청서 · 상담 카드 데이터를 localStorage 에 최근 60개 저장(원본 사진 없음). 분야 필터, 복사, 이미지 · 요청서 · 상담 카드 다시 저장, JSON 내보내기. 공간이 모자라면 오래된 기록의 사진부터 비움.

## 5. 화면 · 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` · `style.css` | 한 페이지 앱. 탭: 내 얼굴 분석(기본) · 스타일 사진 분석 · 내 손톱 분석 · 내 기록 |
| `app.js` | 스타일 분석 화면 · 모델 로드 · 시술 요청서 · 타투 카드 · 안전 모드 · 진행 막대 |
| `face-ui.js` · `nail-ui.js` · `history.js` | 각 탭 화면 |
| `analyzer.js` · `encoders.js` · `assets.js` | 임베딩 · 헤드 · kNN · 보정, 모델 로더, 자산 캐시(3회 재시도) |
| `describe.js` · `suits.js` · `order.js` · `quips.js` · `expert-quips.js` · `trends.js` | 문장 · 추천 · 요청서 · 한마디 · 트렌드 |
| `share-card.js` · `result-image.js` · `report-pdf.js` | 공유 이미지(1080×1920) · 결과 이미지 · A4 결과지(PDF · PNG). 버튼을 눌렀을 때만 import |
| `device.js` | 기기 판정(LOW_MEM · IOS · WEBGL_OK), 안전 모드 가드, 줄여서 디코딩, roundRect 폴리필, fetch 재시도, MediaPipe 캔버스 |
| `designer.html` · `review.html` · `fit-review.html` | 디자이너 모드 입구 · 전문가 검수 · 블라인드 판정 (공개 전, 주소로만) |
| `notice.html` | AI 이용 안내 |
| `tools/` | 학습 · 빌드 · 배포 스크립트: `prepare-dataset.py` → `embed-images.mjs` → `train-heads.py` · `train-region-heads.py` · `train-motifs.py` · `train-knn.py` → `build-embeddings.mjs` · `build-motifs.mjs` · `make-similar.mjs`, `deploy-space.py`(HF Space 로 올리는 파일 목록) |

## 6. 기기 · 환경 대응

| 상황 | 동작 |
|---|---|
| PC + WebGPU | 스타일 모델 WebGPU(q8), 얼굴 모델 미리 받아 둠, 예시 사진 미리 분석 |
| PC, WebGPU 없음 | WASM + 작업 스레드(proxy) + 스레드 최대 4개 |
| iPhone · iPad(WebKit) | WASM 고정 · 스레드 1개 (iOS 18 WebGPU · 다중 스레드에서 프로세스 종료 사례) |
| 휴대폰(LOW_MEM) | 스타일 모델은 사진을 올릴 때 받음, ONNX 메모리 아레나 끔, 사진 896px(얼굴 1024 · 손톱 1280), 미리 분석 안 함, 색 뽑기는 버튼으로 |
| 분석 · 사진 고르기 중 화면이 새로 열림 | 안전 모드 1(CPU · 메모리 절약) → 2(사진 768px) 자동 전환 + 안내 띠 + "원래 설정으로". 3분 안 기록이 있으면 "내 기록에 저장돼 있어요" 띠 |
| WebGL 없음 | 얼굴 · 손톱 탭에 미리 안내, 스타일 분석은 동작 |
| 너무 오래된 브라우저 | 열자마자 업데이트 안내 |
| 사이트가 cross-origin isolated | SharedArrayBuffer 사용 가능 → 스레드 수 정책 적용 |

측정(iPhone 에뮬레이션, 렌더러 메모리): 얼굴 + 손톱만 약 650MB, 스타일 분석 약 900MB. 검증 엔진: Chromium · WebKit(실사이트 전 기능 통과) · Firefox(WebGL 없는 환경에서 스타일 · 기록 통과).

## 7. 저장 · 개인정보

- 사진은 브라우저 밖으로 보내지 않는다. 서버 · 계정 · 분석 로그 없음.
- localStorage 키: `finde-history-v1`(내 기록), `beauty-face-memo-v1`(기억한 얼굴형 · 측정값만), `beauty-fit-feedback-v1`(궁합 평가), `finde-designer`, `finde-mode`, `finde-run-ms`, `finde-run-guard` · `finde-safe`(안전 모드).
- 학습 · 배포 데이터는 상업 이용 가능한 자유 라이선스 사진만. 사용자 제공 사진은 배포본에 넣지 않는다.

## 8. 배포 · 검증

- GitHub `main` 머지 → Hugging Face Space(정적) 자동 배포 → https://kyoungminoh-beauty-style-ai.static.hf.space
- 라이브러리는 CDN(jsdelivr): Transformers.js 4.3.0, MediaPipe Tasks Vision 1.0.1, onnxruntime-web 1.22.0, Pretendard 폰트.
- Playwright 스모크(얼굴 → 이미지 저장 → 스타일 → 결과 이미지 → 손톱 → 기록)를 세 엔진 · iPhone 에뮬레이션 · 실사이트에서 실행. 배포마다 실사이트 확인.

## 9. 공개 범위 · 다음 단계

- 지금 공개 범위: 고객이 재미로 쓰는 서비스. 디자이너 모드 · 검수 도구는 주소로만 열림.
- 다음: 아이폰 실기기 확인 → 앱 + 계정(기록 이어 가기, 시술 뒤 "해 봤어요" 평가로 학습 루프) → 디자이너 공개(판정 키트로 일치율 산출).
