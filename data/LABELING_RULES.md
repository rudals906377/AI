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
  only if clearly visible. `eye` describes the dominant eye makeup. Bare face with no visible makeup → "x".
- nail: `shape` and `length` only if nail tips are clearly visible. `design` is the main technique;
  plain single color = "원컬러". Toe nails are allowed (skip shape/length for toes).
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
- No labels have been reviewed by human beauty professionals yet.
