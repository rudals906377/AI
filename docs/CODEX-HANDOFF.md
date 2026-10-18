# FINDE 분석 기능 → TypeScript 앱 이식 인계서

이 문서는 FINDE 실험실(이 저장소)의 분석 기능을 FINDE 본 앱(TypeScript)에 넣는 사람 · 에이전트를 위한 인계서다.
전체 구조는 `docs/ARCHITECTURE.md`, 기능 목록은 `README.md`, 모델 목록은 `docs/FINDE-사용한-모델.pdf` 에 있다. 이 문서는 **옮길 때 필요한 것만** 모았다.

- 저장소: `github.com/rudals906377/AI` (`main`)
- 실제 동작: https://kyoungminoh-beauty-style-ai.static.hf.space (`?mode=face|style|nail|history`)
- 원본은 빌드 없는 브라우저용 ES 모듈(JavaScript)이다. 서버가 없고 사진은 기기 밖으로 나가지 않는다.

---

## 1. 무엇을 옮기나

| 기능 | 입력 | 출력 |
|---|---|---|
| 내 얼굴 분석 | 정면 셀카 1장 + 추천 기준(여성 · 남성 · 선택 안 함) + 목적(헤어 · 메이크업) | 얼굴형 · 100명 중 몇 번째 · 상안부 중안부 하안부 · "FINDE 가 알아챈 것" 3가지 · 헤어/메이크업 추천 · 결과지 |
| 스타일 사진 분석 | 헤어 · 네일 · 메이크업 · 타투 사진 1장 | 카테고리 · 장르 · 속성 · 한국어 설명 · 트렌드 · 시술 요청서 · 타투 상담 카드 · 내 얼굴형과의 궁합 |
| 내 손톱 분석 | 손등 사진 1장 + 답(손 쓰는 정도 · 길이 · 방법 · C커브) | 손톱형 · 추천 쉐입 3 · 피할 모양 · 길이/디자인 팁 · 네일샵 상담 카드 |
| 내 기록 | 위 결과 | 기기 안 저장(사진 원본은 저장하지 않음, 480px 썸네일만) |

공개 범위: **고객이 재미로 쓰는 기능**. 디자이너 모드 · 검수 도구(`designer.html`, `review.html`, `fit-review.html`)는 옮기지 않는다.

---

## 2. 모듈 지도 — 세 층으로 나눠 옮긴다

### A층. 판단 · 문장 로직 (화면 · 엔진 무관) → **TypeScript 로 그대로 옮긴다**
DOM 을 쓰지 않는다. 웹 · React Native 어디서든 같은 코드를 쓴다. 가장 먼저 옮기고, 원본과 결과가 같은지 테스트한다(5장).

| 파일 | 역할 |
|---|---|
| `taxonomy.js` | 406개 라벨 사전 (헤어 122 · 네일 99 · 메이크업 102 · 타투 83) |
| `describe.js` | 한국어 문장 · 해시태그 조립, `josa()` 조사 처리 |
| `trends.js` · `motifs.js` · `motif.js` | 트렌드 이름 210개, 타투 모티브 156개 판단 |
| `quips.js` · `expert-quips.js` | 에디터 한마디 · 재미 문구 |
| `suits.js` | 스타일별 "이런 분께 어울려요" |
| `order.js` | 시술 요청서 `buildOrder(result, colors)` |
| `tattoo-advice.js` (`tattooCard`) | 타투 상담 카드 (시간 · 회차 · 부위 통증 · 준비 · 관리) |
| `face-advice.js` | `faceReport(face, style, {gender})`, `styleFit`, `rankStyles`, `coupleChem`, `compareFrames` |
| `salon-spec.js` · `color-season.js` · `accessory-advice.js` | 시술 지시서 · 퍼스널 컬러 · 안경/귀걸이 |
| `nail-advice.js` (`nailReport`) | 손톱 쉐입 추천 |
| `face.js` 의 `classifyShape` · `zscores` · `regender` · `NORM*` | 얼굴형 분류와 기준값(실제 얼굴 311장) |
| `nail.js` 의 `nailType` · `NAIL_NORM` | 손톱형 판정과 기준값(손톱 851개) |
| `analyzer.js` 의 판단 부분 | 임베딩 → 헤드 확률 → 속성 · 장르 · 문장 (엔진 호출 부분만 B층으로 분리) |

