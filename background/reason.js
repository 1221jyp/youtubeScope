// [파트: 이유 재판정] JUDGE_REASON 처리.
// 사용자가 낸 시청 이유를 함께 넣어 다시 판정한다. 결과는 캐시하지 않는다 (이유마다 달라짐).
//
// [정상 거절 vs API 오류]
// - 정상 거절(AI가 이유를 보고도 관련 없다고 판단): related: false, status: "success"
//   → content 쪽(reason-flow.js)에서 reasonVerdict.accepted = false 로 기록된다.
// - API 오류(타임아웃/네트워크/인증/형식 오류 등): failOpen(...)을 반환하며 status는
//   "error" 또는 "timeout". 이 경우 절대 accepted:false(=이유 거절)로 기록되면 안 되고,
//   judge-flow.js의 onSkipped 경로(action: skipped)로만 기록되어야 한다.
(function (root) {
  "use strict";

  const { AI_ERROR_CODES, AI_REQUEST_STATUS } = root.JJG_SCHEMA;
  const { getConfig, failOpen } = root.JJG_GEMINI;
  const { callVerdict } = root.JJG_VERDICT;

  async function judgeReason(message) {
    const { purpose, title, description, userReason } = message;
    try {
      const { apiKey, model } = await getConfig();
      if (!apiKey) {
        return failOpen("Gemini API 키가 설정되지 않음", AI_ERROR_CODES.API_KEY_NOT_SET);
      }
      const verdict = await callVerdict({ apiKey, model, purpose, title, description, userReason });
      return { ...verdict, status: AI_REQUEST_STATUS.SUCCESS };
    } catch (err) {
      // 여기서 던지면 sendResponse가 호출되지 않아 content script가 타임아웃까지 매달린다.
      const code = (err && err.code) || AI_ERROR_CODES.UNKNOWN;
      const reason = (err && err.message) || "판정 실패";
      console.warn("[조준경] 이유 재판정 fail-open:", code, reason, "| title:", title);
      return failOpen(reason, code);
    }
  }

  const api = Object.freeze({ judgeReason });

  root.JJG_REASON = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);