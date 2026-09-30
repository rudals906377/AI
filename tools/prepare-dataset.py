"""수집한 사진 목록(items_*.jsonl)을 학습용 목록으로 바꾼다.

- 수집 당시 라벨(예전 이름 포함)을 현재 분류 체계(taxonomy.json) 라벨로 바꾼다
  예: ('nail', 'technique', '크롬·미러') → ('design', ['크롬'])
- 라벨 하나가 여러 새 라벨에 해당하면 모두 정답 후보로 둔다 (partial label)
- 출처 · 라이선스 목록(CSV)을 함께 만든다 — 상업적 이용 시 학습 데이터 출처 증빙용

사용: python3 tools/prepare-dataset.py --tax taxonomy.json --items data/items_*.jsonl \
        --out train_list.json --sources DATA_SOURCES.csv
"""
import argparse, csv, glob, json, os, re

BROWNS = ["초코브라운", "밀크브라운", "애쉬브라운", "카키브라운", "골드브라운"]
# (카테고리, 예전 그룹, 예전 라벨) → (새 그룹, [새 라벨...])
OLD = {
    ("hair", "length", "장발"): ("length", ["긴머리"]),
    ("hair", "style", "땋은 머리"): ("styling", ["땋은머리"]),
    ("hair", "style", "포니테일"): ("styling", ["포니테일"]),
    ("hair", "style", "업스타일·번"): ("styling", ["똥머리", "업스타일"]),
    ("hair", "style", "드레드"): ("styling", ["드레드"]),
    ("hair", "style", "투블럭·언더컷"): ("cut", ["투블럭컷"]),
    ("hair", "style", "리젠트·포마드"): ("cut", ["포마드·슬릭백"]),
    ("hair", "style", "원랭스 보브"): ("cut", ["태슬컷"]),
    ("hair", "style", "모히칸"): ("cut", ["모히칸"]),
    ("hair", "style", "히메컷"): ("cut", ["히메컷"]),
    ("hair", "style", "울프컷"): ("cut", ["울프컷"]),
    ("hair", "texture", "내추럴 곱슬"): ("perm", ["내추럴 곱슬", "히피펌"]),
    ("hair", "texture", "S컬 웨이브"): ("perm", ["S컬펌", "빌드펌"]),
    ("hair", "texture", "스트레이트"): ("perm", ["생머리"]),
    ("hair", "color", "블론드"): ("color", ["애쉬블론드", "골드블론드"]),
    ("hair", "color", "핑크·파스텔"): ("color", ["핑크·라벤더"]),
    ("hair", "color", "레드·오렌지"): ("color", ["오렌지브라운", "비비드 레드", "레드와인"]),
    ("hair", "color", "그레이·화이트"): ("color", ["애쉬그레이"]),
    ("hair", "color", "블랙"): ("color", ["흑발", "블루블랙"]),
    ("hair", "color", "*브라운"): ("color", BROWNS),
    ("hair", "color", "투톤·하이라이트"): ("colorTech", ["브릿지", "발레아쥬", "옴브레", "투톤", "이너컬러"]),
    ("nail", "technique", "프렌치"): ("design", ["프렌치"]),
    ("nail", "technique", "글리터"): ("design", ["글리터"]),
    ("nail", "technique", "크롬·미러"): ("design", ["크롬"]),
    ("nail", "technique", "그라데이션"): ("design", ["그라데이션", "치크"]),
    ("nail", "technique", "마블"): ("design", ["마블"]),
    ("nail", "technique", "플라워"): ("design", ["플라워", "드로잉"]),
    ("nail", "technique", "파츠·스톤"): ("design", ["파츠", "진주"]),
    ("nail", "technique", "매트"): ("finish", ["매트"]),
    ("nail", "technique", "오로라·캣아이"): ("design", ["오로라", "자석"]),
    ("nail", "shape", "코핀·발레리나"): ("shape", ["코핀"]),
    ("nail", "shape", "스퀘어"): ("shape", ["스퀘어", "라운드스퀘어"]),
    ("nail", "color", "레드·와인"): ("color", ["레드", "버건디"]),
    ("nail", "color", "핑크"): ("color", ["연핑크", "핫핑크"]),
    ("nail", "color", "블랙·그레이"): ("color", ["블랙"]),
    ("nail", "color", "블루·네이비"): ("color", ["네이비·블루", "하늘색"]),
    ("nail", "color", "누드·베이지"): ("color", ["누드·베이지", "밀키화이트"]),
    ("nail", "color", "파스텔"): ("color", ["연핑크", "하늘색", "민트·그린", "라벤더·퍼플"]),
    ("nail", "length", "숏"): ("length", ["숏네일"]),
    ("nail", "length", "롱"): ("length", ["롱네일"]),
    ("makeup", "eye", "윙 아이라인"): ("eye", ["캣아이라인"]),
    ("makeup", "eye", "컬러 포인트"): ("eye", ["컬러 섀도"]),
    ("makeup", "eye", "속눈썹 강조"): ("eye", ["인형 속눈썹"]),
    ("makeup", "lip", "핑크"): ("lip", ["로즈핑크", "말린장미"]),
    ("makeup", "lip", "누드·MLBB"): ("lip", ["MLBB"]),
    ("makeup", "lip", "딥·버건디"): ("lip", ["버건디·플럼"]),
    ("makeup", "lip", "코랄·오렌지"): ("lip", ["코랄", "오렌지"]),
    ("makeup", "mood", "내추럴·데일리"): ("mood", ["데일리", "청순"]),
    ("makeup", "mood", "브라이덜"): ("mood", ["웨딩"]),
    ("makeup", "mood", "파티·아트"): ("mood", ["아트"]),
    ("tattoo", "style", "리얼리즘"): ("style", ["블랙앤그레이", "컬러 리얼리즘"]),
    ("tattoo", "style", "지오메트릭·도트워크"): ("style", ["도트워크"]),
    ("tattoo", "style", "파인라인·미니멀"): ("style", ["파인라인", "미니멀"]),
    ("tattoo", "style", "미니"): ("style", ["미니멀"]),
    ("tattoo", "style", "쇠맛"): ("style", ["사이버시길리즘"]),
    ("tattoo", "size", "미니"): ("size", ["미니", "스몰"]),
    ("tattoo", "placement", "발목·발"): ("placement", ["발목"]),
    ("tattoo", "placement", "다리·허벅지"): ("placement", ["허벅지"]),
    ("tattoo", "placement", "전완(팔뚝)"): ("placement", ["팔안쪽", "팔뚝"]),
    ("tattoo", "placement", "목·귀 뒤"): ("placement", ["목·귀뒤"]),
    ("tattoo", "placement", "손·손목·손가락"): ("placement", ["손목", "손가락"]),
    ("tattoo", "subject", "신화·판타지"): ("subject", ["해골·다크", "용·호랑이·잉어"]),
    ("tattoo", "subject", "인물·얼굴"): ("subject", ["인물"]),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tax", required=True)
    ap.add_argument("--items", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sources")
    a = ap.parse_args()
    tax = json.load(open(a.tax))
    valid = {c: {g["key"]: set(g["labels"]) for g in tax["groups"][c]} for c in tax["categories"]}
    rows, unmapped = [], {}
    files = [f for p in a.items for f in glob.glob(p)]
    base = os.path.dirname(os.path.abspath(files[0])) if files else "."
    for fn in files:
        for line in open(fn):
            it = json.loads(line)
            lab = dict(it["labels"]); cat = lab.pop("category")
            labels = {}
            if cat == "other":  # 뷰티가 아닌 사진 (뷰티 판별 학습용 음성 예시)
                lab = {}
            for g, l in lab.items():
                if cat in valid and g in valid[cat] and l in valid[cat][g]:
                    labels.setdefault(g, []).append(l)
                elif (cat, g, l) in OLD:
                    ng, nl = OLD[(cat, g, l)]
                    labels.setdefault(ng, []).extend(nl)
                else:
                    unmapped[(cat, g, l)] = unmapped.get((cat, g, l), 0) + 1
            path = it["file"] if os.path.isabs(it["file"]) else os.path.join(os.path.dirname(os.path.abspath(fn)), it["file"])
            # 출처 묶음 (검색어 또는 Commons 분류) — 교차 검증을 출처 단위로 나눌 때 쓴다
            source_group = it.get("query") or it.get("root") or it["key"]
            rows.append({"file": path, "category": cat, "labels": labels, "key": it["key"], "group": source_group,
                         "license": it.get("license"), "page": it.get("page"), "creator": it.get("creator") or "",
                         "title": it.get("title")})
    json.dump(rows, open(a.out, "w"), ensure_ascii=False)
    print(f"{len(rows)} rows → {a.out}; unmapped: {unmapped}")
    if a.sources:
        with open(a.sources, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["key", "title", "creator", "license", "source_page"])
            for r in rows:
                w.writerow([r["key"], re.sub(r"\s+", " ", r["title"] or "")[:200], r["creator"], r["license"], r["page"]])
        print(f"sources → {a.sources}")


if __name__ == "__main__":
    main()
