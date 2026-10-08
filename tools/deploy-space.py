"""Hugging Face Static Space 로 배포한다 (브라우저 앱에 필요한 파일만 올린다).

사용
  HF_TOKEN=<쓰기 권한 토큰> python3 tools/deploy-space.py [계정/스페이스이름]
  python3 tools/deploy-space.py --dry-run          # 올릴 파일 목록만 확인

- 스페이스 이름을 주지 않으면 HF_SPACE 환경 변수, 그것도 없으면 '<내 계정>/beauty-style-ai' 를 쓴다
- 스페이스가 없으면 Static Space 로 새로 만든다
- 사진 · 모델 파일도 Hugging Face 가 알아서 대용량 저장소로 올리므로 git-lfs 설정이 필요 없다
"""
import os, sys, glob
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 앱 실행에 필요한 파일 + 예시 사진 출처 + 학습 데이터 출처 기록 (CC BY 출처 표시)
ALLOW = ["README.md", "index.html", "style.css", "app.js", "assets.js", "share-card.js", "asset-manifest.json", "favicon.svg", "apple-touch-icon.png", "og.png", "analyzer.js", "encoders.js", "describe.js", "motif.js", "motifs.js", "trends.js", "quips.js", "taxonomy.js", "advanced.js",
         "order.js", "colors.js", "suits.js", "face.js", "face-advice.js", "face-ui.js", "review.html", "review.js", "fit-review.html", "fit-review.js", "notice.html",
         "embeddings/*.json", "heads/*.json", "samples/*", "samples/thumbs/*", "samples/similar/*.json", "models/mediapipe/*",
         "data/labels_clean.jsonl"]
# docs/legal/ 의 초안(약관 · 개인정보처리방침 등)은 법률 검토 메모가 들어 있어 올리지 않는다. 화면용 안내는 notice.html


def files():
    out = []
    for pat in ALLOW:
        out += sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob(pat) if p.is_file())
    return out


# 브라우저가 큰 파일을 버전별로 저장해 두고 다시 쓰도록(assets.js) 파일 경로 → 내용 해시 목록을 만든다
CACHED = ["heads/*.json", "embeddings/*.json", "models/mediapipe/*"]


def write_manifest():
    import hashlib, json
    out = {}
    for pat in CACHED:
        for p in sorted(ROOT.glob(pat)):
            if p.is_file():
                out[p.relative_to(ROOT).as_posix()] = hashlib.sha1(p.read_bytes()).hexdigest()[:12]
    (ROOT / "asset-manifest.json").write_text(json.dumps(out, indent=0), encoding="utf-8")
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--dry-run" not in sys.argv:
        write_manifest()   # --dry-run 은 목록만 본다 (추적 중인 asset-manifest.json 을 바꾸지 않게)
    listed = files()
    missing = [p for p in ALLOW if "*" not in p and not (ROOT / p).exists()]
    if missing:
        sys.exit(f"필요한 파일이 없습니다: {missing}")
    size = sum((ROOT / f).stat().st_size for f in listed)
    print(f"올릴 파일 {len(listed)}개, {size / 1e6:.1f}MB")
    if "--dry-run" in sys.argv:
        print("\n".join(listed))
        return
    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN 환경 변수가 없습니다. https://huggingface.co/settings/tokens 에서 쓰기(Write) 토큰을 만들어 넣어 주세요.")
    from huggingface_hub import HfApi
    api = HfApi(token=token)
    space = args[0] if args else os.environ.get("HF_SPACE") or f"{api.whoami()['name']}/beauty-style-ai"
    api.create_repo(space, repo_type="space", space_sdk="static", exist_ok=True)
    info = api.upload_folder(folder_path=str(ROOT), repo_id=space, repo_type="space", allow_patterns=listed,
                             commit_message="Deploy beauty style describer")
    print(f"배포 완료: https://huggingface.co/spaces/{space}")
    print(f"커밋: {info.commit_url}")


if __name__ == "__main__":
    main()
