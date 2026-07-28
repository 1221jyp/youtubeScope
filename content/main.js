// 조준경 content script 진입점 (isolated world).
// 역할: 내비게이션 이벤트 배선과 최초 부팅만. 실제 처리는 기능별 모듈에 있다.
(function (root) {
  "use strict";

  const { STORAGE_KEYS } = root.JJG_SCHEMA;
  const { handleWatchPage } = root.JJG_JUDGE_FLOW;
  const { getSession, renderSessionBar, showPurposeModal } = root.JJG_SESSION;

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

  // 유튜브 탭이 여러 개일 때 한 곳에서 세션을 끝내면 나머지 탭도 기본 상태로 바뀌어야 한다.
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.SESSION_STATUS]) return;
      renderSessionBar();
    });
  }

  (async () => {
    const session = await getSession();
    await renderSessionBar();
    // 세션을 시작한 적이 없으면 목적 선언 모달을 띄운다. 닫으면 기본 상태로 남는다.
    if (!session.purpose) {
      showPurposeModal();
      return;
    }
    handleWatchPage(true);
  })();
})(typeof globalThis !== "undefined" ? globalThis : this);
