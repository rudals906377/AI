"""라벨이 없는 그룹에 지금 헤드가 확신한 답을 약한 라벨(기준점)로 붙인다 → finetune-heads.py 에 함께 넣는다

왜
- 라벨 하나를 겨냥해 모은 사진(예: 코덱스 수집 2,456장, 사진마다 라벨 1개)은 그 그룹에 드문 라벨만 있어,
  그대로 이어 학습하면 드문 라벨 쪽으로 기울어 평범한 사진을 틀린다 (R16: 평가 세트 85.2 → 78.7%).
- 같은 사진의 다른 그룹(라벨 없음)에 지금 헤드가 확신한(기본 90%) 답을 기준점으로 넣으면 흔한 라벨 예도 함께 생겨
  기울어짐이 줄어든다 (85.2 → 82.6%). 앱과 같은 식(헤드 · 제로샷 혼합 + kNN)으로 확률을 잰다.

사용
  python3 tools/pseudo-anchors.py --heads heads/siglip-large-patch16-384.json --labels embeddings/siglip-large-patch16-384.json \\
      --tax /tmp/taxonomy.json --feedback train.jsonl --out pseudo.jsonl [--min-prob 0.9]
  python3 tools/finetune-heads.py ... --feedback train.jsonl pseudo.jsonl --pseudo-weight 1
"""
import argparse, base64, importlib.util, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ft", os.path.join(HERE, "finetune-heads.py"))
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)


def app_probs(heads, idx, key, X):
    """앱과 같은 최종 확률: 헤드 · 제로샷 혼합 뒤 kNN 투표를 β 만큼"""
    c, gk = key.split(".")
    h = heads["groups"][key]; kn = heads.get("knn")
    W = ft.f32(h["W"], h["rows"], heads["dim"]); b = np.array(h["b"]); zb = np.array(h.get("zb") or [0.0] * h["rows"])
    _, _, p = ft.final_probs(W, b, h.get("alpha", 1.0), X, idx[c]["groups"][gk], zb)
    kg = (kn or {}).get("groups", {}).get(key)
    if kg and kg["beta"] > 0:
        Q = np.frombuffer(base64.b64decode(kn["q"]), dtype=np.int8).reshape(-1, kn["dim"]).astype(np.float32) / kn["scale"]
        v = ft.knn_vote({"Q": Q[kg["rows"]], "labels": kg["labels"], "k": kg["k"], "tau": kg["tau"]}, X, p.shape[1])
        p = np.where(v.sum(1, keepdims=True) > 0, (1 - kg["beta"]) * p + kg["beta"] * v, p)
    return p


def load_rows(paths, model):
    rows = []
    for fp in paths:
        for line in open(fp, encoding="utf-8"):
            if not line.strip(): continue
            r = json.loads(line)
            if r.get("model") == model: rows.append(r)
    return rows


def embs(rows):
    X = np.stack([np.frombuffer(base64.b64decode(r["emb"]), dtype=np.float32) for r in rows])
    return X / np.linalg.norm(X, axis=1, keepdims=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--heads", required=True); ap.add_argument("--labels", required=True); ap.add_argument("--tax", required=True)
    ap.add_argument("--feedback", nargs="+", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--min-prob", type=float, default=0.9)
    a = ap.parse_args()
    heads = json.load(open(a.heads)); tax = json.load(open(a.tax)); _, idx = ft.th.load_index(a.labels, tax)
    rows = load_rows(a.feedback, heads["model"]); n = 0
    with open(a.out, "w", encoding="utf-8") as f:
        for c in tax["categories"]:
            R = [r for r in rows if r["category"] == c]
            if not R: continue
            X = embs(R); add = [dict() for _ in R]
            for g in tax["groups"][c]:
                key = f"{c}.{g['key']}"
                if key not in heads["groups"]: continue
                p = app_probs(heads, idx, key, X)
                for i, r in enumerate(R):
                    if g["key"] in (r.get("labels") or {}): continue
                    j = int(p[i].argmax())
                    if p[i, j] >= a.min_prob: add[i][g["key"]] = [g["labels"][j]]
            for r, lab in zip(R, add):
                if lab:
                    f.write(json.dumps({**r, "labels": lab, "source": "pseudo"}, ensure_ascii=False) + "\n"); n += len(lab)
    print(f"기준점 라벨 {n}개 → {a.out}")


if __name__ == "__main__":
    main()
