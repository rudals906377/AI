"""타투 세부 모티브 판단을 학습해 embeddings/motifs-<모델>.json 에 더한다 (motif.js 가 읽는다)

입력
- embeddings/motifs-<모델>.json : tools/build-motifs.mjs 가 만든 모티브 문장 임베딩
- --labels : [{ file, motifs: [모티브 이름...], license, src }] (사람이 단 라벨, 첫 번째가 주 모티브)
- --emb : 사진 임베딩 (embed-images.mjs 결과 접두어, 여러 개 가능)

판단 = 헤드(선형 분류기 α + 문장 유사도(×100) 1−α) 60% + 제로샷(문장 유사도 × 부모 '도안' 확률^w) 40%, 여기에 비슷한 라벨 사진(kNN) 투표를 β 만큼 섞는다.
kNN 뱅크에는 권리가 확인된 사진(user-provided 제외)만 8비트로 넣는다. 평가용 사진(src == 'eval')은 학습 · 뱅크 모두에서 뺀다.

  python3 tools/train-motifs.py --model Marqo/marqo-fashionSigLIP --labels labels.json --emb tr_marqo [--emb more]
"""
import argparse, base64, importlib.util, json, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("th", os.path.join(HERE, "train-heads.py"))
th = importlib.util.module_from_spec(spec); spec.loader.exec_module(th)
PARAMS = dict(scale=50.0, w=0.5, mix=0.6, beta=0.35, k=10, tau=20.0, lam=3.0, alpha=0.5)
free = lambda l: bool(l) and l not in ("?", "user-provided", "eval") and not re.search(r"(^|[-\s])(nd|nc)([-\s]|$)", l.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True); ap.add_argument("--labels", required=True); ap.add_argument("--emb", action="append", required=True)
    a = ap.parse_args()
    short = a.model.split("/")[-1]
    path = os.path.join(HERE, "..", "embeddings", f"motifs-{short}.json")
    mj = json.load(open(path))
    names = mj["names"]; M = np.frombuffer(base64.b64decode(mj["data"]), dtype=np.float32).reshape(-1, mj["dim"])
    d = {}
    for p in a.emb:
        m = json.load(open(p + ".json")); X = np.fromfile(p + ".f32", dtype=np.float32).reshape(-1, m["dim"])[:m["count"]]
        for i, f in enumerate(m["files"]): d[f] = X[i]
    rows = [r for r in json.load(open(a.labels)) if r["src"] != "eval" and r["file"] in d]
    rows = [(r, [names.index(x) for x in r["motifs"] if x in names]) for r in rows]
    rows = [(r, y) for r, y in rows if y]
    X = np.stack([d[r["file"]] for r, _ in rows]); X /= np.linalg.norm(X, axis=1, keepdims=True)
    S = np.zeros((len(rows), len(names)))
    for i, (_, y) in enumerate(rows): S[i, y] = 1
    present = sorted(set(np.where(S.sum(0) > 0)[0]))
    W, b = th.fit(X, S, M, PARAMS["lam"], present, pen=0.0)
    bank = [(i, y) for i, (r, y) in enumerate(rows) if free(r.get("license"))]
    Q = X[[i for i, _ in bank]]
    scale = 127.0 / float(np.abs(Q).max())   # 가장 큰 성분이 127 이 되게 (train-knn.py 와 같은 방식)
    q = np.clip(np.round(Q * scale), -127, 127).astype(np.int8)
    mj["head"] = {"W": base64.b64encode(np.ascontiguousarray(W, dtype=np.float32).tobytes()).decode(), "b": [round(float(x), 5) for x in b]}
    mj["knn"] = {"scale": scale, "q": base64.b64encode(q.tobytes()).decode(), "labels": [y for _, y in bank]}
    mj["params"] = PARAMS
    mj["trained"] = {"rows": len(rows), "bank": len(bank), "motifs_seen": len(present)}
    json.dump(mj, open(path, "w"), separators=(",", ":"))
    print(f"{short}: 학습 {len(rows)}장 · 뱅크 {len(bank)}장 · 사진 있는 모티브 {len(present)}/{len(names)} → {path} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()
