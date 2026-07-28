// [파트: 이유 재판정] JUDGE_REASON 처리.
// 사용자가 낸 시청 이유를 함께 넣어 다시 판정한다. 결과는 캐시하지 않는다 (이유마다 달라짐).
(function (root) {
  "use strict";

  const { getConfig, failOpen } = root.JJG_GEMINI;
  const { callVerdict } = root.JJG_VERDICT;

  async function judgeReason(message) {
    const { purpose, title, description, userReason } = message;
    try {
      const { apiKey, model } = await getConfig();
      if (!apiKey) return failOpen("Gemini API 키가 설정되지 않음");
      return await callVerdict({ apiKey, model, purpose, title, description, userReason });
    } catch (err) {
      // 여기서 던지면 sendResponse가 호출되지 않아 content script가 타임아웃까지 매달린다.
      const reason = (err && err.message) || "판정 실패";
      console.warn("[조준경] 이유 재판정 fail-open:", reason, "| title:", title);
      return failOpen(reason);
    }
  }

  const api = Object.freeze({ judgeReason });

  root.JJG_REASON = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
