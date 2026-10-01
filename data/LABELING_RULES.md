# Labeling rules (read fully before starting)

You label beauty photos for training a classifier. Accuracy matters far more than coverage:
a wrong label hurts more than a missing one. Only label what you can actually see.

## Output
Write a Python file that defines one dict `L`, mapping photo id → value:

- `"x"`  : skip. Too small/blurry to judge, the relevant part is barely visible, a collage of many
           unrelated photos, a drawing/illustration of the style (not a real photo), or you are unsure.
- `"O"`  : NOT a beauty photo at all (landscape, food, product/bottle only, animal, object, text,
           hardware nails/screws, a crowd where no style is the subject).
- dict   : `{group_key: [label, ...], ...}` using ONLY the exact Korean label strings from the
           taxonomy file for that category. Group keys are the English keys (e.g. "length", "eye").

If a photo on a sheet is clearly a different beauty category than the sheet's category
(e.g. a hair photo on a makeup sheet), add `"_cat": "hair"` and use that category's groups:
`{"_cat": "hair", "length": ["긴머리"], ...}`.

## How to fill a dict
- Include a group only if it is clearly visible and you are confident. Omit it otherwise.
- The list is ordered: most likely label first. Add a 2nd (at most 3rd) label only when the photo
  is genuinely between them (e.g. `["오벌", "아몬드"]`). Do not list alternatives "just in case".
- Aim for 2–6 groups per photo. A photo with nothing confidently labelable → `"x"`.
- Mood groups (hair.mood, nail.mood, makeup.mood) are allowed when the overall vibe is clear.

## Category notes
- hair: `colorTech` ONLY when a technique is visible (bridge/highlights, balayage, ombre, inner color,
  two-tone). Plain single color → omit colorTech. `styling` ONLY when hair is tied/braided/updo/half-up.
  Hair down → omit styling. `bangs` = "확인 불가" for back views or when the forehead is hidden.
  `tone` only for dyed/colored hair that clearly leans cool (ash, blue, violet) or warm (gold, orange, red).
- makeup: judge the face. `base` only if skin finish is clearly visible. `lipTexture`, `cheek`, `tone`
  only if clearly visible. Bare face with no visible makeup → "x".
  `eye` = eyeshadow only (섀도 없음 for bare lids), `eyeLine` = eyeliner only (내추럴 라인 when thin or none),
  `lash` = lashes (내추럴 속눈썹 unless clearly emphasized), `brow` = 일자 / 아치 / 탈색 when the brows are visible,
  `detail` = face gems or drawn freckles (포인트 없음 when the face clearly has neither).
  `cheek`: 홍조 블러셔 spreads across the cheeks and over the nose bridge; 숙취 블러셔 sits high, right under the eyes.
- nail: `part` is always 핸드 or 패디. `shape` and `length` only if nail tips are clearly visible. `design` is the main
  technique; plain single color = "원컬러". `layout` (동일디자인 / 원포인트 / 퐁당퐁당 / 오마카세) only when 3 or more nails
  are visible. Toe nails are allowed (skip shape/length for toes).
- tattoo: `style` is the genre; `color` is ink color; `placement` only if the body part is identifiable;
  `size` relative to the body part. Henna, scars, body paint, stickers → "x". A tattoo artist at work
  where the tattoo is not visible → "x".
- border sheets: photos where the model is unsure whether it is a beauty photo. Decide: "O" (not beauty),
  "x" (unusable), or a dict with `"_cat"` set to hair/nail/makeup/tattoo.

## Process
1. Read these rules and the label list for your category (`taxonomy.js`, the `ko` names).
2. Review photos in small contact sheets (for example 3x3 with an id tag on each photo) and record labels in the format above.
3. Validate every label against `taxonomy.js` before training (unknown group or label names must be fixed, not ignored).
4. Spot-check: have a second labeler label a random sample blind and compare. The third batch in this repository
   agreed on 92% of shared group labels; groups that disagree systematically should be re-defined or excluded.

## Label provenance in `labels_clean.jsonl`
- `labeler: "claude"` — labeled by Claude viewing each photo (batches 1, 2, 4).
- `labeler: "claude-agent"` — labeled by assistant agents following these rules (batch 3); used only for the attribute
  groups where it improved accuracy on held-out claude labels.
- `review: "v2"` — after the label set grew from 215 to 324 labels (see `docs/LABEL_RESEARCH.md`), every photo was
  reviewed again by assistant agents against the v2 list, starting from its v1 labels. Renamed or split v1 labels are
  kept as candidate sets when a group was not reviewed (for example 등 → 등 / 날개뼈 / 척추 / 허리·골반).
- `batch: "6"` — photos found in the unlabeled crawl pool as candidates for v2 labels that had no training photos,
  labeled by assistant agents (171 kept of 644 candidates; the rest were not usable beauty photos).
- No labels have been reviewed by human beauty professionals yet.
