"""속성별 분류 헤드 학습 (CLIP 임베딩 위의 경량 분류기)

방식
- 그룹마다 소프트맥스 분류기를 두고, 가중치를 '라벨 문장 임베딩(제로샷)'에서 출발시킨다.
  logits = t · (T + Δ) · v + b      (T: 라벨 문장 임베딩, v: 사진 임베딩)
- Δ 에 L2 벌점을 줘서 제로샷에서 크게 벗어나지 않게 한다 → 적은 데이터 · 잡음 라벨에도 안정적
- 정답이 여러 개일 수 있는 약한 라벨(예: '블론드' → 애쉬블론드 or 골드블론드)은
  '후보 중 하나' 확률을 최대화하는 partial-label 손실로 학습한다
- 학습 데이터에 없는 라벨은 손실에서 빼서, 억눌리지 않고 제로샷 판단을 유지한다
- 벌점 λ 와 제로샷 혼합 비율 α 는 학습 데이터 안의 교차 검증으로 정한다 (평가 세트는 보지 않음)

사용
  python3 tools/train-heads.py --tax taxonomy.json --labels emb.json \
      --train train.f32 --train-meta train.json --train-list train_list.json \
      --eval eval.f32 --eval-meta eval.json --eval-list eval_list.json --out heads.json
"""
import argparse, base64, json, re, sys
import numpy as np

SCALE = 100.0


def load_index(path, tax):
    j = json.load(open(path))
    buf = np.frombuffer(base64.b64decode(j["data"]), dtype=np.float32).reshape(-1, j["dim"])
    k, idx = 0, {}
    for c in tax["categories"]:
        L = j["layout"][c]
        det = buf[k:k + L["detect"]]; k += L["detect"]
        groups = {}
        for g in tax["groups"][c]:
            n = L["groups"][g["key"]]; groups[g["key"]] = buf[k:k + n]; k += n
        idx[c] = {"detect": det, "groups": groups}
    if j["layout"].get("other"):
        idx["other"] = buf[k:k + j["layout"]["other"]]
    return j, idx


def load_emb(f32, meta, lst=None):
    """임베딩 + 목록의 행 번호. 메타에 파일 경로가 있으면 경로로 목록과 맞춘다 (목록 순서가 바뀌어도 안전)."""
    m = json.load(open(meta))
    X = np.fromfile(f32, dtype=np.float32).reshape(-1, m["dim"])[:m["count"]]
    if lst is not None and m.get("files"):
        pos = {e["file"]: i for i, e in enumerate(lst)}
        keep = [k for k, f in enumerate(m["files"]) if f in pos]
        return X[keep], [pos[m["files"][k]] for k in keep]
    return X, m["index"]


def softmax(z):
    z = z - z.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def fit(V, S, T, lam, present, steps=150, lr=0.03, smooth=0.05):
    """V: N×D, S: N×C 0/1 정답 후보 마스크, T: C×D 초기(라벨 문장) 가중치."""
    N, D = V.shape; C = T.shape[0]
    D_ = np.zeros_like(T); b = np.zeros(C); logt = np.log(SCALE)
    mask = np.full(C, -1e9); mask[present] = 0.0            # 학습 데이터에 없는 라벨은 제외
    # 클래스 불균형 보정: 각 샘플 가중치 = 1 / (정답 후보들의 평균 빈도)
    freq = S.sum(0) / max(S.sum(), 1)
    w = 1.0 / np.maximum((S * freq).sum(1) / np.maximum(S.sum(1), 1), 1e-3)
    w = w / w.mean()
    m = {k: 0.0 for k in ("D", "b", "t")}; v2 = {k: 0.0 for k in ("D", "b", "t")}
    for step in range(1, steps + 1):
        t = np.exp(logt)
        sims = V @ (T + D_).T
        p = softmax(t * sims + b + mask)
        q = p * S; q = q / np.maximum(q.sum(1, keepdims=True), 1e-12)   # partial-label 목표
        q = (1 - smooth) * q + smooth * (p > 0) * (mask == 0) / max(len(present), 1)
        gz = (p - q) * w[:, None] / N
        gD = t * gz.T @ V + 2 * lam * D_
        gb = gz.sum(0)
        gt = (gz * sims).sum() * t
        for k, g in (("D", gD), ("b", gb), ("t", gt)):
            m[k] = 0.9 * m[k] + 0.1 * g; v2[k] = 0.999 * v2[k] + 0.001 * g * g
            upd = lr * (m[k] / (1 - 0.9 ** step)) / (np.sqrt(v2[k] / (1 - 0.999 ** step)) + 1e-8)
            if k == "D": D_ -= upd
            elif k == "b": b -= upd
            else: logt -= upd
    b[[i for i in range(C) if i not in set(present)]] = b[present].mean() if len(present) else 0.0
    return np.exp(logt) * (T + D_), b


