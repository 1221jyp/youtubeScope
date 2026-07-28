// chrome.storage.local 접근을 한 곳에 모은다.
// 확장을 재로드하면 이미 열려있던 탭의 content script는 컨텍스트가 무효화된다.
// 그 상태에서 chrome.storage 호출은 예외를 던지므로 조용히 무시한다 (탭을 새로고침하면 해결됨).
(function (root) {
  "use strict";

  function isExtensionContextValid() {
    return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  }

  function get(keys) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (data) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(data || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  function set(values) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.set(values, () => resolve(!chrome.runtime.lastError));
      } catch {
        resolve(false);
      }
    });
  }

  const api = Object.freeze({ isExtensionContextValid, get, set });

  root.JJG_STORAGE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
