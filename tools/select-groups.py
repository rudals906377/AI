"""이어 학습한 헤드(후보)에서 그룹마다 받아들일지 정해 배포 헤드에 합친다

받아들이는 그룹 (셋 다):
  ① 평가 세트(--eval, 학습에 안 쓴 사진)에서 맞힌 수가 줄지 않는다
  ② 새 시험 사진(--test, 이어 학습에 안 쓴 몫)에서 --min-test-gain 문항 이상 더 맞힌다
  ③ 평가 사진 전체에서 그 그룹 1위 답의 분포가 크게 바뀌지 않는다 (TV 거리 --tv-max 이하)
     — ③ 은 평가 라벨이 없거나 적은 그룹이 드문 라벨 쪽으로 쏠리는 것을 막는다
       (R16: 속눈썹 그룹이 평범한 메이크업 사진 47장 중 22장을 '컬러 마스카라'로 읽었다)

사용
  python3 tools/select-groups.py --base heads/X.json --cand /tmp/X-ft.json --labels embeddings/X.json --tax /tmp/taxonomy.json \\
      --test test.jsonl --eval eval.jsonl --out heads/X.json
"""
import argparse, importlib.util, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pa", os.path.join(HERE, "pseudo-anchors.py"))
pa = importlib.util.module_from_spec(spec); spec.loader.exec_module(pa)


def per_group(heads, idx, tax, rows):
    """그룹별 (문항 수, 맞힌 수, 평가 사진 전체의 1위 답 분포)"""
    out = {}
    for c in tax["categories"]:
        R = [r for r in rows if r["category"] == c]
        if not R: continue
        X = pa.embs(R)
        for g in tax["groups"][c]:
            key = f"{c}.{g['key']}"
            if key not in heads["groups"]: continue
            p = pa.app_probs(heads, idx, key, X); top = p.argmax(1)
            ys = [[g["labels"].index(l) for l in (r.get("labels") or {}).get(g["key"], []) if l in g["labels"]] for r in R]
            asked = [i for i, y in enumerate(ys) if y]
            out[key] = (len(asked), sum(top[i] in ys[i] for i in asked), np.bincount(top, minlength=p.shape[1]) / len(R))
    return out


def main():
    ap = argparse.ArgumentParser()
    for k in ("base", "cand", "labels", "tax", "out"): ap.add_argument("--" + k, required=True)
    ap.add_argument("--test", nargs="+", required=True); ap.add_argument("--eval", nargs="+", required=True)
    ap.add_argument("--min-test-gain", type=int, default=2); ap.add_argument("--tv-max", type=float, default=0.15)
    a = ap.parse_args()
    B = json.load(open(a.base)); C = json.load(open(a.cand)); tax = json.load(open(a.tax)); _, idx = pa.ft.th.load_index(a.labels, tax)
    test = pa.load_rows(a.test, B["model"]); ev = pa.load_rows(a.eval, B["model"])
    bt, ct, be, ce = per_group(B, idx, tax, test), per_group(C, idx, tax, test), per_group(B, idx, tax, ev), per_group(C, idx, tax, ev)
    took = []
    print(f"{'그룹':<20}{'새 시험':>10}{'평가':>10}{'분포 변화':>10}  결과")
    for key, h in C["groups"].items():
        if h == B["groups"].get(key): continue
        z = (0, 0, None)
        dt = ct.get(key, z)[1] - bt.get(key, z)[1]; de = ce.get(key, z)[1] - be.get(key, z)[1]
        tv = 0.5 * float(np.abs(be[key][2] - ce[key][2]).sum()) if key in be else 1.0
        ok = de >= 0 and dt >= a.min_test_gain and tv <= a.tv_max
        print(f"{key:<20}{dt:>+10d}{de:>+6d}/{ce.get(key, z)[0]:<3d}{tv:>10.2f}  {'받아들임' if ok else '-'}")
        if ok: B["groups"][key] = h; took.append(key)
    tot = lambda d: (sum(v[0] for v in d.values()), sum(v[1] for v in d.values()))
    for name, rows, base in (("새 시험", test, bt), ("평가 세트", ev, be)):
        after = per_group(B, idx, tax, rows); (n0, h0), (n1, h1) = tot(base), tot(after)
        print(f"{name}: {h0 / max(n0, 1):.1%} → {h1 / max(n1, 1):.1%} ({n1}문항)")
    json.dump(B, open(a.out, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"받아들인 그룹 {len(took)}개: {', '.join(took) or '없음'} → {a.out}")


if __name__ == "__main__":
    main()