`*Image` / `reportPdf` / `share-card.js` / `result-image.js` 는 캔버스로 PNG · PDF 를 그린다. 웹이면 그대로, React Native 면 앱 화면 캡처나 서버 없는 다른 방식으로 바꾼다.

### B층. 추론 엔진 (플랫폼마다 다르다) → **어댑터로 감싼다**

| 하는 일 | 원본(웹) | 모델 · 크기 |
|---|---|---|
| 스타일 임베딩 | Transformers.js 4.3.0 (ONNX Runtime Web) | 기기마다 모델 하나: PC `Xenova/siglip-large-patch16-384` (WebGPU q4 약 208MB · CPU q8 약 329MB), 휴대폰 `Marqo/marqo-fashionSigLIP` q8 약 94MB (Hugging Face Hub). 두 모델 섞기 없음 |
| 학습된 분류 헤드 | 순수 계산 | `heads/*.json` (35 헤드 + 부위 헤드 9) · `embeddings/*.json` (라벨 임베딩 · kNN) |
| 얼굴 랜드마크 · 부위 분할 | MediaPipe Tasks Vision 1.0.1 | `models/mediapipe/face_landmarker.task` 3.8MB, `selfie_multiclass_256x256.tflite` 16MB, `hair_segmenter.tflite` 0.8MB |
| 손 랜드마크 | MediaPipe | `hand_landmarker.task` 7.8MB |
| 손톱 분할 | onnxruntime-web 1.22.0 | `models/nail/nail_seg.onnx` 5.5MB (MobileNetV3-small + U-Net, 자체 학습) |
| 여러 사람 · 동물 감지 | MediaPipe | `efficientdet_lite0.tflite` 4.6MB |

어댑터 인터페이스(제안):

```ts
interface Engines {
  embedImage(img: ImageInput, opts?: { flip?: boolean; regions?: Region[] }): Promise<Float32Array>; // SigLIP 비전 임베딩
  faceLandmarks(img: ImageInput): Promise<FaceLandmarkResult | null>;   // 478점 + 블렌드셰이프 + 변환 행렬
  segmentSelfie(img: ImageInput): Promise<SegMask>;                      // 머리카락 · 얼굴 피부 · 목 · 손
  handLandmarks(img: ImageInput): Promise<HandLandmarkResult | null>;
  nailMask(crop: Float32Array /* 1x3xHxW */): Promise<Float32Array>;     // nail_seg.onnx
  detectObjects?(img: ImageInput): Promise<Detection[]>;                 // 선택
}
```

### C층. 화면 (`app.js`, `face-ui.js`, `nail-ui.js`, `history.js`, `index.html`, `style.css`) → **앱 컴포넌트로 새로 만든다**
원본 화면 코드는 DOM 을 직접 만진다. 동작 · 문구 · 순서만 참고하고 코드는 옮기지 않는다.

---

## 3. 주요 결과 형식 (앱에서 쓸 타입의 출발점)