def predict(V, W, b, T, alpha):
    ph = softmax(V @ W.T + b)
    pz = softmax(SCALE * V @ T.T)
    return alpha * ph + (1 - alpha) * pz


def acc_sets(P, S):
    return float(np.mean(S[np.arange(len(S)), P.argmax(1)] > 0)) if len(S) else float("nan")


def cv_select(V, S, T, present, groups=None, lams=(1.0, 3.0, 10.0, 30.0), alphas=(0.0, 0.25, 0.5, 0.75, 1.0), k=3, seed=0):
    """출처 단위 교차 검증: 같은 검색어·분류에서 온 사진은 같은 폴드에만 둔다.
    (같은 작가·앨범 사진이 학습과 검증에 나뉘면 성능이 부풀려 보이기 때문)"""
    rng = np.random.default_rng(seed)
    if groups is None: groups = np.arange(len(V))
    uniq = np.array(sorted(set(groups))); rng.shuffle(uniq)
    fold_of = {g: i % k for i, g in enumerate(uniq)}
    fid = np.array([fold_of[g] for g in groups])
    folds = [np.where(fid == f)[0] for f in range(k)]
    best = (-1, None, None)
    for lam in lams:
        preds = {a: np.zeros((len(V), T.shape[0])) for a in alphas}
        for f in folds:
            if not len(f): continue
            tr = np.where(fid != fid[f[0]])[0]
            pres = sorted(set(np.where(S[tr].sum(0) > 0)[0]))
            if len(pres) < 2: continue
            W, b = fit(V[tr], S[tr], T, lam, pres)
            for a in alphas: preds[a][f] = predict(V[f], W, b, T, a)
        for a in alphas:
            acc = acc_sets(preds[a], S)
            if acc > best[0] + 1e-9: best = (acc, lam, a)
    zs = acc_sets(softmax(SCALE * V @ T.T), S)
    return best, zs


