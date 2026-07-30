// [파트: 쇼츠 차단] 몰입 세션(active) 동안 쇼츠 재생과 쇼츠 관련 UI를 전부 차단한다.
// 몰입 상태가 아니면 아무 것도 하지 않는다 (판정 로직과 같은 기준: session.isFocusing()).
//
// 쇼츠는 진입하자마자 자동재생을 시작하기 때문에, 매번 storage를 비동기로 읽어 몰입
// 여부를 확인하면 그 사이에 이미 재생돼버린다. 그래서 몰입 여부를 메모리에 캐시해두고
// (초기 로드 + storage.onChanged로 갱신), 쇼츠 URL을 감지하면 캐시만 보고 동기적으로
// 즉시 되감는다(뒤로가기).
(function (root) {
  "use strict";

  const { STORAGE_KEYS } = root.JJG_SCHEMA;
  const { SHORTS_URL_PATH_PREFIX, SHORTS_UI_HIDE_SELECTORS } = root.JJG_SELECTORS;
  const { isFocusing } = root.JJG_SESSION;

  const UI_SYNC_DEBOUNCE_MS = 150;
  let uiObserver = null;
  let syncDebounceTimer = null;
  let cachedFocusing = false;

  function isShortsUrl(href) {
    try {
      return new URL(href).pathname.startsWith(SHORTS_URL_PATH_PREFIX);
    } catch {
      return false;
    }
  }

  async function refreshFocusingCache() {
    cachedFocusing = await isFocusing();
  }

  // 초기 로드 시 한 번 채워두고, 이후엔 세션 상태가 바뀌는 지점(storage.onChanged)에서만 갱신한다.
  refreshFocusingCache();
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.SESSION_STATUS]) return;
      refreshFocusingCache();
    });
  }

  function pauseAllVideos() {
    document.body.querySelectorAll("video").forEach((video) => {
      if (!video.paused) video.pause();
    });
  }

  // 뒤로 간다. history 전체가 쇼츠 피드 안 이동 기록뿐이면 back()이 더 이상 URL을
  // 바꾸지 못하고 멈출 수 있어서, 잠시 후에도 여전히 쇼츠면 홈으로 강제 이동한다.
  function leaveShorts() {
    pauseAllVideos();
    if (history.length <= 1) {
      location.href = "https://www.youtube.com/";
      return;
    }
    const before = location.href;
    history.back();
    setTimeout(() => {
      pauseAllVideos();
      if (location.href === before && isShortsUrl(location.href)) {
        location.href = "https://www.youtube.com/";
      }
    }, 250);
  }

  // 몰입 중에 쇼츠 재생 페이지로 들어오면 캐시된 몰입 상태만 보고 동기적으로 즉시 차단한다.
  // 차단했으면 true를 반환해서 호출한 쪽(main.js)이 이어지는 영상 판정을 건너뛰게 한다.
  function blockShortsIfNeeded() {
    if (!isShortsUrl(location.href)) return false;
    if (!cachedFocusing) return false;
    leaveShorts();
    return true;
  }

  function hideShortsUi() {
    for (const sel of SHORTS_UI_HIDE_SELECTORS) {
      document.body.querySelectorAll(sel).forEach((el) => {
        el.style.display = "none";
      });
    }
  }

  function unhideShortsUi() {
    for (const sel of SHORTS_UI_HIDE_SELECTORS) {
      document.body.querySelectorAll(sel).forEach((el) => {
        el.style.display = "";
      });
    }
  }

  function startHidingUi() {
    hideShortsUi();
    if (uiObserver) return;
    uiObserver = new MutationObserver(() => {
      clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(hideShortsUi, UI_SYNC_DEBOUNCE_MS);
    });
    uiObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopHidingUi() {
    if (uiObserver) {
      uiObserver.disconnect();
      uiObserver = null;
    }
    clearTimeout(syncDebounceTimer);
    unhideShortsUi();
  }

  // 몰입 중이면 쇼츠 UI를 숨기고 계속 감시, 아니면 원래대로 되돌린다.
  // 세션 상태가 바뀔 수 있는 지점(내비게이션, storage.onChanged)마다 호출한다.
  async function syncShortsUiVisibility() {
    if (await isFocusing()) {
      startHidingUi();
    } else {
      stopHidingUi();
    }
  }

  root.JJG_SHORTS_BLOCK = Object.freeze({
    isShortsUrl,
    blockShortsIfNeeded,
    syncShortsUiVisibility,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
