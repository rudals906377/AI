# 파이썬 소스 (노트북)

웹 앱(Transformers.js)의 핵심 과정을 파이썬으로 옮긴 제출용 소스입니다. 웹 앱과 같은 라벨 사전 · 라벨 문장 임베딩 · 학습 헤드 · MediaPipe 모델을 씁니다.

| 파일 | 내용 |
|---|---|
| `beauty_style_ai.ipynb` | 노트북 (실행 결과 포함) |
| `beauty_style_ai.py` | 같은 코드의 파이썬 스크립트 (`python beauty_style_ai.py`) |
| `taxonomy.json` | 라벨 사전 406개 (`node tools/export-notebook-taxonomy.mjs > notebook/taxonomy.json`) |
| `web_reference.json` | 같은 사진을 웹 앱 코드(analyzer.js, 8비트 모델)로 분석한 결과 — 파이썬 결과와 비교용 |

## 실행

- **Colab**: [노트북 열기](https://colab.research.google.com/github/rudals906377/AI/blob/main/notebook/beauty_style_ai.ipynb) → 런타임 → 모두 실행. 필요한 파일은 GitHub 에서 자동으로 내려받습니다.
- **내 PC**: `pip install open_clip_torch mediapipe pandas matplotlib` 후 저장소 안에서 `jupyter notebook notebook/beauty_style_ai.ipynb` 또는 `python notebook/beauty_style_ai.py`.
  처음 한 번 Marqo FashionSigLIP 모델(약 800MB)을 내려받습니다. GPU 없이 CPU 로 됩니다 (사진 1장 약 0.2초).
- 리눅스 서버에서 MediaPipe 가 `libEGL.so.1` 을 찾지 못하면 `apt-get install libegl1 libgles2` 를 먼저 실행합니다 (Colab 은 필요 없음).

## 내용

1. 준비 · 2. 비전 모델 · 3. 라벨 사전과 학습 헤드 · 4. 분석(제로샷 + 학습 헤드 + 확률 보정, 메이크업은 얼굴 · 눈 · 입술 크롭) · 5. 한국어 설명 문장 ·
6. 예시 사진 분석과 웹 앱 결과 비교(속성 1위 일치율 95%) · 7. 분류 헤드 학습 방법 · 8. 내 얼굴 분석(얼굴형 측정 · 가림 점검 · 얼굴형 확률)
