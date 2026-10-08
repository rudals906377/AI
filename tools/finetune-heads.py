"""검수 · 피드백 결과만으로 지금 배포된 헤드를 이어서 학습한다 (원래 학습 사진 · 임베딩 없이)

언제 쓰나
- 디자이너가 review.html 로 검수해 내보낸 JSONL, 앱 사용자가 고친 결과(beauty-feedback-*.jsonl)가 모였을 때.
  원래 학습 데이터(사진 수천 장의 임베딩)가 없는 곳에서도 heads/*.json 만으로 개선할 수 있다.

방식
- 그룹마다 지금 헤드(W0, b0)에서 출발해, 피드백 사진들의 '최종 확률'(헤드 · 제로샷 혼합, 앱과 같은 식)이
  정답 후보를 맞히도록 W, b 를 조금 움직인다. ||W − W0||² 벌점으로 기존 판단에서 크게 벗어나지 않게 한다.
- 벌점 세기 λ 는 피드백 안의 5겹 교차 검증으로 고르고, 교차 검증에서 지금 헤드보다 나아진 그룹만 바꾼다
  (데이터가 적은 그룹은 그대로 둔다). 부위를 잘라 보는 그룹(키에 @ 가 붙은 헤드가 있는 그룹)은 전체 사진 헤드만 손댄다.

사용
  node tools/export-taxonomy.mjs > /tmp/taxonomy.json
  python3 tools/finetune-heads.py --heads heads/marqo-fashionSigLIP.json --labels embeddings/marqo-fashionSigLIP.json \
      --tax /tmp/taxonomy.json --feedback beauty-review-*.jsonl --out heads/marqo-fashionSigLIP.json
  (먼저 --dry-run 으로 바뀌는 그룹과 교차 검증 결과만 볼 수 있다)
"""
import argparse, base64, glob, importlib.util, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("th", os.path.join(HERE, "train-heads.py"))
th = importlib.util.module_from_spec(spec); spec.loader.exec_module(th)
SCALE = 100.0


def f32(b64, rows, dim):
    return np.frombuffer(base64.b64decode(b64), dtype=np.float32).reshape(rows, dim).copy()


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()


def softmax(z):
    z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)


def final_probs(W, b, alpha, X, T, zb):
    ph = softmax(X @ W.T + b)
    zs = softmax(X @ T.T * SCALE + zb)
    return ph, zs, alpha * ph + (1 - alpha) * zs


def fit(W0, b0, alpha, X, Y, T, zb, lam, w=None, steps=300):
    """partial-label 손실 + λ·||Δ||² 를 Adam 으로 줄인다. Y: 행마다 정답 후보 인덱스 목록"""
    n, k = len(X), len(W0)
    M = np.zeros((n, k)); [M.__setitem__((i, j), 1.0) for i, ys in enumerate(Y) for j in ys]
    w = np.ones(n) if w is None else w
    W, b = W0.copy(), b0.copy()
    scale = float(np.abs(W0).mean()) or 1.0
    lr = 0.02 * scale
    mW = np.zeros_like(W); vW = np.zeros_like(W); mb = np.zeros_like(b); vb = np.zeros_like(b)
    for t in range(1, steps + 1):
        ph, zs, p = final_probs(W, b, alpha, X, T, zb)
        S = (p * M).sum(1) + 1e-12
        g_ph = -alpha * M / S[:, None] * w[:, None] / w.sum()           # dL/dph
        dz = ph * (g_ph - (g_ph * ph).sum(1, keepdims=True))             # softmax 미분
        gW = dz.T @ X + 2 * lam * (W - W0) / (scale ** 2) * 1e-3
        gb = dz.sum(0) + 2 * lam * (b - b0) / (scale ** 2) * 1e-3
        for P, G, m, v in ((W, gW, mW, vW), (b, gb, mb, vb)):
            m *= 0.9; m += 0.1 * G; v *= 0.999; v += 0.001 * G * G
            P -= lr * (m / (1 - 0.9 ** t)) / (np.sqrt(v / (1 - 0.999 ** t)) + 1e-8)
    return W, b