def main():
    ap = argparse.ArgumentParser()
    for a in ("tax", "labels", "train", "train-meta", "train-list", "eval", "eval-meta", "eval-list", "out", "junk", "junk-meta"):
        ap.add_argument("--" + a)
    ap.add_argument("--min-samples", type=int, default=15)
    ap.add_argument("--commercial", action="store_true",
                    help="상업 이용과 개작이 모두 허용된 라이선스(CC0 · 퍼블릭 도메인 · BY · BY-SA)의 사진만 학습에 쓴다")
    args = ap.parse_args()
    tax = json.load(open(args.tax))
    lj, idx = load_index(args.labels, tax)
    tl = json.load(open(args.train_list)); el = json.load(open(args.eval_list))
    if args.commercial:
        # ND(개작 금지) · NC(비영리) 는 뺀다. 라이선스 정보가 없는 사진도 뺀다.
        free = lambda l: bool(l) and l != "?" and not re.search(r"(^|[-\s])(nd|nc)([-\s]|$)", l.lower())
        n0 = len(tl); tl = [r for r in tl if free(r.get("license"))]
        print(f"commercial filter: keep {len(tl)} of {n0}", file=sys.stderr)
    Xtr, rtr = load_emb(args.train, args.train_meta, tl)
    Xev, rev = load_emb(args.eval, args.eval_meta, el)
    cats = tax["categories"]
    heads, report = {}, []

    # 평가 세트와 거의 같은 사진은 학습에서 뺀다 (정보 누수 방지)
    sim = Xtr @ Xev.T
    keep = sim.max(1) < 0.95
    print(f"train {len(Xtr)} → dedup vs eval {keep.sum()}", file=sys.stderr)
    Xtr = Xtr[keep]; rtr = [r for r, k in zip(rtr, keep) if k]

    def unit(v): return v / np.linalg.norm(v)
    Tcat = np.stack([unit(idx[c]["detect"].mean(0)) for c in cats])
    is_other = np.array([tl[r]["category"] not in cats for r in rtr])

    # 잡음 제거: 라벨 카테고리의 제로샷 확률이 아주 낮은 뷰티 사진은 뺀다 (예: 매니큐어 분류에 섞인 일반 인물 사진)
    zcat = softmax(SCALE * np.stack([(Xtr @ idx[c]["detect"].T).max(1) for c in cats], 1))
    lab_p = np.array([zcat[i, cats.index(tl[r]["category"])] if not is_other[i] else 1.0 for i, r in enumerate(rtr)])
    clean = lab_p >= 0.15
    print(f"noise filter: drop {(~clean).sum()} of {(~is_other).sum()} beauty rows", file=sys.stderr)
    Xtr = Xtr[clean]; rtr = [r for r, k in zip(rtr, clean) if k]; is_other = is_other[clean]

    # ── 뷰티 판별 헤드 (뷰티 사진 vs 기타 사진)
    if is_other.sum() >= 30 and "other" in idx:
        Tb = np.stack([unit(np.concatenate([idx[c]["detect"] for c in cats]).mean(0)), unit(idx["other"].mean(0))])
        Sb = np.stack([~is_other, is_other], 1).astype(float)
        (cv_acc, lam, alpha), zs_cv = cv_select(Xtr, Sb, Tb, [0, 1], groups=[tl[r].get("group", r) for r in rtr])
        W, b = fit(Xtr, Sb, Tb, lam, [0, 1])
        heads["beauty"] = (W, b, alpha)
        Xb = Xev; Sbe = np.tile([1.0, 0.0], (len(Xev), 1))
        if args.junk:
            Xj, _ = load_emb(args.junk, args.junk_meta)
            Xb = np.concatenate([Xev, Xj]); Sbe = np.concatenate([Sbe, np.tile([0.0, 1.0], (len(Xj), 1))])
        zs_ev = acc_sets(softmax(SCALE * Xb @ Tb.T), Sbe); tr_ev = acc_sets(predict(Xb, W, b, Tb, alpha), Sbe)
        report.append(("beauty", len(Xtr), zs_cv, cv_acc, lam, alpha, len(Xb), zs_ev, tr_ev))

    # ── 카테고리 헤드 (뷰티 사진만)
    Xc = Xtr[~is_other]; rc = [r for r, o in zip(rtr, is_other) if not o]
    Scat = np.zeros((len(Xc), len(cats)))
    for i, r in enumerate(rc): Scat[i, cats.index(tl[r]["category"])] = 1
    (cv_acc, lam, alpha), zs_cv = cv_select(Xc, Scat, Tcat, list(range(len(cats))), groups=[tl[r].get("group", r) for r in rc])
    W, b = fit(Xc, Scat, Tcat, lam, list(range(len(cats))))
    heads["category"] = (W, b, alpha)
    Sev = np.zeros((len(Xev), len(cats)))
    for i, r in enumerate(rev): Sev[i, cats.index(el[r]["category"])] = 1
    # 카테고리 제로샷 기준은 앱과 같게 '문장별 최대 유사도'로 잰다
    zs_ev = acc_sets(softmax(SCALE * np.stack([(Xev @ idx[c]["detect"].T).max(1) for c in cats], 1)), Sev)
    tr_ev = acc_sets(predict(Xev, W, b, Tcat, alpha), Sev)
    report.append(("category", len(Xc), zs_cv, cv_acc, lam, alpha, int(Sev.sum()), zs_ev, tr_ev))

    # ── 속성 그룹 헤드
    for c in cats:
        for g in tax["groups"][c]:
            key = f"{c}.{g['key']}"; labels = g["labels"]; T = idx[c]["groups"][g["key"]]
            rows, S = [], []
            for i, r in enumerate(rtr):
                acc = tl[r]["labels"].get(g["key"]) if tl[r]["category"] == c else None
                if not acc: continue
                s = np.array([l in acc for l in labels], dtype=float)
                if s.sum() == 0: continue
                rows.append(i); S.append(s)
            erows, ES = [], []
            for i, r in enumerate(rev):
                acc = el[r]["labels"].get(g["key"]) if el[r]["category"] == c else None
                if acc: erows.append(i); ES.append(np.array([l in acc for l in labels], dtype=float))
            ES = np.array(ES) if ES else np.zeros((0, len(labels)))
            Ve = Xev[erows] if erows else np.zeros((0, Xev.shape[1]))
            zs_ev = acc_sets(softmax(SCALE * Ve @ T.T), ES) if len(ES) else float("nan")
            if len(rows) < args.min_samples or len({int(np.argmax(s)) for s in S}) < 2:
                report.append((key, len(rows), float("nan"), float("nan"), None, None, len(ES), zs_ev, zs_ev))
                continue
            V = Xtr[rows]; S = np.array(S)
            present = sorted(set(np.where(S.sum(0) > 0)[0]))
            (cv_acc, lam, alpha), zs_cv = cv_select(V, S, T, present, groups=[tl[rtr[i]].get("group", rtr[i]) for i in rows])
            if cv_acc <= zs_cv + 0.01 or alpha == 0.0:  # 출처가 다른 사진에서 이득이 없으면 헤드를 쓰지 않는다
                report.append((key, len(rows), zs_cv, cv_acc, lam, 0.0, len(ES), zs_ev, zs_ev))
                continue
            W, b = fit(V, S, T, lam, present)
            heads[key] = (W, b, alpha)
            tr_ev = acc_sets(predict(Ve, W, b, T, alpha), ES) if len(ES) else float("nan")
            report.append((key, len(rows), zs_cv, cv_acc, lam, alpha, len(ES), zs_ev, tr_ev))

    print(f"{'group':22s} {'n_train':>7s} {'cv_zs':>6s} {'cv_head':>7s} {'lam':>5s} {'alpha':>5s} | {'n_eval':>6s} {'eval_zs':>7s} {'eval_head':>9s}")
    for k, n, zc, hc, lam, a, ne, ze, he in report:
        f = lambda x: "  -  " if x != x else f"{x*100:5.1f}"
        print(f"{k:22s} {n:7d} {f(zc):>6s} {f(hc):>7s} {str(lam):>5s} {str(a):>5s} | {ne:6d} {f(ze):>7s} {f(he):>9s}")

    ne_tot = sum(ne for k, n, zc, hc, lam, a, ne, ze, he in report if "." in k and ne and ze == ze)
    zs_tot = sum(ne * ze for k, n, zc, hc, lam, a, ne, ze, he in report if "." in k and ne and ze == ze)
    hd_tot = sum(ne * he for k, n, zc, hc, lam, a, ne, ze, he in report if "." in k and ne and he == he)
    print(f"\nATTRIBUTES (eval, n={ne_tot}): zero-shot {zs_tot / ne_tot * 100:.1f}%  →  with heads {hd_tot / ne_tot * 100:.1f}%")

    if args.out:
        out = {"model": lj["model"], "hash": tax["hash"], "dim": lj["dim"], "groups": {}}
        for key, (W, b, alpha) in heads.items():
            out["groups"][key] = {"rows": int(W.shape[0]), "W": base64.b64encode(W.astype(np.float32).tobytes()).decode(),
                                  "b": [round(float(x), 5) for x in b], "alpha": float(alpha)}
        json.dump(out, open(args.out, "w"))
        print(f"saved {len(heads)} heads → {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
