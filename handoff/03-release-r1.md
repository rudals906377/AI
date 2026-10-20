[학습 측 → 앱 담당] 03 · 인계 묶음 finde-ft-run2ep5-20261020-r1 (2026-10-20)

■ 받는 방법
사용자가 채팅 첨부로 받은 파일을 Mac 에 저장합니다. 저장한 절대 경로는 사용자가 따로 알려 드립니다.
- 묶음: finde-ft-run2ep5-20261020-r1.tar.gz
- 묶음 밖 sidecar: finde-ft-run2ep5-20261020-r1.tar.gz.sidecar.json
- tar.gz bytes: 76,551,353
- tar.gz SHA-256: 448dd4f9a4b60ebee411ffe78ecf268df2d86e9cbba0b7cd51622b42d89f8cec

■ 묶음 안 구성
- 최상위 폴더: finde-ft-run2ep5-20261020-r1/
- manifest.json: format "finde-training-handoff", version 1
- SHA256SUMS.txt: 39줄 (manifest.json + payload 38개, 자기 자신 제외)
- manifest.files: payload 38개 (manifest · SHA256SUMS 제외). 각 항목에 path · role · bytes · sha256, 해당 파일은 encoderSha256 · embeddingSpace 도 적었습니다.

■ 학습 측 검증 결과
- 압축을 풀고 SHA256SUMS 39줄 전부 OK
- manifest 의 bytes · sha256 전부 일치
- 필수 role 8종 빠짐 없음
- ONNX 를 불러 (2,3,224,224) → (2,768) float32 실행 확인

■ 주요 payload (전체 해시는 manifest 에 있습니다)
| path | role |
|---|---|
| encoder/vision_model_quantized.onnx | encoder-original-q8 |
| style-heads/marqo-fashionSigLIP.json | style-heads (B, 기본) |
| style-heads/marqo-fashionSigLIP.nailpart-zeroshot-knn.json | style-heads-alternative (A) |
| labels/marqo-fashionSigLIP.json | label-embeddings |
| motifs/motifs-marqo-fashionSigLIP.json | tattoo-motifs |
| reports/evaluation.json · evaluation.md | evaluation |
| reports/regressions.json | regressions |
| reports/split-provenance.json | split-provenance |
| reports/data-rights.json | data-rights |
| reports/lineage.json · encoder/export.json | lineage · export-info |
| split/* | 고정 split 목록 9개 |
| scripts/* | 학습·평가 스크립트 사본 13개 |
| logs/* | 학습 로그 4개 |

- encoder-original-q8 은 표준 ONNX 입니다 (compat 변환 전).
  sha256 9582057293456f487a9a5553e03eff408a8c35768e36a77bd0e83290ac53bd66, 94,008,252 bytes
- labels 는 원본 그대로입니다 (d4244c61…, text encoder 미변경).
- style-heads 안에 calib · conf · kNN · 부위 헤드 (메이크업 eye/eyeLine/lash/brow/lip, 헤어 perm/colorTech) 가 들어 있습니다.

■ manifest 에서 확인해 주실 값
- embeddingSpace: finde-fashionSigLIP-ft-run2-ep5-q8-958205729345
- source.trainingCommit: null
  사유: 학습 스크립트를 commit 하지 않았습니다 (commit/push 미승인). 사본을 scripts/ 에 넣었습니다.
- source.dirty: false
- preprocessing.postRgba8Exact: null (미확인)
  학습 측 전처리는 Python 재구현이고, style-pixels.js 골든과 비교하지 않았습니다.
- preprocessing.decode: Pillow 12.3.0, exif_transpose → RGB → 긴 변 896 초과 시 BOX 축소
- export:
  - torch 2.14.1+cpu, onnx 1.23.2, onnxslim 0.1.98, ORT 1.31.0
  - opset 14, fusedAttention false, customOps []
  - 양자화: dynamic QUInt8, perChannel false, reduceRange false, MatMul · Conv
  - fp32 는 묶음에 없고 해시만 적었습니다.
- groupPolicies["nail.part"]: 기본 B (head-mixture), 대안 A (zero-shot-knn). 02 와 같은 값입니다.
- baseline: f1009cfc… / 1a350bb4… / d4244c61… / motifs 84ac82ac…, retrained false
- provenance.commercialStatus: not-cleared
  학습과 kNN 뱅크에 NC/ND 695장, 권리 미확인 user-provided 113~133장이 들어 있습니다. 상업 출시 전 재학습이 필요합니다.

■ 앱 방식 결과 (학습 측 근사 경로, %)
| 세트 | 실제 앱 기준선 | 후보 |
|---|---|---|
| v3 (1,349) | 85.0 | 87.2 |
| new3 (620) | 85.2 | 88.7 |
| v1 (729) | 84.9 | 86.0 |

■ 회귀 12건 (reports/regressions.json)
- v3:
  - 눈썹 (12장) 91.7 → 66.7
  - nail.finish (23) 91.3 → 87.0
  - tattoo.placement (71) 87.3 → 83.1
  - tattoo.style (55) 83.6 → 78.2
- new3:
  - hair.styling (86) 93.0 → 90.7
  - nail.finish (22) 90.9 → 86.4
  - nail.length (20) 95.0 → 90.0
- v1:
  - 눈썹 (11) 100.0 → 72.7
  - makeup.eye (27) 77.8 → 74.1
  - tattoo.placement (38) 92.1 → 81.6
  - tattoo.style (38) 81.6 → 73.7
  - tattoo.subject (34) 88.2 → 82.4
- 속눈썹: v3 · v1 모두 57.1 → 57.1 (변화 없음)
- 타투 세부 모티브 (52장): top1 73.1 → 65.4 (−4장), top3 86.5 → 86.5
- 표본이 작은 그룹이 많습니다. 사진 수 차이(photosDelta)를 함께 적었습니다.

■ 지키는 범위
- 인코더 추가 학습, 서명 키 생성, commit/push, 게시·배포는 하지 않았습니다.
- 고객 사진·픽셀·사진 임베딩·개인정보는 보내지 않습니다.
- kNN 뱅크에 들어 있는 학습 사진 8비트 임베딩은 기존 배포 heads 와 같은 방식입니다.
- 파일이 바뀌면 새 releaseId 로 다시 드립니다.
