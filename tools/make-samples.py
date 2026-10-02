"""예시 사진 만들기: 저장소의 헤어 · 네일아트 · 메이크업 · 타투 폴더 사진을 전부 예시로 등록한다.

사용
  python3 tools/make-samples.py

- 폴더에 사진을 넣고 다시 실행하면 예시 목록이 새로 만들어진다
- 분석용 사진(samples/<카테고리>-NN.jpg, 긴 변 900px)과 목록용 작은 사진(samples/thumbs/, 긴 변 240px)을 만든다
- 촬영 위치 같은 EXIF 정보는 저장하지 않는다. PNG 도 JPEG 로 바꾼다
- 내용이 똑같은 사진은 한 번만 넣는다
"""
import hashlib, json, unicodedata
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FOLDERS = {"헤어": "hair", "네일아트": "nail", "메이크업": "makeup", "타투": "tattoo"}
ORDER = ["hair", "nail", "makeup", "tattoo"]
EXT = {".jpg", ".jpeg", ".png", ".webp"}
# 탭을 열었을 때 맨 앞에 보일 사진 (원본 파일 이름 앞부분). 장르가 겹치지 않게 고른 것
FEATURED = {
    "hair": ["df19facddf1b13", "73c8b7751f3ef0", "92dad0e58ccc1c", "1dc0d34cc0f70d", "7ac8ac1ee09497", "483fc12c9962a5"],
    "nail": ["45559f357eef4d", "c2f9a2c3ffe371", "fda08cfaefdaa4", "8604438dc8be42", "4ef290c63aa2d0", "d48cfcd548574b"],
    "makeup": ["91e3a175ef17bd", "4152aa9bf34432", "56d2beaa8cb980", "ccedea28d08e21", "45d9fe58bf0733", "ea848fecab2a22"],
    "tattoo": ["2f4ab2b73f6f9c", "d83016241bf44d", "cf29f0f5262973", "d0867d0c3f258b", "8f34adb12a24f9", "ba52bafb6fde1c"],
}


def rank(cat, name):
    for i, p in enumerate(FEATURED.get(cat, [])):
        if unicodedata.normalize("NFC", name).startswith(p):
            return (0, i, name)
    return (1, 0, unicodedata.normalize("NFC", name))


def main():
    out, thumbs = ROOT / "samples", ROOT / "samples" / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    for f in list(out.glob("*.jpg")) + list(thumbs.glob("*.jpg")):
        f.unlink()
    folders = {FOLDERS[unicodedata.normalize("NFC", d.name)]: d for d in ROOT.iterdir()
               if d.is_dir() and unicodedata.normalize("NFC", d.name) in FOLDERS}
    manifest, seen = [], set()
    for cat in ORDER:
        if cat not in folders:
            continue
        files = sorted((p for p in folders[cat].iterdir() if p.suffix.lower() in EXT), key=lambda p: rank(cat, p.name))
        n = 0
        for p in files:
            digest = hashlib.md5(p.read_bytes()).hexdigest()
            if digest in seen:
                print(f"같은 사진이라 건너뜀: {p.name}")
                continue
            seen.add(digest)
            im = ImageOps.exif_transpose(Image.open(p))
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, "white"); bg.paste(im, mask=im.split()[-1]); im = bg
            im = im.convert("RGB")
            n += 1
            name = f"{cat}-{n:02d}.jpg"
            big = im.copy(); big.thumbnail((900, 900), Image.LANCZOS); big.save(out / name, quality=85, optimize=True)
            small = im.copy(); small.thumbnail((240, 240), Image.LANCZOS); small.save(thumbs / name, quality=80, optimize=True)
            manifest.append({"file": f"samples/{name}", "thumb": f"samples/thumbs/{name}", "category": cat,
                             "title": "사용자 제공 사진", "license": "사용자 제공", "source": unicodedata.normalize("NFC", p.name)})
        print(f"{cat}: {n}장")
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(f"예시 사진 {len(manifest)}장 → samples/manifest.json")


if __name__ == "__main__":
    main()
