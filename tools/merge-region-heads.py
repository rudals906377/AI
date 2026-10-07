"""부위 헤드(region_heads.json)를 배포용 heads/<model>.json 에 합친다: 그룹@부위 키 + regions 지도 + calib.
사용: python3 tools/merge-region-heads.py <region_heads.json> heads/marqo-fashionSigLIP.json
"""
# region_heads.json 의 부위 헤드를 배포용 heads/marqo-fashionSigLIP.json 에 합친다 ('그룹@부위' 키 + regions 지도 + calib)
import json, sys
src, dst = sys.argv[1], sys.argv[2]
rh = json.load(open(src)); H = json.load(open(dst))
assert rh['model'] == H['model'] and rh['hash'] == H['hash'] and rh['dim'] == H['dim']
# 이전에 합친 부위 헤드는 지운다
H['groups'] = {k: v for k, v in H['groups'].items() if '@' not in k}
H['calib'] = {k: v for k, v in H.get('calib', {}).items() if '@' not in k}
H['regions'] = dict(rh['regions'])
for key, g in rh['groups'].items():
    H['groups'][key] = {k: v for k, v in g.items() if k != 'region'} | {'region': g['region']}
for key, t in rh['calib'].items(): H['calib'][key] = t
json.dump(H, open(dst, 'w'))
print('regions:', H['regions'], '| region heads:', [k for k in H['groups'] if '@' in k], '| calib:', [k for k in H['calib'] if '@' in k])
