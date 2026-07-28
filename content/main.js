// 조준경 content script 진입점 (isolated world).
// 역할: 내비게이션 이벤트 배선과 최초 부팅만. 실제 처리는 기능별 모듈에 있다.
(function (root) {
  "use strict";

  const { handleWatchPage } = root.JJG_JUDGE_FLOW;
  const { getPurpose, showPurposeModal, ensureChangePurposeButton } = root.JJG_SESSION;

  const NAVIGATE_DEBOUNCE_MS = 150;
  let navigateDebounceTimer = null;

  // 유튜브는 한 번의 이동에 여러 이벤트를 흘리므로 짧게 묶어서 한 번만 처리한다.
  function onNavigate() {
    clearTimeout(navigateDebounceTimer);
    navigateDebounceTimer = setTimeout(() => handleWatchPage(false), NAVIGATE_DEBOUNCE_MS);
  }

  document.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("jjg-locationchange", onNavigate); // history-hook.js가 보내는 이벤트
  window.addEventListener("popstate", onNavigate);

  (async () => {
    const purpose = await getPurpose();
    if (!purpose) {
      showPurposeModal();
      return;
    }
    ensureChangePurposeButton();
    handleWatchPage(true);
  })();
})(typeof globalThis !== "undefined" ? globalThis : this);
