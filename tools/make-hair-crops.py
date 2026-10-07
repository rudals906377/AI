"""헤어 사진 → 머리카락 · 앞머리(이마) · 머리 전체 크롭 (MediaPipe 머리카락 분할 + 얼굴 랜드마크). 부위 헤드 학습용.
웹 앱(colors.js 의 hairRegions)과 같은 규칙을 써야 한다.

사용: python3 tools/make-hair-crops.py <manifest.json> <out-dir>
  manifest.json : [{ "i": 번호, "file": 사진 경로, ... }, ...]
  출력          : <out-dir>/{hair,bangs,head}/<번호 4자리>.jpg, <out-dir>/crops.json (상자 좌표)
규칙
  hair  : 머리카락 마스크 상자 + 상자 크기의 6% 여유 (머리카락이 사진의 0.5% 미만이면 없음)
  bangs : 얼굴 상자 가로 ±20%, 세로는 얼굴 위 55% 위쪽부터 미간(168번 점)까지 — 앞머리 · 이마 · 헤어라인
  head  : 얼굴 상자와 머리카락 상자를 합친 뒤 10% 여유
"""
import json, os, sys
import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision as mpv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
MIN_HAIR = 0.005


def union(a, b):
    if a is None: return b
    if b is None: return a
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def main():
    manifest, out = sys.argv[1], sys.argv[2]
    man = json.load(open(manifest))
    fl = mpv.FaceLandmarker.create_from_options(mpv.FaceLandmarkerOptions(
        base_options=mpp.BaseOptions(model_asset_path=f"{ROOT}/models/mediapipe/face_landmarker.task"), num_faces=3))
    seg = mpv.ImageSegmenter.create_from_options(mpv.ImageSegmenterOptions(
        base_options=mpp.BaseOptions(model_asset_path=f"{ROOT}/models/mediapipe/hair_segmenter.tflite"), output_category_mask=True))
    for d in ("hair", "bangs", "head"): os.makedirs(f"{out}/{d}", exist_ok=True)
    info = {}
    for m in man:
        if not os.path.exists(m["file"]): continue
        im = Image.open(m["file"]).convert("RGB"); w, h = im.size
        a = np.ascontiguousarray(np.array(im))
        mask = np.squeeze(seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=a)).category_mask.numpy_view())
        boxes = {}
        hair_box = None
        ys, xs = np.where(mask == 1)
        if len(xs) >= MIN_HAIR * w * h:
            x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            bw, bh = x1 - x0, y1 - y0
            hair_box = [max(0, x0 - bw * 0.06), max(0, y0 - bh * 0.06), min(w, x1 + bw * 0.06), min(h, y1 + bh * 0.06)]
        res = fl.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=a))
        face_box = None
        if res.face_landmarks:
            lms = max(res.face_landmarks, key=lambda lm: np.ptp([p.x for p in lm]) * np.ptp([p.y for p in lm]))
            P = np.array([[p.x * w, p.y * h] for p in lms])
            q = P[OVAL]; fx0, fy0 = q.min(0); fx1, fy1 = q.max(0); fw, fh = fx1 - fx0, fy1 - fy0
            face_box = [fx0, fy0, fx1, fy1]
            boxes["bangs"] = [max(0, fx0 - fw * 0.2), max(0, fy0 - fh * 0.55), min(w, fx1 + fw * 0.2), min(h, P[168][1])]
        if hair_box: boxes["hair"] = hair_box
        u = union(face_box, hair_box)
        if u:
            uw, uh = u[2] - u[0], u[3] - u[1]
            boxes["head"] = [max(0, u[0] - uw * 0.1), max(0, u[1] - uh * 0.1), min(w, u[2] + uw * 0.1), min(h, u[3] + uh * 0.1)]
        keep = {}
        for name, box in boxes.items():
            if box[2] - box[0] < 40 or box[3] - box[1] < 24: continue
            keep[name] = [round(v) for v in box]
            im.crop(keep[name]).save(f"{out}/{name}/{m['i']:04d}.jpg", quality=92)
        info[m["i"]] = keep or None
    json.dump(info, open(f"{out}/crops.json", "w"))
    n = lambda k: sum(1 for v in info.values() if v and k in v)
    print(f"{len(info)} images, hair crops: {n('hair')}, bangs crops: {n('bangs')}, head crops: {n('head')}")


if __name__ == "__main__":
    main()