```ts
// 스타일 사진 분석: analyzer.analyze(image, { category: 'auto' })
interface StyleResult {
  category: 'hair' | 'nail' | 'makeup' | 'tattoo'; category_label: string;
  category_ranking: { key: string; score: number }[];
  is_beauty: boolean; subject: { ko: string; type: string } | null;   // 사람이 아니면 (예: 강아지)
  headline: string;                    // 한 줄 판정
  genre: { name: string; group?: string; score?: number; level: 'high' | 'low'; second?: string; sub?: string; info?: string } | null;
  attributes: { group: string; group_label: string; label: string; score: number; level: 'high' | 'mid' | 'low'; all?: unknown[] }[];
  description_ko: string; paragraphs: string[][]; tags: string[]; trends: { name: string }[];
  secondary: Partial<StyleResult> | null; warnings: string[]; confidence: unknown;
  embedding: Float32Array;             // 저장 · 전송하지 말 것 (개인정보 아님이지만 JSON 출력 제외)
}

// 내 얼굴 분석: analyzeFace(image, { purpose }) → face, faceReport(face, styleResult | null, { gender })
interface FaceReport {
  shape: { key: string; p: number }; near?: { key: string; p: number };
  headline: string; summary: string[]; quip: string;
  measures: { key: string; label: string; value: string; avg: string; note: string; z: number; pct: string | null }[];
  noticed: { key: string; title: string; soft: boolean; value: string | null; avg: string | null; pct: string; mirror: string | null; so: string }[];
  thirds: { line: string; note: string } | null;
  hair: AdviceSection[]; makeup: AdviceSection[];  // 남성 기준이면 makeup 자리에 그루밍
  match: { score: number | null; level: 'great' | 'good' | 'ok' | 'meh' | 'none'; title: string; verdict: string; reasons: { pts: number; text: string }[]; tip?: string } | null;   // 헤어 · 메이크업 사진일 때만
  zones: unknown[]; traits: Record<string, number | string>;
}

// 내 손톱: analyzeNails(image) → r (r.ok, r.type, r.fingers, r.issues), nailReport(r.type, answers)
interface NailReport { top: Shape[]; avoid: Shape[]; list: Shape[]; lengthTip: string[]; design: { k: string; t: string }[]; card: string[] }

// 타투 상담 카드: tattooCard(styleResult) / 시술 요청서: buildOrder(styleResult, colors)
interface TattooCard { genre: string | null; motifs: string[]; subject: string | null; plan: { time: string; sessions: string; size: string; cm: string; why: string }; place: { name: string; sure: boolean; pain: number; painText: string } | null; text: string }
interface Order { title: string; to: string; genre: string; rows: { label: string; value: string; extra?: string; alt?: string; swatch?: { hex: string } }[]; checks: string[]; notes: string[]; text: string }
```

정확한 필드는 원본 코드의 반환문을 기준으로 한다: `analyzer.js`(분석 결과), `face-advice.js` `faceReport`, `nail-advice.js` `nailReport`, `tattoo-advice.js` `tattooCard`, `order.js` `buildOrder`.

---

## 4. 통합 방식 — 앱 종류에 따라 고른다

| 앱 | 권장 | 메모 |
|---|---|---|
| 웹 (React · Next.js · Vite) | A층 TS 이식 + B층은 원본 그대로(npm: `@huggingface/transformers@4.3.0`, `@mediapipe/tasks-vision@1.0.1`, `onnxruntime-web@1.22.0`) + C층 새로 | 멀티스레드 WASM 을 쓰려면 응답 헤더 `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` 필요 (원본은 HF Space README 의 `custom_headers`) |
| React Native / Expo | **1단계: WebView** 로 실험실 페이지를 띄우고 결과 JSON 을 `postMessage` 로 받는다 → **2단계: 네이티브 엔진**(onnxruntime-react-native, MediaPipe 네이티브)으로 B층 교체, A층 TS 는 그대로 | WKWebView 메모리 한계는 Safari 와 같다(6장). 임베드 모드(머리글 · 탭 숨김 + 결과 전달)는 실험실 쪽에 아직 없다 → 필요하면 이 저장소에 추가 |
| 서버 분석 | 권장하지 않음 | "사진은 기기 밖으로 보내지 않는다"는 약속이 깨진다. 하려면 사용자 동의 · 고지가 먼저 |

---

## 5. 완료 기준 — 원본과 결과가 같아야 한다

1. **A층 동일성 테스트**: 같은 입력이면 원본 JS 와 TS 의 출력이 같아야 한다.
   - 순수 함수(`faceReport`, `nailReport`, `tattooCard`, `buildOrder`, `classifyShape` 등)는 원본에 입력을 넣어 나온 JSON 을 골든 파일로 저장하고 비교.
   - 스타일 분석은 `samples/*.jpg` 예시 사진으로 장르 · 상위 속성 · 카테고리가 같아야 한다 (확률은 소수 둘째 자리까지 허용 오차).
