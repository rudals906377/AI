"""메이크업 사진 → 얼굴 · 눈 · 입술 크롭 (MediaPipe 얼굴 랜드마크). 부위 헤드 학습용.
웹 앱(colors.js 의 REGIONS)과 같은 규칙을 써야 한다.

사용: python3 tools/make-crops.py <manifest.json> <out-dir>
  manifest.json : [{ "i": 번호, "file": 사진 경로, ... }, ...]
  출력          : <out-dir>/{face,eye,lip}/<번호 4자리>.jpg, <out-dir>/crops.json (상자 좌표)
그 다음: node tools/embed-images.mjs <list.json> <out> Marqo/marqo-fashionSigLIP q8 로 영역별 임베딩을 만들고
         tools/train-region-heads.py 로 그룹마다 가장 나은 영역의 헤드를 학습한다.
"""
import json, os, sys
import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision as mpv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYES = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
BROWS = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
# 영역: 점 목록, (좌우 여유, 위 여유, 아래 여유) — 상자 크기 대비 비율. colors.js 의 REGIONS 와 같아야 한다
REGIONS = {"face": (OVAL, 0.12, 0.25, 0.08), "eye": (EYES + BROWS, 0.15, 0.35, 0.55), "lip": (LIPS, 0.35, 0.6, 0.6)}


def main():
    manifest, out = sys.argv[1], sys.argv[2]
    man = json.load(open(manifest))
    fl = mpv.FaceLandmarker.create_from_options(mpv.FaceLandmarkerOptions(
        base_options=mpp.BaseOptions(model_asset_path=f"{ROOT}/models/mediapipe/face_landmarker.task"), num_faces=3))
    for d in REGIONS: os.makedirs(f"{out}/{d}", exist_ok=True)
    info = {}
    for m in man:
        if not os.path.exists(m["file"]): continue
        im = Image.open(m["file"]).convert("RGB"); w, h = im.size
        res = fl.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(np.array(im))))
        if not res.face_landmarks: info[m["i"]] = None; continue
        lms = max(res.face_landmarks, key=lambda lm: np.ptp([p.x for p in lm]) * np.ptp([p.y for p in lm]))
        P = np.array([[p.x * w, p.y * h] for p in lms])
        boxes = {}
        for name, (ids, mx, mt, mb) in REGIONS.items():
            q = P[ids]; x0, y0 = q.min(0); x1, y1 = q.max(0)
            bw, bh = x1 - x0, y1 - y0
            box = [max(0, x0 - bw * mx), max(0, y0 - bh * mt), min(w, x1 + bw * mx), min(h, y1 + bh * mb)]
            if box[2] - box[0] < 40 or box[3] - box[1] < 24: continue
            boxes[name] = [round(v) for v in box]
            im.crop(boxes[name]).save(f"{out}/{name}/{m['i']:04d}.jpg", quality=92)
        info[m["i"]] = boxes
    json.dump(info, open(f"{out}/crops.json", "w"))
    print(f"{len(info)} images, no face: {sum(1 for v in info.values() if v is None)}, "
          f"eye crops: {sum(1 for v in info.values() if v and 'eye' in v)}, lip crops: {sum(1 for v in info.values() if v and 'lip' in v)}")


if __name__ == "__main__":
    main()
