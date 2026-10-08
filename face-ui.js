// 내 얼굴 분석 화면 — 셀카 입력(파일 · 휴대폰 전면 카메라 · PC 웹캠), 다시 찍기 안내, 측정선 · 메이크업 위치 그림, 결과 카드
//
//   const face = initFaceUI({ getStyle: () => ({ result, blob }) });
//   face.styleChanged(result);   // 스타일 분석 결과가 바뀌면 (헤어 · 메이크업이면 '내 얼굴 분석' 안내를 보여 준다)

import { analyzeFace, combineFaces, preloadFace, liveCheck, FRAME, SEG } from './face.js';
import { faceReport, rankStyles, styleFit } from './face-advice.js';
import { faceCard, shareImage } from './share-card.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 궁합 카드 (styleFit 결과) — 스타일 결과 화면과 얼굴 분석 화면이 같은 모양으로 보여 준다
function fitHtml(fit, head) {
  const plus = fit.reasons.filter((x) => x.pts > 0).slice(0, 3), minus = fit.reasons.filter((x) => x.pts < 0).slice(0, 3);
  return `<small>${esc(head)} · ${esc(fit.title)}</small>
    <b class="${fit.good ? 'good' : 'meh'}">${esc(fit.verdict)}${fit.score != null ? ` <span class="fit-score">궁합 ${fit.score}점</span>` : ''}</b>
    ${fit.score != null ? `<div class="fit-bar"><i style="width:${fit.score}%"></i></div>` : ''}
    ${plus.length || minus.length ? `<ul class="fit-why">${plus.map((x) => `<li class="plus">${esc(x.text)}</li>`).join('')}${minus.map((x) => `<li class="minus">${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${fit.tip ? `<p>${esc(fit.tip)}</p>` : ''}
    ${fit.score != null ? `<div class="fit-vote"><span>이 판단, 어떠세요?</span><button class="ghost small" type="button" data-vote="1">맞아요</button><button class="ghost small" type="button" data-vote="0">글쎄요</button></div>` : ''}`;
}

export function initFaceUI({ getStyle, analyzeStyle = null, toast = () => {}, copy = async () => {} }) {
  const els = {
    tabs: $('modeTabs'), styleGrid: $('styleGrid'), faceGrid: $('faceGrid'),
    purpose: $('facePurpose'), gender: $('faceGender'), drop: $('faceDrop'), file: $('faceFile'), camera: $('faceCamera'), preview: $('facePreview'), hint: $('faceHint'),
    shoot: $('faceShoot'), pick: $('facePick'), useStyle: $('faceUseStyle'),
    card: $('faceResultCard'), empty: $('faceEmpty'), status: $('faceStatus'), retake: $('faceRetake'), result: $('faceResult'),
    canvas: $('faceCanvas'), layers: $('faceLayer'), legend: $('faceLegend'),
    shape: $('faceShape'), shapeLabel: $('faceShapeLabel'), summary: $('faceSummary'), bars: $('faceBars'), warn: $('faceWarn'), match: $('faceMatch'),
    shareBtn: $('faceShare'), remember: $('faceRemember'), fitExportRow: $('fitExportRow'), fitExport: $('fitExport'), measures: $('faceMeasures'), adviceTitle: $('faceAdviceTitle'), advice: $('faceAdvice'), copyBtn: $('faceCopy'), againBtn: $('faceAgain'),
    retakeList: $('faceRetakeList'), retakeCanvas: $('faceRetakeCanvas'), retakeBtn: $('faceRetakeBtn'),
    cta: $('faceCta'), styleFit: $('styleFit'), ctaTitle: $('faceCtaTitle'), ctaBtn: $('faceCtaBtn'),
    rank: $('faceRank'), rankPick: $('faceRankPick'), rankAddCur: $('faceRankAddCur'), rankClear: $('faceRankClear'), rankFile: $('faceRankFile'),
    rankStatus: $('faceRankStatus'), rankList: $('faceRankList'), rankSkip: $('faceRankSkip'), rankNote: $('faceRankNote'),
    cam: $('camDialog'), video: $('camVideo'), camShot: $('camShot'), camCancel: $('camCancel'), camNote: $('camNote'),
    camView: $('camView'), camGuide: $('camGuide'), camBox: $('camBox'), camBoxMain: $('camBoxMain'), camBoxSub: $('camBoxSub'), camOk: $('camOk'),
  };
  let purpose = 'hair';
  // 추천 기준(성별): 사용자가 고른 값만 쓴다 (사진으로 추정하지 않음). 이 브라우저에만 기억
  let gender = '';
  try { gender = localStorage.getItem('faceGender') || ''; } catch {}
  // 기억해 둔 얼굴형 (측정값만, 사진 X) — 얼굴 분석을 다시 하지 않아도 스타일 궁합을 볼 수 있게
  const MEMO_KEY = 'beauty-face-memo-v1', VOTE_KEY = 'beauty-fit-feedback-v1';
  let memo = null;
  const currentFits = {}; // 지금 화면에 보이는 궁합 (평가 버튼이 어느 판단에 대한 것인지)
  try { memo = JSON.parse(localStorage.getItem(MEMO_KEY) || 'null'); } catch {}
  const slim = (f) => ({ ok: true, m: f.m, pose: { yaw: f.pose?.yaw ?? 0 }, geo: { hairlineFound: !!f.geo?.hairlineFound }, skin: f.skin || null, shape: { probs: f.shape.probs }, saved: Date.now() });
  function saveMemo() { try { memo = slim(last); localStorage.setItem(MEMO_KEY, JSON.stringify(memo)); } catch { memo = null; } }
  function dropMemo() { memo = null; try { localStorage.removeItem(MEMO_KEY); } catch {} }
  const faceForFit = () => (last?.ok ? last : memo);
  const memoNote = () => (!last?.ok && memo ? ` (기억해 둔 얼굴형 · ${new Date(memo.saved).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })})` : '');
  let blob = null;
  let frameBlobs = null; // 웹캠 연속 촬영 장들 (한 장만 올리면 null)
  let last = null;      // analyzeFace 결과 (여러 장이면 combineFaces 결과)
  let report = null;
  let layer = 'measure';
  let seq = 0;

  // ---- 화면 전환 ------------------------------------------------------------------
  function setMode(mode, { scroll = true } = {}) {
    document.body.dataset.mode = mode;
    els.tabs.querySelectorAll('button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    els.styleGrid.classList.toggle('hidden', mode !== 'style');
    els.faceGrid.classList.toggle('hidden', mode !== 'face');
    if (mode === 'face') {
      preloadFace().catch(() => {}); // 모델을 미리 받아 둔다 (약 20MB, 처음 한 번)
      const { blob: sb } = getStyle();
      els.useStyle.classList.toggle('hidden', !sb);
      if (scroll) els.tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.dispatchEvent(new Event('modechange'));
  }
  els.tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  function setPurpose(p) {
    purpose = p;
    els.purpose.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.purpose === p));
    els.adviceTitle.textContent = p === 'hair' ? '헤어 추천' : gender === 'm' ? '그루밍 추천' : '메이크업 추천';
    if (blob) run(); // 목적이 바뀌면 점검 기준(이마 필요 여부 등)과 추천이 달라진다
  }
  els.purpose.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.purpose !== purpose) setPurpose(b.dataset.purpose); });
  function setGender(g) {
    gender = g;
    try { localStorage.setItem('faceGender', g); } catch {}
    els.gender.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.gender === g));
    els.purpose.querySelector('[data-purpose="makeup"]').textContent = g === 'm' ? '그루밍 · 메이크업' : '메이크업';
    els.adviceTitle.textContent = purpose === 'hair' ? '헤어 추천' : g === 'm' ? '그루밍 추천' : '메이크업 추천';
    if (last && !els.result.classList.contains('hidden')) render(); // 측정은 그대로, 추천만 다시
  }
  els.gender.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.gender !== gender) setGender(b.dataset.gender); });
  setGender(gender);

  // 스타일 분석 결과 카드: 얼굴 분석을 이미 했으면 궁합 피드백, 아직이면 '내 얼굴 분석' 안내
  function styleChanged(r) {
    if (r && r.is_beauty && (r.category === 'hair' || r.category === 'makeup')) {
      els.ctaTitle.textContent = r.category === 'hair' ? '내 얼굴형에도 어울릴까요?' : '내 얼굴형에 맞는 메이크업은?';
      els.ctaBtn.dataset.purpose = r.category;
    }
    if (last?.ok && !els.result.classList.contains('hidden')) render(); // 얼굴 분석 화면의 궁합도 갱신 (안에서 syncStyleFit)
    else syncStyleFit();
  }
  els.ctaBtn.addEventListener('click', () => { setMode('face'); if (els.ctaBtn.dataset.purpose !== purpose) setPurpose(els.ctaBtn.dataset.purpose); });

  // ---- 입력 -------------------------------------------------------------------------
  async function setImage(b, frames = null) {
    if (!b || !b.type?.startsWith('image/')) return;
    blob = b; frameBlobs = frames;
    els.preview.src = URL.createObjectURL(b);
    els.preview.classList.remove('hidden');
    els.hint.classList.add('hidden');
    await els.preview.decode().catch(() => {});
    run();
  }
  for (const input of [els.file, els.camera]) input.addEventListener('change', () => { setImage(input.files[0]); input.value = ''; });
  els.pick.addEventListener('click', () => els.file.click());
  els.useStyle.addEventListener('click', () => { const { blob: sb } = getStyle(); if (sb) setImage(sb); });
  ['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
  els.drop.addEventListener('drop', (e) => setImage(e.dataTransfer.files[0]));
  window.addEventListener('paste', (e) => {
    if (document.body.dataset.mode !== 'face') return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.stopImmediatePropagation(); setImage(item.getAsFile()); }
  }, true);

  // 셀카: 휴대폰 · PC 모두 화면 안 카메라로 찍는다 (가이드 틀 + 자세 안내 + 자동 촬영). 카메라를 못 열면 휴대폰은 카메라 앱, PC 는 사진 고르기
  const coarse = matchMedia('(pointer: coarse)').matches;
  let stream = null;
  els.shoot.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) { (coarse ? els.camera : els.file).click(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      els.video.srcObject = stream;
      els.cam.showModal();
      await els.video.play();
      fitView();
      startGuide();
    } catch (e) {
      console.warn('카메라를 열지 못함', e);
      stopCam();
      toast(coarse ? '카메라를 열지 못해 카메라 앱으로 바꿨어요' : '카메라를 열지 못해 사진 고르기로 바꿨어요');
      (coarse ? els.camera : els.file).click();
    }
  });
  const stopCam = () => { guideOn = false; stream?.getTracks().forEach((t) => t.stop()); stream = null; if (els.cam.open) els.cam.close(); };
  els.camCancel.addEventListener('click', stopCam);
  els.cam.addEventListener('cancel', stopCam);

  // 화면 비율을 카메라 영상과 같게 (휴대폰 세로 영상도 잘리지 않게) + 가이드 틀을 영상 좌표로 그린다
  function fitView() {
    const vw = els.video.videoWidth || 4, vh = els.video.videoHeight || 3;
    els.camView.style.aspectRatio = `${vw} / ${vh}`;
    els.camView.style.width = `min(100%, calc(62vh * ${vw / vh}))`;
    els.camGuide.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    const fh = (FRAME.chin - FRAME.top) * vh, fw = fh * FRAME.widthRatio, cx = vw / 2, top = FRAME.top * vh, chin = FRAME.chin * vh;
    const jx = fh * FRAME.jawRatio / 2, jy = top + fh * FRAME.jawY, crown = top - fh * 0.36, cheekY = top + fh * 0.42, hw = fw / 2;
    const P = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
    // 머리 · 얼굴 윤곽: 턱끝 → 턱 각 → 광대 → 정수리 (좌우 대칭)
    const side = (s) => `C ${P(cx + s * jx * 0.55, chin)} ${P(cx + s * jx * 0.95, jy + fh * 0.08)} ${P(cx + s * jx, jy)} ` +
      `C ${P(cx + s * hw * 0.98, jy - fh * 0.12)} ${P(cx + s * hw, cheekY + fh * 0.12)} ${P(cx + s * hw, cheekY)} ` +
      `C ${P(cx + s * hw * 1.02, top - fh * 0.05)} ${P(cx + s * hw * 0.62, crown)} ${P(cx, crown)}`;
    els.camGuide.querySelector('.g-head').setAttribute('d', `M ${P(cx, chin)} ${side(-1)} M ${P(cx, chin)} ${side(1)}`);
    // 귀: 눈썹 높이 ~ 코 밑 높이, 얼굴선 바깥에 붙은 귀 모양 (귓바퀴 + 안쪽 선). 양쪽 귀가 이 선에 보이면 귀 모양까지 잰다
    const eT = top + fh * 0.3, eB = top + fh * 0.64, ex = hw * 0.97, ew = fh * 0.1;
    const ear = (s) => `M ${P(cx + s * ex, eT + fh * 0.02)} C ${P(cx + s * (ex + ew * 0.5), eT - fh * 0.04)} ${P(cx + s * (ex + ew * 1.15), eT + fh * 0.02)} ${P(cx + s * (ex + ew), eT + fh * 0.12)} ` +
      `C ${P(cx + s * (ex + ew * 0.9), eT + fh * 0.22)} ${P(cx + s * (ex + ew * 0.55), eB - fh * 0.08)} ${P(cx + s * (ex + ew * 0.45), eB - fh * 0.02)} ` +
      `C ${P(cx + s * (ex + ew * 0.35), eB + fh * 0.02)} ${P(cx + s * ex * 1.0, eB)} ${P(cx + s * ex * 0.99, eB - fh * 0.05)} ` +
      `M ${P(cx + s * (ex + ew * 0.25), eT + fh * 0.06)} C ${P(cx + s * (ex + ew * 0.7), eT + fh * 0.04)} ${P(cx + s * (ex + ew * 0.7), eT + fh * 0.18)} ${P(cx + s * (ex + ew * 0.35), eT + fh * 0.22)}`;
    els.camGuide.querySelector('.g-ear').setAttribute('d', `${ear(-1)} ${ear(1)}`);
    // 목 → 어깨: 턱 각 안쪽에서 아래로 내려와 화면 아래에서 어깨로 퍼진다
    const nx = jx * 0.78, ny0 = jy + fh * 0.05, ny1 = Math.min(vh, chin + fh * 0.32);
    const neck = (s) => `M ${P(cx + s * nx, ny0)} L ${P(cx + s * nx, ny1)} C ${P(cx + s * nx, ny1 + fh * 0.12)} ${P(cx + s * hw * 1.6, ny1 + fh * 0.1)} ${P(cx + s * hw * 2.3, vh)}`;
    els.camGuide.querySelector('.g-neck').setAttribute('d', `${neck(-1)} ${neck(1)}`);
  }
  els.video.addEventListener('loadedmetadata', fitView);

  // ---- 자세 안내 -------------------------------------------------------------------
  // 한 번에 하나만, 가장 먼저 고칠 것부터 말한다. 측정값은 몇 프레임 평균(EMA)으로 흔들림을 줄이고,
  // 맞는 상태가 HOLD_MS 동안 이어지면 자동으로 연속 촬영한다
  const HOLD_MS = 1200, TICK_MS = 140;
  let guideOn = false, okSince = 0, ema = null;
  const sample = document.createElement('canvas');
  function brightness(lm) {
    // 얼굴 가운데(코 · 볼)의 밝기 (0~255)
    const v = els.video, W = 48, H = 48;
    sample.width = W; sample.height = H;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    const xs = [234, 454].map((i) => lm[i].x * v.videoWidth), ys = [10, 152].map((i) => lm[i].y * v.videoHeight);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.abs(xs[1] - xs[0]), h = Math.abs(ys[1] - ys[0]);
    if (w < 8 || h < 8) return 128;
    ctx.drawImage(v, x0 + w * 0.25, y0 + h * 0.35, w * 0.5, h * 0.4, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / (d.length / 4);
  }
  // 측정값 → 안내 (main: 큰 글씨, sub: 작은 글씨). null 이면 촬영하기 좋은 자세
  function advise(m) {
    if (!m) return { main: '얼굴이 보이지 않아요', sub: '얼굴과 목을 화면의 선 안에 맞춰 주세요' };
    if (m.faces > 1) return { main: '한 사람만 나오게 해 주세요', sub: '다른 사람이 화면에 함께 보여요' };
    const fh = FRAME.chin - FRAME.top;
    if (m.size < fh * 0.82) return { main: '조금 더 가까이 와 주세요', sub: '얼굴이 선보다 작아요' };
    if (m.size > fh * 1.2) return { main: '조금 뒤로 가 주세요', sub: '가까우면 렌즈 때문에 얼굴 가운데가 커 보여요' };
    if (m.cx < 0.43) return { main: '몸을 오른쪽으로 조금 옮겨 주세요', sub: '얼굴을 선 가운데에 맞춰 주세요' };
    if (m.cx > 0.57) return { main: '몸을 왼쪽으로 조금 옮겨 주세요', sub: '얼굴을 선 가운데에 맞춰 주세요' };
    const cy0 = (FRAME.top + FRAME.chin) / 2;
    if (m.cy < cy0 - 0.07) return { main: '카메라를 조금 위로 올려 주세요', sub: '얼굴이 화면 위쪽에 있어요' };
    if (m.cy > cy0 + 0.07) return { main: '카메라를 조금 아래로 내려 주세요', sub: '얼굴이 화면 아래쪽에 있어요' };
    if (m.yaw > 5) return { main: '고개를 오른쪽으로 조금 돌려 주세요', sub: '카메라를 정면으로 봐 주세요' };
    if (m.yaw < -5) return { main: '고개를 왼쪽으로 조금 돌려 주세요', sub: '카메라를 정면으로 봐 주세요' };
    if (m.pitch > FRAME.pitch0 + 6) return { main: '턱을 조금만 들어 주세요', sub: '고개를 숙이면 얼굴 길이가 짧게 재져요' };
    if (m.pitch < FRAME.pitch0 - 9) return { main: '턱을 조금만 당겨 주세요', sub: '턱을 들면 얼굴 길이가 길게 재져요' };
    if (Math.abs(m.roll) > 6) return { main: '고개를 똑바로 세워 주세요', sub: '고개가 옆으로 기울었어요' };
    if (m.jaw > 0.2) return { main: '입을 다물어 주세요', sub: '턱 길이와 턱선을 재야 해요' };
    if (m.smile > 0.35) return { main: '웃지 말고 무표정으로 해 주세요', sub: '웃으면 볼이 올라가 얼굴 아래쪽이 달라 보여요' };
    if (m.blink > 0.6) return { main: '눈을 떠 주세요', sub: '' };
    if (m.light < 60) return { main: '조금 더 밝은 곳으로 가 주세요', sub: '얼굴이 어두워 경계를 찾기 어려워요' };
    return null;
  }
  function measure(r) {
    if (!r.faces) return null;
    const lm = r.lm, b = r.blend || {};
    const raw = {
      faces: r.faces,
      size: lm[152].y - lm[10].y,
      cx: 1 - (lm[234].x + lm[454].x) / 2,            // 화면은 거울처럼 보이므로 좌우를 뒤집어 화면 기준으로
      cy: (lm[10].y + lm[152].y) / 2,
      yaw: r.pose?.yaw ?? 0, pitch: r.pose?.pitch ?? FRAME.pitch0, roll: r.pose?.roll ?? 0,
      jaw: b.jawOpen || 0, smile: ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2, blink: ((b.eyeBlinkLeft || 0) + (b.eyeBlinkRight || 0)) / 2,
      light: brightness(lm),
    };
    if (!ema || ema.faces !== raw.faces) ema = { ...raw };
    else for (const k of Object.keys(raw)) if (k !== 'faces') ema[k] = 0.55 * raw[k] + 0.45 * ema[k];
    return ema;
  }
  function show(a, okFrac = 0) {
    els.camBoxMain.textContent = a ? a.main : '좋아요! 그대로 계세요';
    els.camBoxSub.textContent = a ? a.sub : '곧 자동으로 찍어요';
    els.camBox.className = `cam-box ${a ? 'adjust' : 'good'}`;
    els.camView.classList.toggle('aligned', !a);
    els.camOk.hidden = !!a;
    els.camOk.querySelector('.p').style.strokeDashoffset = String(106.8 * (1 - okFrac));
  }
  async function startGuide() {
    guideOn = true; okSince = 0; ema = null;
    els.camBoxMain.textContent = '얼굴 분석 모델을 준비하는 중…'; els.camBoxSub.textContent = '처음 한 번 약 20MB 를 내려받아요'; els.camBox.className = 'cam-box';
    try { await preloadFace(); } catch (e) { els.camBoxMain.textContent = '자동 안내를 쓸 수 없어요'; els.camBoxSub.textContent = '"지금 찍기"로 찍어 주세요'; return; }
    while (guideOn && els.cam.open) {
      const t0 = performance.now();
      if (!shooting && els.video.videoWidth) {
        let r = { faces: 0 };
        try { r = await liveCheck(els.video); } catch (e) { console.warn('[face] 자세 확인 실패', e); }
        if (!guideOn) break;
        const a = advise(measure(r));
        if (a) { okSince = 0; show(a); }
        else {
          okSince ||= performance.now();
          const frac = Math.min(1, (performance.now() - okSince) / HOLD_MS);
          show(null, frac);
          if (frac >= 1) {
            // 찍기 직전 한 장을 실제 분석과 같은 기준(부위 분할 포함)으로 점검: 앞머리 · 옆머리 · 손 · 안경처럼 위치로는 모르는 가림을 미리 알려 준다
            els.camBoxMain.textContent = '이마 · 턱선이 보이는지 확인하는 중…'; els.camBoxSub.textContent = '그대로 계세요';
            const pre = await precheck();
            if (!guideOn) break;
            if (pre) { show(pre); okSince = 0; ema = null; await new Promise((res) => setTimeout(res, 2500)); continue; }
            await shoot(); break;
          }
        }
      }
      await new Promise((res) => setTimeout(res, Math.max(30, TICK_MS - (performance.now() - t0))));
    }
  }

  const PRE_KEYS = new Set(['bangs', 'hat', 'sidehair', 'hand', 'mask', 'glasses', 'smile', 'mouth', 'blink', 'many']);
  async function precheck() {
    try {
      const b = await grabFrame();
      const r = await analyzeFace(b, { purpose });
      const hit = (r.issues || []).find((x) => x.level === 'block' && PRE_KEYS.has(x.key));
      return hit ? { main: hit.title, sub: hit.fix.split(/(?<=[.요])\s/)[0] } : null;
    } catch (e) { console.warn('[face] 촬영 전 점검 실패', e); return null; }
  }

  // 웹캠은 한 장이 아니라 약 2초 동안 5장을 찍어 평균 낸다 (표정 · 미세한 각도 차이로 생기는 흔들림을 줄이려고)
  const BURST = 5, BURST_GAP = 450;
  const grabFrame = () => new Promise((resolve) => {
    const v = els.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    // 화면에는 거울처럼 보여 주지만, 분석은 거울을 되돌린 실제 모습으로 (휴대폰 셀카와 같게)
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    c.toBlob(resolve, 'image/jpeg', 0.93);
  });
  let shooting = false;
  async function shoot() {
    if (!els.video.videoWidth || shooting) return;
    shooting = true; els.camShot.disabled = true;
    const frames = [];
    try {
      for (let i = 0; i < BURST; i++) {
        els.camBoxMain.textContent = `찍는 중 ${i + 1} / ${BURST}`; els.camBoxSub.textContent = '그대로 계세요';
        els.camNote.textContent = `찍는 중 ${i + 1} / ${BURST} — 그대로 계세요`;
        frames.push(await grabFrame());
        if (i < BURST - 1) await new Promise((r) => setTimeout(r, BURST_GAP));
      }
    } finally {
      shooting = false; els.camShot.disabled = false;
      els.camNote.textContent = '얼굴과 목을 선에 맞춰 주세요. 자세가 맞으면 자동으로 찍어요. 앞머리 · 옆머리는 넘겨 이마 · 귀 · 턱선이 보이게 해 주세요.';
      stopCam();
    }
    const good = frames.filter(Boolean);
    if (good.length) setImage(good[Math.floor(good.length / 2)], good.length > 1 ? good : null);
  }
  els.camShot.addEventListener('click', shoot);

  // ---- 분석 -------------------------------------------------------------------------
  async function run() {
    if (!blob) return;
    const id = ++seq;
    els.empty.classList.add('hidden');
    els.retake.classList.add('hidden');
    els.result.classList.add('hidden');
    els.status.classList.remove('hidden');
    const n = frameBlobs?.length || 1;
    els.status.innerHTML = `<span class="spin"></span> ${n > 1 ? `${n}장을 재는 중…` : '얼굴을 재는 중…'} <small>처음에는 얼굴 분석 모델(약 20MB)을 내려받아요</small>`;
    if (window.innerWidth < 900) els.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      let f;
      if (n > 1) {
        const results = [];
        for (const b of frameBlobs) { results.push(await analyzeFace(b, { purpose })); if (id !== seq) return; }
        f = combineFaces(results);
        // 미리보기는 중앙값에 가장 가까운 장으로
        const chosen = frameBlobs[results.indexOf(results.find((r) => r.canvas === f.canvas))];
        if (chosen && chosen !== blob) { blob = chosen; els.preview.src = URL.createObjectURL(chosen); }
      } else f = await analyzeFace(blob, { purpose });
      if (id !== seq) return;
      last = f;
      els.status.classList.add('hidden');
      if (!f.ok) renderRetake(f); else render();
    } catch (e) {
      console.error(e);
      if (id !== seq) return;
      els.status.innerHTML = `얼굴 분석 모델을 불러오지 못했어요 (${esc(e.message)}). 인터넷 연결을 확인하고 다시 시도해 주세요.`;
    }
  }
  els.retakeBtn.addEventListener('click', () => els.shoot.click());
  els.againBtn.addEventListener('click', () => els.shoot.click());

  // 다시 찍어 주세요: 무엇이 문제인지 + 가린 곳을 사진 위에 표시
  function renderRetake(f) {
    syncStyleFit();
    els.retake.classList.remove('hidden');
    const blocks = f.issues.filter((x) => x.level === 'block'), warns = f.issues.filter((x) => x.level !== 'block');
    els.retakeList.innerHTML = [...blocks, ...warns].map((x) => `<li class="${x.level}"><b>${esc(x.title)}</b><span>${esc(x.fix)}</span></li>`).join('');
    drawRetake(f);
  }

  function render() {
    const f = last;
    report = faceReport(f, getStyle().result, { gender: gender || null });
    els.result.classList.remove('hidden', 'enter');
    void els.result.offsetWidth;
    els.result.classList.add('enter');
    els.shapeLabel.textContent = f.frames?.used > 1 ? `내 얼굴형 · 웹캠 ${f.frames.total}장 중 ${f.frames.used}장 평균` : '내 얼굴형';
    els.shape.textContent = report.headline;
    // '긴 편' 처럼 꾸밈말과 '편' 사이에서 줄이 나뉘지 않게
    els.summary.innerHTML = report.summary.map((s) => `<span class="s">${esc(s).replace(/ (편|중간)/g, '&nbsp;$1')}</span>`).join(' ');
    if (report.quip) els.summary.innerHTML += `<span class="s face-quip">${esc(report.quip)}</span>`;
    els.bars.innerHTML = f.shape.probs.map((p, i) => `<div class="sb ${i ? '' : 'top'}"><span>${esc(p.label)}</span><i><b style="width:${Math.round(p.p * 100)}%"></b></i><em>${Math.round(p.p * 100)}%</em></div>`).join('');
    const warns = f.issues.filter((x) => x.level !== 'block');
    els.warn.classList.toggle('hidden', !warns.length);
    els.warn.innerHTML = warns.map((x) => `<li><b>${esc(x.title)}</b> ${esc(x.fix)}</li>`).join('');
    // 스타일 분석 결과와의 궁합 (어느 쪽을 먼저 분석했든)
    const mt = report.match;
    els.match.classList.toggle('hidden', !mt);
    if (mt) currentFits.face = { fit: mt, where: 'face' };
    if (mt) els.match.innerHTML = fitHtml(mt, `분석한 ${mt.category === 'hair' ? '헤어' : '메이크업'} 스타일과의 궁합`);
    syncStyleFit();
    // 측정 표
    els.measures.innerHTML = `<thead><tr><th>항목</th><th>내 얼굴</th><th>평균</th><th>풀이</th></tr></thead><tbody>${report.measures
      .filter((r) => purpose === 'makeup' || !['eyeTilt', 'eyeAspect', 'browGap', 'nose', 'lips', 'lipFull', 'mouth'].includes(r.key))
      .map((r) => `<tr class="${Math.abs(r.z) >= 0.8 ? 'hl' : ''}"><th>${esc(r.label)}</th><td>${esc(r.value)}</td><td>${esc(r.avg)}</td><td>${esc(r.note)}</td></tr>`).join('')}</tbody>`;
    // 추천
    const secs = purpose === 'hair' ? report.hair : report.makeup;
    els.advice.innerHTML = secs.map((s) => `<div class="adv ${s.key}${s.zone ? ` z-${s.zone}` : ''}"><b>${s.zone ? '<i class="dot"></i>' : ''}${esc(s.title)}</b>${s.text ? `<p>${esc(s.text)}</p>` : ''}${s.list ? `<ul>${s.list.map((i) => `<li><span>${esc(i.name)}</span>${i.why ? ` <small>${esc(i.why)}</small>` : ''}</li>`).join('')}</ul>` : ''}</div>`).join('');
    // 그림 층: 헤어는 측정선, 메이크업은 메이크업 위치를 먼저
    els.remember.checked = !!memo;
    if (memo) saveMemo(); // 기억하기를 켜 두었으면 새 결과로 바꿔 둔다
    updateFitExport();
    renderRank();
    layer = purpose === 'makeup' ? 'makeup' : 'measure';
    els.layers.querySelector('[data-layer="makeup"]').hidden = purpose !== 'makeup';
    els.layers.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.layer === layer));
    draw();
  }
  els.layers.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    layer = b.dataset.layer;
    els.layers.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  });

  // 얼굴 분석이 끝나거나 바뀌면 스타일 결과 카드의 궁합도 같이 바꾼다 (얼굴 → 스타일 순서일 때는 스타일 분석 때 이미 보임)
  function syncStyleFit() {
    const r = getStyle().result;
    const show = r && r.is_beauty && (r.category === 'hair' || r.category === 'makeup');
    const fit = show && faceForFit() ? styleFit(faceForFit(), r, { gender: gender || null }) : null;
    els.cta.classList.toggle('hidden', !show || !!fit);
    els.styleFit.classList.toggle('hidden', !fit);
    if (fit) {
      currentFits.style = { fit, where: 'style' };
      els.styleFit.innerHTML = fitHtml(fit, `내 얼굴형과의 궁합${memoNote()}`) + `<button class="ghost small" type="button" data-act="face">${last?.ok ? '얼굴 분석 결과 보기' : '얼굴 다시 분석하기'}</button>`;
      els.styleFit.querySelector('[data-act="face"]').onclick = () => { setMode('face'); if (r.category !== purpose) setPurpose(r.category); };
    }
  }

  // ---- 원하는 스타일 여러 장 → 베스트 순위 ------------------------------------------------
  // 고른 사진은 이 화면에만 두고(서버로 보내지 않음), 목적(헤어 · 메이크업)별로 분석 결과를 기억해 둔다
  const RANK_MAX = 8;
  let picks = [];      // { blob, url, res: { hair, makeup } }
  let rankSeq = 0;
  let lastRanked = [];
  const KO = { hair: '헤어', makeup: '메이크업' };
  async function addPicks(blobs) {
    const room = RANK_MAX - picks.length;
    const fresh = [...blobs].filter((b) => b?.type?.startsWith('image/') && !picks.some((p) => p.blob === b));
    if (fresh.length > room) toast(`최대 ${RANK_MAX}장까지 비교할 수 있어서 ${Math.max(0, room)}장만 넣었어요`);
    picks.push(...fresh.slice(0, Math.max(0, room)).map((b) => ({ blob: b, url: URL.createObjectURL(b), res: {} })));
    await analyzePicks();
  }
  async function analyzePicks() {
    const id = ++rankSeq, want = purpose;
    const todo = picks.filter((p) => !(want in p.res));
    if (todo.length && !analyzeStyle) return;
    for (let i = 0; i < todo.length; i++) {
      els.rankStatus.classList.remove('hidden');
      els.rankStatus.innerHTML = `<span class="spin"></span> 스타일 사진 ${picks.indexOf(todo[i]) + 1} / ${picks.length} 장을 살펴보는 중…`;
      try { todo[i].res[want] = await analyzeStyle(todo[i].blob, want); } catch (e) { console.warn('[face] 스타일 분석 실패', e); todo[i].res[want] = null; if (/준비/.test(e.message)) toast(e.message); }
      if (id !== rankSeq) return;
    }
    els.rankStatus.classList.add('hidden');
    renderRank();
  }
  function renderRank() {
    const has = picks.length > 0;
    els.rankClear.classList.toggle('hidden', !has);
    const { blob: sb, result: sr } = getStyle();
    els.rankAddCur.classList.toggle('hidden', !sb || !sr?.is_beauty || picks.some((p) => p.blob === sb));
    $('faceRankTitle').textContent = `원하는 ${KO[purpose]} 비교 · 베스트 순위`;
    if (!has || !last?.ok) { lastRanked = []; els.rankList.innerHTML = ''; els.rankSkip.classList.add('hidden'); els.rankNote.classList.add('hidden'); return; }
    if (picks.some((p) => !(purpose in p.res))) { analyzePicks(); return; }
    const items = picks.map((p, i) => ({ i, url: p.url, result: p.res[purpose] }));
    const { ranked, skipped } = rankStyles(last, items, { purpose, gender: gender || null });
    lastRanked = ranked;
    const medal = ['🥇', '🥈', '🥉'];
    els.rankList.innerHTML = ranked.map((r, k) => {
      const plus = r.reasons.filter((x) => x.pts > 0).slice(0, 3), minus = r.reasons.filter((x) => x.pts < 0).slice(0, 2);
      return `<li class="${k ? '' : 'best'}"><span class="rk">${medal[k] || k + 1}</span><img src="${r.url}" alt="고른 스타일 ${r.i + 1}">
        <div><div class="nm">${esc(r.name)}<small class="no">${r.i + 1}번 사진</small>${k === 0 && ranked.length > 1 ? '<em>베스트</em>' : ''}<small>궁합 ${r.score}점</small></div>
        <div class="bar"><b style="width:${r.score}%"></b></div>
        <ul>${plus.map((x) => `<li>${esc(x.text)}</li>`).join('')}${minus.map((x) => `<li class="minus">${esc(x.text)}</li>`).join('')}</ul></div></li>`;
    }).join('');
    els.rankSkip.classList.toggle('hidden', !skipped.length);
    // 같은 이유로 빠진 사진은 한 줄로 묶는다 (예: 1 · 2 · 5번 사진: 헤어 사진이라 메이크업 비교에서 뺐어요)
    const why = new Map(); for (const x of skipped) why.set(x.skip, [...(why.get(x.skip) || []), x.i + 1]);
    els.rankSkip.innerHTML = [...why].map(([w, ns]) => `<li>${ns.join(' · ')}번 사진: ${esc(w)}</li>`).join('');
    const tie = ranked.length > 1 && ranked[0].score === ranked[1].score;
    els.rankNote.textContent = `${tie ? '점수가 같을 때는 스타일이 더 또렷하게 보이는 사진을 위에 뒀어요. ' : ''}점수는 얼굴 측정과 헤어 · 메이크업 추천표가 얼마나 맞는지를 더한 값이라, 고른 사진들끼리 비교하는 참고용이에요. 마음이 가는 스타일이 가장 좋은 스타일이에요.`;
    els.rankNote.classList.toggle('hidden', !ranked.length);
    report.rank = ranked.map((r, k) => `${k + 1}. ${r.name} (궁합 ${r.score}점)`);
  }
  els.rankPick.addEventListener('click', () => els.rankFile.click());
  els.rankFile.addEventListener('change', () => { addPicks(els.rankFile.files); els.rankFile.value = ''; });
  els.rankAddCur.addEventListener('click', () => {
    const { blob: sb, result: sr } = getStyle();
    if (!sb || picks.some((p) => p.blob === sb)) return;
    if (picks.length >= RANK_MAX) { toast(`최대 ${RANK_MAX}장까지 비교할 수 있어요`); return; }
    const p = { blob: sb, url: URL.createObjectURL(sb), res: {} };
    if (sr && sr.category === purpose) p.res[purpose] = sr;   // 이미 분석한 결과는 다시 쓰지 않는다
    picks.push(p); analyzePicks().then(renderRank);
  });
  els.rankClear.addEventListener('click', () => { picks.forEach((p) => URL.revokeObjectURL(p.url)); picks = []; rankSeq++; els.rankStatus.classList.add('hidden'); renderRank(); });
  els.rank.addEventListener('dragover', (e) => e.preventDefault());
  els.rank.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); addPicks(e.dataTransfer.files); });

  // ---- 그리기 ------------------------------------------------------------------------
  // 얼굴 둘레만 잘라서 보여 준다
  function cropOf(f) {
    const xs = f.geo.oval.map((p) => p[0]), ys = [...f.geo.oval.map((p) => p[1]), f.geo.hairline[1]];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const fw = x1 - x0, fh = y1 - y0;
    let cx = Math.max(0, x0 - fw * 0.42), cy = Math.max(0, y0 - fh * 0.16);
    let cw = Math.min(f.w - cx, fw * 1.84), ch = Math.min(f.h - cy, fh * 1.36);
    return { x: cx, y: cy, w: cw, h: ch };
  }
  function prep(canvas, f) {
    const c = cropOf(f);
    const scale = Math.min(2, 900 / c.w);
    canvas.width = Math.round(c.w * scale); canvas.height = Math.round(c.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(f.canvas, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
    const T = ([x, y]) => [(x - c.x) * scale, (y - c.y) * scale];
    return { ctx, T, scale, c };
  }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 사진 위에서도 잘 보이게 어두운 테두리 + 색 선
  let lw = 1; // 선 굵기 배율
  function line(ctx, pts, color, w = 2, dash = null) {
    w *= lw;
    ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash.map((d) => d * lw));
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = 'rgba(20,14,10,.55)'; ctx.lineWidth = w + 2.2; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }
  function label(ctx, text, x, y, { color = '#fff', align = 'left', size = 13 } = {}) {
    ctx.save();
    ctx.font = `600 ${size}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width, pad = size * 0.4, h = size * 1.6;
    // 그림 밖으로 나가지 않게 상자 위치를 안쪽으로 당긴다
    let bx = align === 'right' ? x - w - pad * 2 : align === 'center' ? x - w / 2 - pad : x;
    bx = Math.max(2, Math.min(ctx.canvas.width - w - pad * 2 - 2, bx));
    ctx.fillStyle = 'rgba(30,22,18,.72)';
    ctx.beginPath(); ctx.roundRect(bx, y - h / 2, w + pad * 2, h, size * 0.45); ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(text, bx + pad, y + 0.5);
    ctx.restore();
  }
  const COLORS = { forehead: '#9fd0ff', cheek: '#ffe08a', jaw: '#ff9f8f', chin: '#ffc27a', third: '#c8f0b0', contour: '#ffffff' };

  function draw() {
    const f = last;
    if (!f?.ok) return;
    const { ctx, T, scale } = prep(els.canvas, f);
    // 화면에 보이는 크기 기준으로 글자 · 선 굵기를 맞춘다 (휴대폰에서도 읽히게)
    const k = Math.max(1, els.canvas.width / (els.canvas.clientWidth || 560));
    const fs = Math.round(12.5 * k);
    lw = k;
    const g = f.geo, m = f.m;
    els.legend.innerHTML = '';
    if (layer === 'measure') {
      // 얼굴선 (마스크로 다듬은 턱선 + 메시 윗부분)
      line(ctx, [...g.oval, g.oval[0]].map(T), 'rgba(255,255,255,.55)', 1.2, [4, 4]);
      line(ctx, g.jaw.map(T), COLORS.contour, 2.2);
      // 너비
      const W = [['forehead', '이마', m.forehead], ['cheek', '광대', 1], ['jaw', '턱', m.jaw], ['chin', '턱끝', m.chin]];
      for (const [k, name, val] of W) {
        const [a, b] = g.widths[k].map(T);
        line(ctx, [a, b], COLORS[k], 2.4);
        for (const p of [a, b]) { ctx.fillStyle = COLORS[k]; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 * lw, 0, Math.PI * 2); ctx.fill(); }
        label(ctx, `${name} ${val === 1 ? '1' : val.toFixed(2)}`, b[0] + 8 * lw, b[1], { color: COLORS[k], size: fs });
      }
      // 삼정
      const th = g.thirds.map(([a, b]) => [T(a), T(b)]);
      th.forEach(([a, b], i) => line(ctx, [a, b], COLORS.third, 1.2, i === 0 && !g.hairlineFound ? [3, 5] : [7, 5]));
      const names = ['상안부', '중안부', '하안부'];
      for (let i = 0; i < 3; i++) {
        const y = (th[i][0][1] + th[i + 1][0][1]) / 2, x = Math.min(th[i][0][0], th[i + 1][0][0]) - 6;
        label(ctx, `${names[i]} ${m.thirds[i].toFixed(2)}`, x, y, { color: COLORS.third, align: 'right', size: fs });
      }
      label(ctx, g.hairlineFound ? '헤어라인' : '헤어라인 (어림)', T(g.hairline)[0], T(g.hairline)[1] - fs * 1.1, { color: COLORS.third, align: 'center', size: fs - 1 });
      // 턱 각도
      const [ga, gb] = g.gonion.map(T);
      for (const p of [ga, gb]) { ctx.fillStyle = '#ff7ad9'; ctx.beginPath(); ctx.arc(p[0], p[1], 4.5 * lw, 0, Math.PI * 2); ctx.fill(); }
      // 귀: 얼굴선 밖으로 보이는 귀의 바깥 끝을 이은 선 (정면에서 두 귀를 잴 수 있었을 때만)
      const earOn = report.traits.ears && report.traits.ears !== 'hidden' && (g.ears || []).every((rows) => rows.length >= 3);
      if (earOn) for (const rows of g.ears) line(ctx, rows.map(([, b]) => T(b)), '#ffd166', 2.2);
      els.legend.innerHTML = `${earOn ? '<span><i style="background:#ffd166"></i>귀 바깥선</span>' : ''}<span><i style="background:#fff;box-shadow:0 0 0 1px var(--line-2)"></i>얼굴선</span><span><i style="background:#9fd0ff"></i>너비 (광대 = 1)</span><span><i style="background:#c8f0b0"></i>삼정</span><span><i style="background:#ff7ad9"></i>턱 모서리 ${Math.round(m.jawAngle)}°</span>`;
    } else if (layer === 'makeup') {
      drawZones(ctx, f, T, scale);
      els.legend.innerHTML = '<span><i style="background:rgba(120,78,55,.8)"></i>쉐딩</span><span><i style="background:#fff;box-shadow:0 0 0 1px var(--line-2)"></i>하이라이터</span>' + (report.gender === 'm' ? '' : '<span><i style="background:rgba(236,110,130,.85)"></i>블러셔</span>');
    }
  }
  function drawZones(ctx, f, T, scale) {
    const g = f.geo, CW = g.CW;
    const p0 = T(g.toImg(0, 0)), pu = T(g.toImg(1, 0)), pv = T(g.toImg(0, 1));
    const ax = [pu[0] - p0[0], pu[1] - p0[1]], ay = [pv[0] - p0[0], pv[1] - p0[1]];
    const FILL = { shade: [110, 70, 48, 0.5], light: [255, 255, 255, 0.62], blush: [236, 104, 124, 0.5] };
    for (const z of report.zones) {
      const v = g.v[z.at] + z.dv * CW;
      for (const side of z.center ? [0] : [-1, 1]) {
        const u = side * z.u * CW;
        ctx.save();
        ctx.setTransform(ax[0], ax[1], ay[0], ay[1], p0[0], p0[1]);
        ctx.translate(u, v);
        ctx.rotate(((side < 0 ? -z.rot : z.rot) * Math.PI) / 180);
        ctx.scale(z.ru * CW, z.rv * CW);
        const [r, gg, b, a] = FILL[z.kind];
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        grad.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
        grad.addColorStop(0.55, `rgba(${r},${gg},${b},${a * 0.6})`);
        grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
        // 밝은 피부 위에서도 위치가 보이게 점선 테두리
        const tf = ctx.getTransform();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2, p = tf.transformPoint(new DOMPoint(Math.cos(a) * 0.8, Math.sin(a) * 0.8)); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.setLineDash([4 * lw, 4 * lw]); ctx.lineWidth = 1.3 * lw;
        ctx.strokeStyle = z.kind === 'light' ? 'rgba(255,255,255,.95)' : `rgba(${r},${gg},${b},.9)`;
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  // 다시 찍기 그림: 얼굴선 + 머리카락 · 손이 얼굴을 가린 픽셀을 붉게
  function drawRetake(f) {
    const cv = els.retakeCanvas;
    if (!f.geo) { // 얼굴을 못 찾음 → 사진만
      const s = Math.min(1, 640 / f.w);
      cv.width = Math.round(f.w * s); cv.height = Math.round(f.h * s);
      cv.getContext('2d').drawImage(f.canvas, 0, 0, cv.width, cv.height);
      return;
    }
    const { ctx, T, c, scale } = prep(cv, f);
    const poly = f.geo.oval.map(T);
    const { data: mk, w: mw, h: mh } = f.mask;
    // 얼굴선 안쪽만: 다각형을 따로 칠해 두고 그 안의 픽셀만 본다
    const inside = document.createElement('canvas'); inside.width = cv.width; inside.height = cv.height;
    const ic = inside.getContext('2d');
    ic.beginPath(); poly.forEach(([x, y], i) => (i ? ic.lineTo(x, y) : ic.moveTo(x, y))); ic.closePath(); ic.fill();
    const inA = ic.getImageData(0, 0, cv.width, cv.height).data;
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    for (let y = 0; y < cv.height; y++) {
      const iy = Math.floor(((y / scale + c.y) / f.h) * mh);
      for (let x = 0; x < cv.width; x++) {
        const j = (y * cv.width + x) * 4;
        if (inA[j + 3] < 128) continue;
        const k = mk[iy * mw + Math.floor(((x / scale + c.x) / f.w) * mw)];
        if (k === SEG.hair || k === SEG.body || k === SEG.other) {
          img.data[j] = img.data[j] * 0.45 + 235 * 0.55; img.data[j + 1] *= 0.5; img.data[j + 2] *= 0.5;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    line(ctx, [...poly, poly[0]], '#ffffff', 1.6, [5, 4]);
  }

  // ---- 복사 -------------------------------------------------------------------------
  els.remember.addEventListener('change', () => {
    if (els.remember.checked && last?.ok) { saveMemo(); toast('이 기기에 얼굴형을 기억했어요 (사진은 저장하지 않아요)'); }
    else { dropMemo(); toast('기억해 둔 얼굴형을 지웠어요'); }
    syncStyleFit();
  });
  // 궁합 판단에 대한 평가 (맞아요 / 글쎄요) — 이 기기에만 쌓고, 내보내 점수 기준을 다듬는 데 쓴다
  const votes = () => { try { return JSON.parse(localStorage.getItem(VOTE_KEY) || '[]'); } catch { return []; } };
  function updateFitExport() {
    const n = votes().length;
    els.fitExportRow.classList.toggle('hidden', !n);
    els.fitExport.textContent = `궁합 평가 ${n}개 내보내기`;
  }
  function onVote(e, which) {
    const b = e.target.closest('[data-vote]'); if (!b) return;
    const cur = currentFits[which]; if (!cur) return;
    const f = faceForFit(), fit = cur.fit;
    const row = { t: new Date().toISOString(), where: which, vote: b.dataset.vote === '1' ? 'agree' : 'disagree', shape: f?.shape?.probs?.[0]?.key, category: fit.category,
      title: fit.title, score: fit.score, reasons: fit.reasons.map((x) => [Math.round(x.pts * 10) / 10, x.text]), gender: gender || null };
    try { const list = votes(); list.push(row); localStorage.setItem(VOTE_KEY, JSON.stringify(list.slice(-500))); } catch {}
    b.parentElement.innerHTML = `<span>${row.vote === 'agree' ? '고마워요! 판단이 맞았다니 다행이에요.' : '알려 줘서 고마워요. 점수 기준을 다듬는 데 쓸게요.'}</span>`;
    updateFitExport();
  }
  els.match.addEventListener('click', (e) => onVote(e, 'face'));
  els.styleFit.addEventListener('click', (e) => onVote(e, 'style'));
  els.fitExport.addEventListener('click', () => {
    const blob = new Blob([votes().map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/jsonl' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fit-feedback-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.append(a); a.click(); a.remove();
  });
  els.shareBtn.addEventListener('click', async () => {
    if (!report || !last?.ok) return;
    els.shareBtn.disabled = true;
    try {
      const blob = await faceCard({ report: { ...report, probs: last.shape.probs }, ranked: lastRanked });
      const how = await shareImage(blob, '내-얼굴형-분석.png', '내 얼굴형 분석');
      if (how === 'downloaded') toast('공유 이미지를 저장했어요 (얼굴 사진은 넣지 않았어요)');
    } catch (e) { console.error(e); toast('공유 이미지를 만들지 못했어요'); } finally { els.shareBtn.disabled = false; }
  });
  els.copyBtn.addEventListener('click', () => {
    if (!report) return;
    const lines = [`[${purpose === 'hair' ? '내 얼굴형' : '내 얼굴 메이크업'}] ${report.headline}`, ...report.summary, '', '측정 결과'];
    for (const r of report.measures) lines.push(`- ${r.label}: ${r.value} (평균 ${r.avg}) ${r.note}`);
    lines.push('', purpose === 'hair' ? '헤어 추천' : gender === 'm' ? '그루밍 추천' : '메이크업 추천', '객관적인 얼굴 비율을 근거로 한 추천이에요. 참고만 해 주세요 — 각자의 취향과 개성을 존중합니다.');
    for (const s of purpose === 'hair' ? report.hair : report.makeup) {
      lines.push(`- ${s.title}${s.text ? `: ${s.text}` : ''}`);
      for (const i of s.list || []) lines.push(`  · ${i.name}${i.why ? ` — ${i.why}` : ''}`);
    }
    if (report.match?.score != null) lines.push('', `분석한 스타일과의 궁합: ${report.match.title} — ${report.match.verdict} (궁합 ${report.match.score}점)`, ...report.match.reasons.map((x) => `  ${x.pts > 0 ? '✓' : '△'} ${x.text}`), ...(report.match.tip ? [`  ${report.match.tip}`] : []));
    if (report.rank?.length) lines.push('', `원하는 ${purpose === 'hair' ? '헤어' : '메이크업'} 베스트 순위`, ...report.rank);
    lines.push('', '(AI 생성 · 뷰티 스타일 AI 분석 · 사진 한 장으로 잰 참고용 결과예요)');
    copy(lines.join('\n'));
  });

  setPurpose('hair');
  // 스타일 결과 카드의 공유 이미지에 넣을 궁합 (얼굴 분석을 했을 때만)
  const fitFor = (r) => (faceForFit() ? styleFit(faceForFit(), r, { gender: gender || null }) : null);
  return { styleChanged, setMode, fitFor };
}
