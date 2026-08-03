// 조준경 content script 진입점 (isolated world).
// 역할: 내비게이션 이벤트 배선과 최초 부팅만. 실제 처리는 기능별 모듈에 있다.
(function (root) {
  "use strict";

  const { STORAGE_KEYS, SESSION_STATUS } = root.JJG_SCHEMA;
  const { handleWatchPage } = root.JJG_JUDGE_FLOW;
  const { getSession, renderSessionBar, showPurposeModal } = root.JJG_SESSION;
  const { syncShortsUiVisibility, blockShortsIfNeeded } = root.JJG_SHORTS_BLOCK;
  const dwellTracker = root.JJG_DWELL_TRACKER;

  const NAVIGATE_DEBOUNCE_MS = 150;
  let navigateDebounceTimer = null;

  // 유튜브는 한 번의 이동에 여러 이벤트를 흘리므로 짧게 묶어서 한 번만 처리한다.
  function onNavigate() {
    dwellTracker.handleLocationChange();
    // 쇼츠는 진입 즉시 자동재생되므로 디바운스를 거치지 않고 그 자리에서 바로 판단한다.
    // (blockShortsIfNeeded는 캐시된 몰입 상태만 보고 동기적으로 되감는다)
    if (blockShortsIfNeeded()) return;
    clearTimeout(navigateDebounceTimer);
    navigateDebounceTimer = setTimeout(async () => {
      await syncShortsUiVisibility();
      handleWatchPage(false);
    }, NAVIGATE_DEBOUNCE_MS);
  }

  document.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("jjg-locationchange", onNavigate); // history-hook.js가 보내는 이벤트
  window.addEventListener("popstate", onNavigate);

  // 유튜브 탭이 여러 개일 때 한 곳에서 세션을 끝내면 나머지 탭도 기본 상태로 바뀌어야 한다.
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.SESSION_STATUS]) return;
      if (
        changes[STORAGE_KEYS.SESSION_STATUS].newValue === SESSION_STATUS.ENDING ||
        changes[STORAGE_KEYS.SESSION_STATUS].newValue === SESSION_STATUS.ENDED
      ) {
        dwellTracker.finalizeCurrent();
      }
      renderSessionBar();
      syncShortsUiVisibility();
    });
  }

  (async () => {
    document.addEventListener("click", dwellTracker.captureLinkClick, true);
    window.addEventListener("pagehide", () => dwellTracker.finalizeCurrent());
    window.addEventListener("beforeunload", () => dwellTracker.finalizeCurrent());
    // 페이지가 쇼츠로 바로 열렸을 수도 있으니 부팅 시에도 먼저 확인한다.
    // (JJG_SHORTS_BLOCK의 몰입 상태 캐시가 아직 초기화 중일 수 있어 여기서는 getSession()으로 직접 판단한다)
    const session = await getSession();
    await dwellTracker.handleLocationChange();
    await renderSessionBar();
    await syncShortsUiVisibility();
    if (session.status === SESSION_STATUS.ACTIVE && root.JJG_SHORTS_BLOCK.isShortsUrl(location.href)) {
      if (history.length > 1) {
        history.back();
      } else {
        location.href = "https://www.youtube.com/";
      }
      return;
    }
    // 세션을 시작한 적이 없으면 목적 선언 모달을 띄운다. 닫으면 기본 상태로 남는다.
    if (!session.purpose) {
      showPurposeModal();
      return;
    }
    handleWatchPage(true);
  })();
})(typeof globalThis !== "undefined" ? globalThis : this);