def acc(W, b, alpha, X, Y, T, zb):
    _, _, p = final_probs(W, b, alpha, X, T, zb)
    top = p.argmax(1)
    return float(np.mean([top[i] in ys for i, ys in enumerate(Y)]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--heads", required=True); ap.add_argument("--labels", required=True); ap.add_argument("--tax", required=True)
    ap.add_argument("--feedback", nargs="+", required=True); ap.add_argument("--out")
    ap.add_argument("--min-rows", type=int, default=8, help="이보다 피드백이 적은 그룹은 손대지 않는다")
    ap.add_argument("--lams", default="0.3,1,3,10,30")
    ap.add_argument("--min-gain", type=float, default=0.02, help="교차 검증 정확도가 이만큼 이상 오른 그룹만 바꾼다")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    heads = json.load(open(a.heads)); tax = json.load(open(a.tax))
    _, idx = th.load_index(a.labels, tax)
    dim = heads["dim"]
    files = [f for pat in a.feedback for f in (glob.glob(pat) or [pat])]
    rows = []
    for fp in files:
        for line in open(fp, encoding="utf-8"):
            if not line.strip(): continue
            r = json.loads(line)
            if r.get("model") != heads["model"] or r.get("hash") != tax["hash"]: continue
            v = np.frombuffer(base64.b64decode(r["emb"]), dtype=np.float32)
            if len(v) != dim: continue
            rows.append((r["category"], r.get("labels") or {}, v / np.linalg.norm(v), 3.0 if r.get("source") == "expert-review" else 1.0))
    print(f"피드백 {len(rows)}행 (파일 {len(files)}개)", file=sys.stderr)
    lams = [float(x) for x in a.lams.split(",")]
    changed, report = 0, []
    rng = np.random.default_rng(0)
    for c in tax["categories"]:
        for g in tax["groups"][c]:
            key = f"{c}.{g['key']}"
            h = heads["groups"].get(key)
            if not h: continue
            labs = g["labels"]
            data = [(v, [labs.index(l) for l in L[g["key"]] if l in labs], wt) for (cat, L, v, wt) in rows if cat == c and L.get(g["key"])]
            data = [d for d in data if d[1]]
            if len(data) < a.min_rows:
                if data: report.append((key, len(data), None, None, None, "피드백 부족"))
                continue
            X = np.stack([d[0] for d in data]); Y = [d[1] for d in data]; wts = np.array([d[2] for d in data])
            W0 = f32(h["W"], h["rows"], dim); b0 = np.array(h["b"], dtype=np.float64)
            T = idx[c]["groups"][g["key"]]; zb = np.array(h.get("zb") or [0.0] * h["rows"]); alpha = h.get("alpha", 1.0)
            base = acc(W0, b0, alpha, X, Y, T, zb)
            folds = np.array_split(rng.permutation(len(X)), min(5, len(X)))
            best = (base, None)
            for lam in lams:
                hit = 0
                for f in folds:
                    tr = np.setdiff1d(np.arange(len(X)), f)
                    W, b = fit(W0, b0, alpha, X[tr], [Y[i] for i in tr], T, zb, lam, wts[tr])
                    hit += acc(W, b, alpha, X[f], [Y[i] for i in f], T, zb) * len(f)
                cv = hit / len(X)
                if cv > best[0] + 1e-9: best = (cv, lam)
            # 교차 검증 기준선: 지금 헤드가 같은 사진들을 맞힌 비율
            if best[1] is not None and best[0] - base >= a.min_gain:
                W, b = fit(W0, b0, alpha, X, Y, T, zb, best[1], wts)
                if not a.dry_run:
                    h["W"] = b64(W); h["b"] = [round(float(x), 5) for x in b]; h["ft"] = {"rows": len(X), "lam": best[1], "cv": round(best[0], 3), "before": round(base, 3)}
                changed += 1
                report.append((key, len(X), base, best[0], best[1], "바꿈"))
            else:
                report.append((key, len(X), base, best[0], best[1], "그대로 (나아지지 않음)"))
    print(f"{'그룹':<22}{'행':>5}{'지금':>8}{'교차검증':>9}{'λ':>6}  결과")
    for key, n, b, cv, lam, note in report:
        fmt = lambda x: f"{x:.1%}" if x is not None else "-"
        print(f"{key:<22}{n:>5}{fmt(b):>8}{fmt(cv):>9}{(lam if lam is not None else '-')!s:>6}  {note}")
    print(f"\n바뀐 그룹 {changed}개", file=sys.stderr)
    if changed and not a.dry_run:
        out = a.out or a.heads
        json.dump(heads, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
        print(f"저장: {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
