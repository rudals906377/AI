"""메이크업 그룹마다 전체 사진 vs 얼굴 · 눈 · 입술 크롭 임베딩을 5겹 교차 검증으로 비교해, 가장 나은 영역의 헤드를 만든다.

사용: python3 tools/train-region-heads.py <work-dir> [최소 이득, 기본 0.02]
  <work-dir> 에 manifest.json (라벨), taxonomy.json, emb_{full,face,eye,lip}.{f32,json} 이 있어야 한다.
  출력: <work-dir>/region_heads.json → tools/merge-region-heads.py 로 heads/*.json 에 합친다.
"""
# 메이크업 그룹마다 전체 사진 vs 얼굴 · 눈 · 입술 크롭 임베딩으로 5겹 교차 검증 → 가장 나은 영역의 헤드를 만든다
import json, os, sys, base64, importlib.util
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT = sys.argv[1]
spec = importlib.util.spec_from_file_location('th', f'{ROOT}/tools/train-heads.py'); th = importlib.util.module_from_spec(spec); spec.loader.exec_module(th)
tax = json.load(open(f'{OUT}/taxonomy.json')); lj, idx = th.load_index(f'{ROOT}/embeddings/marqo-fashionSigLIP.json', tax)
man = json.load(open(f'{OUT}/manifest.json'))
def load(region):
    meta = json.load(open(f'{OUT}/emb_{region}.json'))
    X = np.fromfile(f'{OUT}/emb_{region}.f32', dtype=np.float32).reshape(-1, meta['dim'])[:meta['count']]
    return {f: X[i] for i, f in enumerate(meta['files'])}
E = {r: load(r) for r in ('full', 'face', 'eye', 'lip')}
man = [m for m in man if m['file'] in E['full']]   # 사진을 받은 것만
by_i = {m['i']: m for m in man}
groups = [g for g in tax['groups']['makeup']]
report, heads, calib, regions = [], {}, {}, {}
MIN_GAIN = float(sys.argv[2]) if len(sys.argv) > 2 else 0.02
for g in groups:
    key = f"makeup.{g['key']}"; labels = g['labels']; T = idx['makeup']['groups'][g['key']]
    rows = []
    for m in man:
        acc = m['labels'].get(g['key'])
        if not acc: continue
        s = np.array([l in acc for l in labels], dtype=float)
        if s.sum() == 0: continue
        rows.append((m, s))
    res = {}
    for region in E:
        files = [f"{OUT}/{'img' if region == 'full' else region}/{m['i']:04d}.jpg" for m, _ in rows]
        keep = [k for k, f in enumerate(files) if f in E[region]]
        # 크롭이 없는 사진(얼굴 못 찾음)은 전체 사진 임베딩으로 대신한다 → 앱 동작과 같다
        V = np.stack([E[region][files[k]] if files[k] in E[region] else E['full'][f"{OUT}/img/{rows[k][0]['i']:04d}.jpg"] for k in range(len(files))])
        S = np.stack([s for _, s in rows])
        present = sorted(set(np.where(S.sum(0) > 0)[0]))
        if len(rows) < 15 or len(present) < 2: res[region] = None; continue
        sw = np.array([3.0 if m.get('license') == 'user-provided' else 1.0 for m, _ in rows])
        grp = [m['group'] for m, _ in rows]
        (cv_acc, lam, alpha), zs_cv, oof = th.cv_select(V, S, T, present, groups=grp, sw=sw)
        res[region] = dict(cv=cv_acc, zs=zs_cv, lam=lam, alpha=alpha, oof=oof, V=V, S=S, present=present, sw=sw, n=len(rows), ncrop=len(keep))
    if not res.get('full'):
        report.append((key, len(rows), None)); continue
    best = max((r for r in res if res[r]), key=lambda r: res[r]['cv'])
    # 전체 사진보다 MIN_GAIN 이상 나아야 바꾼다. 어느 쪽도 40% 가 안 되는 그룹(톤)은 그대로 둔다
    pick = best if res[best]['cv'] >= res['full']['cv'] + MIN_GAIN and res[best]['cv'] >= 0.4 else 'full'
    r = res[pick]
    use_head = not (r['cv'] <= r['zs'] + 0.01 or r['alpha'] == 0.0 or r['cv'] < 0.4)
    P_oof = r['oof'] if use_head else th.softmax(th.SCALE * r['V'] @ T.T)
    temp = th.calibrate(P_oof, r['S'])
    if pick != 'full':
        regions[key] = pick
        calib[f'{key}@{pick}'] = temp
        if use_head:
            W, b = th.fit(r['V'], r['S'], T, r['lam'], r['present'], sw=r['sw'])
            heads[f'{key}@{pick}'] = dict(region=pick, W=W, b=b, alpha=r['alpha'])
    report.append((key, r['n'], {reg: (res[reg]['zs'], res[reg]['cv'], res[reg]['ncrop']) if res[reg] else None for reg in E}, pick, use_head))
print(f"{'group':18s} {'n':>4s} | {'full zs/cv':>12s} | {'face zs/cv':>12s} | {'eye zs/cv':>12s} | {'lip zs/cv':>12s} | pick")
for key, n, r, *rest in report:
    if r is None: print(f'{key:18s} {n:4d} | (too few)'); continue
    f = lambda x: '   -   ' if not x else f'{x[0]*100:4.1f}/{x[1]*100:4.1f}'
    print(f"{key:18s} {n:4d} | {f(r['full']):>12s} | {f(r['face']):>12s} | {f(r['eye']):>12s} | {f(r['lip']):>12s} | {rest[0]}{'' if rest[1] else ' (zs only)'}")
out = {'model': lj['model'], 'hash': tax['hash'], 'dim': lj['dim'], 'groups': {}, 'regions': regions, 'calib': {k: round(v, 4) for k, v in calib.items()}}
for key, h in heads.items():
    out['groups'][key] = {'rows': int(h['W'].shape[0]), 'W': base64.b64encode(h['W'].astype(np.float32).tobytes()).decode(),
                          'b': [round(float(x), 5) for x in h['b']], 'alpha': float(h['alpha']), 'region': h['region']}
json.dump(out, open(f'{OUT}/region_heads.json', 'w'))
print('regions:', regions, '| heads:', list(heads), '| calib:', list(calib))