2. **엔진 동일성**: 같은 사진의 임베딩 코사인 유사도 0.99 이상, 얼굴 측정값(`f.m`) 오차 1% 이내.
3. **실기기**: iPhone(Safari/WebView) · 안드로이드에서 얼굴 → 스타일 → 손톱 순서로 연달아 분석해도 화면이 리셋되지 않을 것.
4. **문구 규칙**(7장) 위반 0건.

참고 지표(원본): 스타일 카테고리 정확도 93.8%, 기본 모델 속성 정확도 80.2%(시험 사진 812장).

---

## 6. 모바일에서 이미 겪고 고친 것 — 같은 실수를 반복하지 말 것

- **iOS 는 WebGPU 대신 CPU(WASM)**: iOS Safari 의 WebGPU 로 분석 직후 웹 프로세스가 죽는 일이 있었다(`app.js` `runtimeFor`).
- **iOS · 휴대폰은 WASM 스레드 1개**: cross-origin isolated 환경에서 WebKit 이 다중 스레드 추론 중 죽었다(`setWasmThreads`).
- **iOS 는 가벼운 일반 WASM 빌드**(약 14MB). 라이브러리 기본 asyncify 빌드(약 27MB) 대신 쓴다. 엔진이 `no available backend found` 로 못 뜨면 설정을 바꿔 다시 연다(`ORT_STEPS`, `recoverBackend`).
- **메모리**: 스타일 모델은 실행 메모리가 600MB 안팎이다. 휴대폰은 ① 필요할 때만 받기 ② ONNX 메모리 아레나 끄기(`enableCpuMemArena:false`) ③ 사진을 768~1024px 로 줄여 디코딩(`decodeScaled`) ④ "사진 속 색" 같은 추가 모델은 버튼을 눌렀을 때만.
- **크래시 감지 · 안전 모드**: 작업 앞뒤로 표시를 남겨, 끝나기 전에 화면이 새로 열렸으면 다음엔 더 가벼운 설정으로(`device.js` `guardStart/guardEnd`, `SAFE_LEVEL`). 정상 새로고침(pagehide)은 크래시로 치지 않는다.
- **MediaPipe 는 OffscreenCanvas 대신 보통 캔버스에 WebGL**(`glCanvas`) — 일부 WebKit 에서 `GLctx` 오류.
- **큰 사진(48MP)**: 헤더에서 크기를 읽고 줄여서 디코딩.

---

## 7. 꼭 지킬 제품 규칙

- 사진은 기기 밖으로 보내지 않는다. 기록에도 원본 사진은 저장하지 않는다.
- 손톱은 **미용 참고 정보**다. 질환 · 건강 판단 표현 금지("의학적 진단이 아니에요" 한 줄 유지).
- 얼굴 결과는 정답이 아니라 제안이다. 외모 평가 · 비하 표현 금지, 유머는 칭찬 쪽으로만.
- 성별을 사진으로 추정하지 않는다. 추천 기준은 사용자가 고른다.
- 앱에 싣는 예시 사진 · 학습 사진은 상업 이용 가능 라이선스만(CC BY · CC0 등, ND · NC 금지). 출처는 `samples/CREDITS.md`.
- 결과 아래 AI 생성 고지(`notice.html` 문구) 유지.
- 디자이너 모드 · 검수 도구는 아직 공개하지 않는다.

---

## 8. 작업 순서 제안

1. 앱의 플랫폼(웹 / React Native / 기타)과 폴더 구조를 확인하고, 4장에서 방식을 정한다.
2. A층을 `packages/finde-core`(이름 자유) TypeScript 패키지로 옮기고 3장 타입을 정리한다. 원본 JS 로 골든 JSON 을 만들어 동일성 테스트를 붙인다.
3. B층 어댑터를 만든다 (웹이면 원본 엔진 코드를 TS 로, RN 이면 1단계 WebView 브리지).
4. C층 화면을 앱 디자인 시스템으로 만든다. 문구는 원본 화면을 기준으로 한다.
5. 6장 항목을 실기기에서 확인한다.

모르는 동작은 실사이트에서 직접 해 보고, 원본 코드의 해당 함수를 읽는 것이 가장 빠르다.
