// 기기 성격 — 휴대폰처럼 메모리가 빠듯한 기기에서는 모델 작업 메모리를 아끼고 사진을 조금 더 작게 다룬다
//   LOW_MEM: iPhone · iPad · Android, 또는 메모리 4GB 이하로 보고되는 기기, 또는 터치 위주의 작은 화면. ?lowmem=1 / ?lowmem=0 으로 강제
export const LOW_MEM = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lowmem');
    if (q === '1') return true; if (q === '0') return false;
    const ua = navigator.userAgent || '';
    const mobileUA = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS 는 Mac 처럼 보인다
    const smallMem = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4;
    const touchSmall = matchMedia('(pointer: coarse)').matches && !matchMedia('(min-width: 1024px)').matches;
    return !!(mobileUA || smallMem || touchSmall);
  } catch { return false; }
})();
