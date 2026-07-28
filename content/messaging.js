// background와의 통신. 어떤 실패도 사용자를 막지 않도록 fail-open 판정으로 흡수한다.
(function (root) {
  "use strict";

  // background.js의 Gemini 요청 타임아웃(60초)보다 넉넉히 길게 잡아서,
  // 배경 쪽이 구체적인 실패 사유를 만들어낼 시간을 준다.
  const DEFAULT_TIMEOUT_MS = 65000;

  function failOpen(reason) {
    return { related: true, reason, failOpen: true };
  }

  function sendMessageWithTimeout(message, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(failOpen("판정 지연"));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !response) {
            resolve(failOpen("판정 실패"));
            return;
          }
          resolve(response);
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(failOpen("판정 실패"));
        }
      }
    });
  }

  root.JJG_MESSAGING = Object.freeze({ DEFAULT_TIMEOUT_MS, sendMessageWithTimeout });
})(typeof globalThis !== "undefined" ? globalThis : this);
