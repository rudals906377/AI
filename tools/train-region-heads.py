"""그룹마다 전체 사진 vs 부위 크롭 임베딩을 5겹 교차 검증으로 비교해, 가장 나은 영역의 헤드를 만든다.

사용: python3 tools/train-region-heads.py <work-dir> [--cat makeup] [--regions face,eye,lip] [--min-gain 0.02]
                                            [--labels embeddings/marqo-fashionSigLIP.json]
  <work-dir> 에 manifest.json (라벨), taxonomy.json, emb_full.{f32,json} 과 영역마다 emb_<영역>.{f32,json} 이 있어야 한다.
  출력: <work-dir>/region_heads.json → tools/merge-region-heads.py 로 heads/*.json 에 합친다.
  (옛 사용법 `<work-dir> <최소 이득>` 도 된다: 메이크업 · face,eye,lip)
"""
import argparse, json, os, sys, base64, importlib.util
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('work'); ap.add_argument('gain', nargs='?', type=float, default=None)
ap.add_argument('--cat', default='makeup'); ap.add_argument('--regions', default='face,eye,lip'); ap.add_argument('--min-gain', type=float, default=0.02)
ap.add_argument('--labels', default=f'{ROOT}/embeddings/marqo-fashionSigLIP.json')
args = ap.parse_args(); OUT = args.work; CAT = args.cat; REGIONS = args.regions.split(','); MIN_GAIN = args.gain if args.gain is not None else args.min_gain
spec = importlib.util.spec_from_file_location('th', f'{ROOT}/tools/train-heads.py'); th = importlib.util.module_from_spec(spec); spec.loader.exec_module(th)
tax = json.load(open(f'{OUT}/taxonomy.json')); lj, idx = th.load_index(args.labels, tax)
man = json.load(open(f'{OUT}/manifest.json'))
def load(region):
    meta = json.load(open(f'{OUT}/emb_{region}.json'))
    X = np.fromfile(f'{OUT}/emb_{region}.f32', dtype=np.float32).reshape(-1, meta['dim'])[:meta['count']]
    return {f: X[i] for i, f in enumerate(meta['files'])}
E = {r: load(r) for r in ['full'] + REGIONS}
full_path = lambda m: m['file'] if m['file'] in E['full'] else f"{OUT}/img/{m['i']:04d}.jpg"
man = [m for m in man if full_path(m) in E['full']]   # 전체 사진 임베딩이 있는 것만
groups = [g for g in tax['groups'][CAT]]
report, heads, calib, regions, conf = [], {}, {}, {}, {}
for g in groups:
    key = f"{CAT}.{g['key']}"; labels = g['labels']; T = idx[CAT]['groups'][g['key']]
    rows = []
    for m in man:
        acc = m['labels'].get(g['key'])
        if not acc: continue
        s = np.array([l in acc for l in labels], dtype=float)
        if s.sum() == 0: continue
        rows.append((m, s))
    res = {}
    for region in E:
        files = [full_path(m) if region == 'full' else f"{OUT}/{region}/{m['i']:04d}.jpg" for m, _ in rows]
        keep = [k for k, f in enumerate(files) if f in E[region]]
        # 크롭이 없는 사진(부위를 못 찾음)은 전체 사진 임베딩으로 대신한다 → 앱 동작과 같다
        V = np.stack([E[region][files[k]] if files[k] in E[region] else E['full'][full_path(rows[k][0])] for k in range(len(files))])
        S = np.stack([s for _, s in rows])
        present = sorted(set(np.where(S.sum(0) > 0)[0]))
        if len(rows) < 15 or len(present) < 2: res[region] = None; continue
        sw = np.array([3.0 if m.get('license') == 'user-provided' else 1.0 for m, _ in rows])
        grp = [m['group'] for m, _ in rows]
        (cv_acc, lam, alpha, pen), zs_cv, oof, wc = th.cv_select_wcap(V, S, T, present, groups=grp, sw=sw)   # 가중치 상한도 교차 검증으로
        res[region] = dict(cv=cv_acc, zs=zs_cv, lam=lam, alpha=alpha, pen=pen, wcap=wc, oof=oof, V=V, S=S, present=present, sw=sw, n=len(rows), ncrop=len(keep))
    if not res.get('full'):
        report.append((key, len(rows), None)); continue
    best = max((r for r in res if res[r]), key=lambda r: res[r]['cv'])
    # 전체 사진보다 MIN_GAIN 이상 나아야 바꾼다. 어느 쪽도 40% 가 안 되는 그룹은 그대로 둔다
    pick = best if res[best]['cv'] >= res['full']['cv'] + MIN_GAIN and res[best]['cv'] >= 0.4 else 'full'
    r = res[pick]
    use_head = not (r['cv'] <= r['zs'] + 0.01 or r['alpha'] == 0.0 or r['cv'] < 0.4)
    P_oof = r['oof'] if use_head else th.softmax(th.SCALE * r['V'] @ T.T)
    temp = th.calibrate(P_oof, r['S'])
    if pick != 'full':
        regions[key] = pick
        calib[f'{key}@{pick}'] = temp
        conf[key] = th.conf_threshold(th.temper(P_oof, temp), r['S'])   # 그룹별 단정 기준 (부위 판단 기준)
        if use_head:
            W, b = th.fit(r['V'], r['S'], T, r['lam'], r['present'], sw=r['sw'], pen=r['pen'], wcap=r['wcap'])
            heads[f'{key}@{pick}'] = dict(region=pick, W=W, b=b, alpha=r['alpha'], zb=th.zbias(len(labels), r['present'], r['pen']))
    report.append((key, r['n'], {reg: (res[reg]['zs'], res[reg]['cv'], res[reg]['ncrop']) if res[reg] else None for reg in E}, pick, use_head))
cols = ['full'] + REGIONS
print(f"{'group':18s} {'n':>4s} | " + ' | '.join(f"{c + ' zs/cv':>12s}" for c in cols) + ' | pick')
for key, n, r, *rest in report:
    if r is None: print(f'{key:18s} {n:4d} | (too few)'); continue
    f = lambda x: '   -   ' if not x else f'{x[0]*100:4.1f}/{x[1]*100:4.1f}'
    print(f"{key:18s} {n:4d} | " + ' | '.join(f"{f(r[c]):>12s}" for c in cols) + f" | {rest[0]}{'' if rest[1] else ' (zs only)'}")
out = {'model': lj['model'], 'hash': tax['hash'], 'dim': lj['dim'], 'groups': {}, 'regions': regions, 'calib': {k: round(v, 4) for k, v in calib.items()}, 'conf': conf}
for key, h in heads.items():
    out['groups'][key] = {'rows': int(h['W'].shape[0]), 'W': base64.b64encode(h['W'].astype(np.float32).tobytes()).decode(),
                          'b': [round(float(x), 5) for x in h['b']], 'alpha': float(h['alpha']), 'region': h['region']}
    if h['zb'] is not None: out['groups'][key]['zb'] = [round(float(x), 3) for x in h['zb']]
json.dump(out, open(f'{OUT}/region_heads.json', 'w'))
print('regions:', regions, '| heads:', list(heads), '| calib:', list(calib))
