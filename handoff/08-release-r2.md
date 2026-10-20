[학습 측 → 앱 담당] 08 · 상업용 묶음 finde-commercial-c0-20261020-r2 (2026-10-20)

■ 파일
사용자가 채팅 첨부로 받아 Mac 에 저장합니다. 절대 경로는 사용자가 따로 알려 드립니다. r1 은 덮어쓰지 않았습니다.
- 묶음: finde-commercial-c0-20261020-r2.tar.gz
  - bytes: 75,119,168
  - SHA-256: 3e3620256e37278d2fddae9667ae1cc99565a1e16ed8abaadc1fb44977cb5987
- 묶음 밖 sidecar: finde-commercial-c0-20261020-r2.tar.gz.sidecar.json

묶음 안:
- manifest.json (finde-training-handoff v1)
- SHA256SUMS.txt 70줄
- payload 69개

학습 측에서 확인한 것:
- 압축을 풀고 70줄 전부 OK
- manifest bytes·sha256 전부 일치
- 필수 role 8종 빠짐 없음
- ONNX (2,3,224,224) → (2,768) 실행

■ 구성
- encoder-original-q8: 표준 ONNX
  - sha256 38eaae015f895be925c1aea708739ed06dfaf92a75c88527cf6fd2da7e683862, 94,008,252 bytes
  - opset 14, fusedAttention false, dynamic QUInt8 (perChannel false · reduceRange false), MatMul·Conv, customOps []
  - 입출력은 r1 과 같습니다. 출력은 정규화하지 않으니 호출하는 쪽에서 L2 정규화해야 합니다.
- embeddingSpace: finde-fashionSigLIP-commercial-c0-q8-38eaae015f89
- labels: 원본 그대로 (d4244c61…, text encoder 미변경)
- style-heads (B, 기본)
  - 기본 그룹 head 44개 (nail.part 포함)
  - calib · conf · kNN (상업용 사진만)
  - 부위 heads: 메이크업 base·eye·eyeLine·lash·brow·lip·lipTexture·cheek·detail·tone, 헤어 color
- style-heads-alternative (A): nail.part 무헤드
- tattoo-motifs: 새 공간 head·kNN·params
  - params 는 못 본 작가 검증으로 골랐습니다: lam·alpha·mix·beta (값은 파일의 params)
- groupPolicies["nail.part"]
  - B: head-mixture (α 1.0, kNN null, calib 0.5484, conf 0.75)
  - A: zero-shot (head null, kNN null, calib 2.2974, conf 0.75)
  - 둘 다 평가에서 100.0 입니다.
- rights/: 상업용 필터 요약, 제외 목록 (사유별), BY·BY-SA 저작자 표시 목록, Openverse 재조회 100장, 기반 모델 카드 사본과 HF API 응답, 필터 스크립트
- reports/: evaluation, regressions (12건 재검사 + 라벨별 n·정답률·혼동), tattoo-cause-and-selection, lineage, split-provenance, data-rights
- scripts/ · logs/: 학습 스크립트와 시범·본 학습·heads 로그 전부

■ 결과 (학습 측 근사 경로, 앱 방식 그룹 정답률 %)
| 세트 | 실제 앱 기준선 | r1 (상업 불가) | 상업용 c0 (이 묶음) | 대조: 원본 encoder + 상업용 heads |
|---|---|---|---|---|
| v3 | 85.0 | 87.2 | 84.4 | 81.6 |
| new3 | 85.2 | 88.7 | 84.5 | 81.5 |
| v1 | 84.9 | 86.0 | 84.4 | 81.8 |

v3 분야별 (기준선 → c0 → 대조)
- 헤어: 84.3 → 86.6 → 82.3
- 네일: 90.0 → 88.3 → 85.5
- 메이크업: 81.1 → 79.3 → 77.0
- 타투: 81.9 → 80.0 → 78.7

타투 세부 모티브 test52 (top1 / top3)
- 기준선 73.1 / 86.5
- r1 65.4 / 86.5
- c0 71.2 / 84.6 (top1 −1장, top3 −1장)
- 대조 71.2 / 82.7

■ 해석
1. 상업 불가 자료를 빼면 (학습 69%) 같은 원본 encoder 로도 2.9~3.4 점 떨어집니다 (대조).
2. 새 encoder 는 그중 2.6~3.0 점을 되찾습니다. 같은 상업용 자료에서는 모든 분야·세트에서 대조보다 높습니다.
3. 그래도 실제 앱 기준선보다는 전체가 0.5~0.7 낮습니다.
   - 세트×그룹 82개 중 35개가 기준선보다 낮습니다. 대부분 1~3장 차이입니다. 큰 것들:
     - makeup.detail v3 −4장, new3 −4장
     - nail.layout v3 −4장
     - nail.finish −3장
     - tattoo.size −3장
   - r1 회귀 12건 중 해결된 것은 v3 눈썹 1건뿐입니다. 나머지 11건은 여전히 기준선보다 낮습니다.
4. 타투 회귀 원인 분리 결과:
   - r1 의 모티브 하락 (희소 모티브 −7) 은 encoder 공간 이동 때문이었습니다. c0 에서는 해결했습니다: 못 본 작가 기준 원본 73.2 → c0 71.7 (−1.5), 대조와 test52 가 같습니다.
   - 남은 타투 차이는 자료 감소에서 옵니다.
5. 선정 과정:
   - epoch 은 결과를 보기 전에 정한 규칙으로 골랐습니다 (epoch 0).
   - c0 와 대조를 비교할 때 평가 세트 점수를 봤습니다. 다만 대조가 모든 분야에서 낮아 선택에는 영향이 없습니다.

■ 상태
- 정확도: 이 묶음은 실제 앱 기준선보다 낫지 않습니다. 정확도만 보면 기존 앱 모델을 교체할 근거가 없습니다.
  - 상업 권리를 우선해 교체할지는 사용자 결정 사항입니다.
- 권리: commercialStatus = evidence-incomplete. 상업 사용 승인 완료가 아닙니다.
  미확인:
  - 인물 초상권
  - BY-SA 가 가중치에 적용되는 범위
  - Marqo·WebLI 상위 자료
  - MediaPipe 모델 카드 조건
  - 수집 이후 라이선스 변경 (100장 표본만 재조회)
- 정확도를 기준선 이상으로 올릴 방법 (추가 승인 필요할 수 있음):
  1. Commons API 제한이 풀리면 작가 정보를 다시 조회합니다. 작가 없음으로 뺀 1,228행 일부를 되살릴 수 있습니다.
  2. 상업용 사진을 추가로 수집·라벨링합니다.
  3. epoch 4 대안 (그룹 +6, 모티브 규칙 0.9 미달) 은 평가 세트를 보지 않은 채 대안으로만 남겼습니다.
- 지키는 범위: commit/push, 게시, 배포, 키 생성, 앱 소스 수정은 하지 않았습니다. 고객 자료도 쓰지 않았습니다.
