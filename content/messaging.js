// background와의 통신. 어떤 실패도 사용자를 막지 않도록 fail-open 판정으로 흡수한다.
//
// [상태 구분]
// background가 정상 응답한 경우 status(success/error/timeout)는 background(judge.js/reason.js)가
// 채워서 보낸 값을 그대로 쓴다. 여기서 만드는 failOpen()은 "메시지 전달 자체"가 실패한 경우
// (확장 리로드, 채널 끊김 등)에만 쓰이며, errorCode를 "message_failed"/"message_timeout"으로
// 구분해서 Gemini API 자체 오류(auth_error, rate_limit 등)와 섞이지 않게 한다.
(function (root) {
  "use strict";

  // background.js의 Gemini 요청 타임아웃(60초)보다 넉넉히 길게 잡아서,
  // 배경 쪽이 구체적인 실패 사유를 만들어낼 시간을 준다.
  const DEFAULT_TIMEOUT_MS = 65000;

  function failOpen(reason, status = "error", code = "message_failed") {
    return { related: true, reason, failOpen: true, status, errorCode: code };
  }

  function sendMessageWithTimeout(message, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // background가 제 시간 안에 응답을 못 준 경우: 명확히 timeout으로 구분한다.
        resolve(failOpen("판정 지연", "timeout", "message_timeout"));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !response) {
            resolve(failOpen("판정 실패", "error", "message_failed"));
            return;
          }
          resolve(response);
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(failOpen("판정 실패", "error", "message_failed"));
        }
      }
    });
  }

  root.JJG_MESSAGING = Object.freeze({ DEFAULT_TIMEOUT_MS, sendMessageWithTimeout });
})(typeof globalThis !== "undefined" ? globalThis : this);