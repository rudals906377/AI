"""학습 헤드에 '비슷한 학습 사진(kNN)' 투표를 섞고, 그룹별 확률 보정 · 단정 기준을 다시 맞춘다.

사용: python3 tools/train-knn.py --tax taxonomy.json --labels embeddings/<model>.json \\
        --train tr.f32 --train-meta tr.json --train-list list.json \\
        --eval ev.f32 --eval-meta ev.json --eval-list eval_list.json \\
        --heads heads.json --out heads.json [--commercial --include-user-provided --user-weight 3] [--k 15 --tau 30]

그룹마다 (부위로 판단하는 그룹은 빼고)
  1. 학습 사진을 출처 단위 5겹으로 나눠, 헤드(같은 lam · alpha · 감점으로 다시 학습)와 kNN 투표의 폴드 밖 예측을 만든다
  2. 섞는 비율 β (0 ~ 0.4) 중 폴드 밖 정확도가 가장 높은 값 (같으면 작은 값). 폴드는 작가 단위
  3. 섞은 폴드 밖 예측으로 확률 보정 온도를 다시 맞추고, '이 이상이면 95% 맞는' 그룹별 단정 기준을 구한다
결과: heads.json 의 knn (학습 사진 특징값 8비트 + 그룹마다 β · 사진 번호 · 정답 후보), calib, conf
"""
import argparse, base64, importlib.util, json, os, re, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('th', f'{ROOT}/tools/train-heads.py'); th = importlib.util.module_from_spec(spec); spec.loader.exec_module(th)


def main():
    ap = argparse.ArgumentParser()
    for a in ('tax', 'labels', 'train', 'train-meta', 'train-list', 'eval', 'eval-meta', 'eval-list', 'heads', 'out'): ap.add_argument('--' + a)
    ap.add_argument('--commercial', action='store_true'); ap.add_argument('--include-user-provided', action='store_true')
    ap.add_argument('--user-weight', type=float, default=1.0); ap.add_argument('--k', type=int, default=15); ap.add_argument('--tau', type=float, default=30.0)
    ap.add_argument('--beta-max', type=float, default=0.4, help='섞는 비율 β 의 상한 (0.1 단위로 고른다)')
    ap.add_argument('--bank-exclude', default='', help='kNN 이웃에서 뺄 출처(group 접두어, 쉼표로). 예: b3 — 보조 에이전트 라벨의 잡음을 그대로 옮기지 않게')
    args = ap.parse_args()
    BETAS = tuple(round(x, 1) for x in np.arange(0, args.beta_max + 1e-9, 0.1))
    tax = json.load(open(args.tax)); lj, idx = th.load_index(args.labels, tax)
    H = json.load(open(args.heads)); assert H['hash'] == tax['hash'] and H['model'] == lj['model']
    tl = json.load(open(args.train_list)); el = json.load(open(args.eval_list))
    if args.commercial:
        free = lambda l: (bool(l) and l != '?' and l != 'user-provided' and not re.search(r'(^|[-\s])(nd|nc)([-\s]|$)', l.lower())) \
            or (l == 'user-provided' and args.include_user_provided)
        tl = [r for r in tl if free(r.get('license'))]
    Xtr, rtr = th.load_emb(args.train, args.train_meta, tl); Xev, rev = th.load_emb(args.eval, args.eval_meta, el)
    keep = (Xtr @ Xev.T).max(1) < 0.95; Xtr = Xtr[keep]; rtr = [r for r, k in zip(rtr, keep) if k]   # train-heads 와 같은 중복 제거
    cats = tax['categories']
    zc = th.softmax(th.SCALE * np.stack([(Xtr @ idx[c]['detect'].T).max(1) for c in cats], 1))
    lab_p = np.array([zc[i, cats.index(tl[r]['category'])] if tl[r]['category'] in cats else 1.0 for i, r in enumerate(rtr)])
    clean = lab_p >= 0.15; Xtr = Xtr[clean]; rtr = [r for r, k in zip(rtr, clean) if k]           # 잡음 제거도 같게
    regions = H.get('regions', {})
    bank_rows, bank_of, kgroups, calib, conf = [], {}, {}, dict(H.get('calib', {})), {}
    rep = []
    tot = {'ev0': [0, 0], 'evk': [0, 0]}
    for c in cats:
        for g in tax['groups'][c]:
            key = f'{c}.{g["key"]}'; labels = g['labels']; T = idx[c]['groups'][g['key']]; C = len(labels)
            if key in regions: continue
            rows, S = [], []
            for i, r in enumerate(rtr):
                acc = tl[r]['labels'].get(g['key']) if tl[r]['category'] == c else None
                if acc:
                    s = np.array([l in acc for l in labels], float)
                    if s.sum(): rows.append(i); S.append(s)
            if len(rows) < 20: continue
            # 폴드는 작가 단위로 나눈다: 같은 작가의 비슷한 사진이 학습 · 검증에 갈라지면 kNN 이 부풀려 보인다
            V = Xtr[rows]; S = np.array(S); grp = [tl[rtr[i]].get('creator') or tl[rtr[i]].get('group', rtr[i]) for i in rows]
            sw = np.array([args.user_weight if tl[rtr[i]].get('license') in ('user-provided', 'user-feedback') else 1.0 for i in rows])
            h = H['groups'].get(key)
            uniq = sorted(set(grp)); rng = np.random.default_rng(0); rng.shuffle(uniq)
            fold = {u: j % 5 for j, u in enumerate(uniq)}; fid = np.array([fold[x] for x in grp])
            Ph = th.softmax(th.SCALE * V @ T.T); Pk = np.full_like(Ph, 1.0 / C)
            votes = S / S.sum(1, keepdims=True)
            excl = tuple(x + ':' for x in args.bank_exclude.split(',') if x)
            inbank = np.array([not (excl and str(tl[rtr[i]].get('group', '')).startswith(excl)) for i in rows])
            for f in range(5):
                te, tr = fid == f, fid != f
                if not te.any() or tr.sum() < 10: continue
                pres = sorted(set(np.where(S[tr].sum(0) > 0)[0]))
                if h is not None and len(pres) >= 2:
                    W, b = th.fit(V[tr], S[tr], T, h.get('lam', 3.0), pres, sw=sw[tr], pen=h.get('pen', 0.0), wcap=h.get('wcap'))
                    Ph[te] = th.predict(V[te], W, b, T, h['alpha'], th.zbias(C, pres, h.get('pen', 0.0)))
                bk = tr & inbank
                if bk.sum() < 5: continue
                sims = V[te] @ V[bk].T; nn = np.argsort(-sims, 1)[:, :args.k]
                w = np.exp(args.tau * (np.take_along_axis(sims, nn, 1) - 1))
                pk = np.einsum('nk,nkc->nc', w, votes[bk][nn]); Pk[te] = pk / np.maximum(pk.sum(1, keepdims=True), 1e-12)
            accs = {bt: th.acc_sets((1 - bt) * Ph + bt * Pk, S) for bt in BETAS}
            beta = max(BETAS, key=lambda bt: accs[bt] - 1e-6 * bt)
            P = (1 - beta) * Ph + beta * Pk
            calib[key] = round(th.calibrate(P, S), 4)
            conf[key] = th.conf_threshold(th.temper(P, calib[key]), S)
            # 평가 세트: 최종 헤드 + 전체 뱅크
            erows = [i for i, r in enumerate(rev) if el[r]['category'] == c and el[r]['labels'].get(g['key'])]
            ev0 = evk = float('nan')
            if erows:
                Ve = Xev[erows]; ES = np.array([[l in el[rev[i]]['labels'][g['key']] for l in labels] for i in erows], float)
                if h is not None:
                    W = np.frombuffer(base64.b64decode(h['W']), dtype=np.float32).reshape(h['rows'], -1); b = np.array(h['b'])
                    zb = np.array(h['zb']) if 'zb' in h else None
                    Pe = th.predict(Ve, W, b, T, h['alpha'], zb)
                else: Pe = th.softmax(th.SCALE * Ve @ T.T)
                Vb, vb = V[inbank], votes[inbank]
                sims = Ve @ Vb.T; nn = np.argsort(-sims, 1)[:, :args.k]; w = np.exp(args.tau * (np.take_along_axis(sims, nn, 1) - 1))
                pk = np.einsum('nk,nkc->nc', w, vb[nn]); pk = pk / np.maximum(pk.sum(1, keepdims=True), 1e-12)
                ev0 = th.acc_sets(Pe, ES); evk = th.acc_sets((1 - beta) * Pe + beta * pk, ES)
                tot['ev0'][0] += ev0 * len(ES); tot['evk'][0] += evk * len(ES); tot['ev0'][1] += len(ES); tot['evk'][1] += len(ES)
            rep.append((key, len(rows), accs[0.0], accs[beta], beta, conf[key], len(erows), ev0, evk))
            if beta > 0:
                ids = []
                for i in np.array(rows)[inbank]:
                    if i not in bank_of: bank_of[i] = len(bank_rows); bank_rows.append(i)
                    ids.append(bank_of[i])
                kgroups[key] = {'beta': beta, 'k': args.k, 'tau': args.tau, 'rows': ids, 'labels': [[int(j) for j in np.where(s > 0)[0]] for s in S[inbank]]}
            print(f'{key:20s} n {len(rows):4d} | oof {accs[0.0]*100:5.1f} → {accs[beta]*100:5.1f} (β {beta}) | 단정 기준 {conf[key]:.2f} | 평가 {len(erows):3d}  {ev0*100:5.1f} → {evk*100:5.1f}', flush=True)
    if tot['ev0'][1]: print(f"\n평가 세트 (부위 그룹 제외): {tot['ev0'][0]/tot['ev0'][1]*100:.1f}% → {tot['evk'][0]/tot['evk'][1]*100:.1f}% (n={tot['ev0'][1]})")
    B = Xtr[bank_rows]; scale = 127.0 / float(np.abs(B).max()) if len(B) else 1.0
    q = np.clip(np.round(B * scale), -127, 127).astype(np.int8)
    H['knn'] = {'dim': int(Xtr.shape[1]), 'rows': len(bank_rows), 'scale': scale, 'q': base64.b64encode(q.tobytes()).decode(), 'groups': kgroups}
    H['calib'] = calib; H['conf'] = {**H.get('conf', {}), **conf}
    json.dump(H, open(args.out, 'w'))
    print(f'saved: kNN 그룹 {len(kgroups)}개 · 뱅크 {len(bank_rows)}장 ({len(H["knn"]["q"]) // 1024} KB) · 단정 기준 {len(conf)}개 → {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
