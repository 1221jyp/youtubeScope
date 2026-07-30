// [파트: 영상 판정] JUDGE_VIDEO 처리. 판정 캐시와 fail-open 정책을 담당한다.
// 판정 기준 자체는 verdict.js에 있다.
//
// [상태 구분]
// 모든 응답에 status가 붙는다.
// - 캐시 히트 또는 정상 판정 성공 → status: "success"
// - API 키 없음/인증 실패/한도 초과/네트워크 실패/응답 형식 오류 → status: "error"
// - 타임아웃 → status: "timeout"
// error/timeout은 항상 failOpen: true와 함께 오며, 이는 "AI가 관련없다고 정상 거절한 것"과
// 절대 같은 의미가 아니다. 캐시에도 저장하지 않는다 (장애가 끝나면 다시 판정해야 하므로).
(function (root) {
  "use strict";

  const { STORAGE_KEYS, AI_ERROR_CODES, AI_REQUEST_STATUS } = root.JJG_SCHEMA;
  const { getConfig, failOpen } = root.JJG_GEMINI;
  const { callVerdict } = root.JJG_VERDICT;

  // 판정 기준이나 프롬프트를 바꾸면 이 값을 올려서 과거 캐시를 무효화한다.
  const CACHE_VERSION = "v5";

  async function getCache() {
    const data = await root.JJG_STORAGE.get([STORAGE_KEYS.VERDICT_CACHE]);
    return data[STORAGE_KEYS.VERDICT_CACHE] || {};
  }

  async function setCache(cache) {
    await root.JJG_STORAGE.set({ [STORAGE_KEYS.VERDICT_CACHE]: cache });
  }

  function cacheKeyFor(purpose, videoId) {
    return `${CACHE_VERSION}||${purpose}||${videoId}`;
  }

  async function judgeVideo(message) {
    const { purpose, videoId, title, description } = message;
    const key = cacheKeyFor(purpose, videoId);

    try {
      const cache = await getCache();
      if (cache[key]) {
        return { ...cache[key], status: AI_REQUEST_STATUS.SUCCESS, cached: true };
      }

      const { apiKey, model } = await getConfig();
      if (!apiKey) {
        return failOpen("Gemini API 키가 설정되지 않음", AI_ERROR_CODES.API_KEY_NOT_SET);
      }

      const storageData = await root.JJG_STORAGE.get([STORAGE_KEYS.GOAL_PROFILE]);
      const goalProfile = storageData[STORAGE_KEYS.GOAL_PROFILE] || null;

      let verdict;
      try {
        verdict = await callVerdict({ apiKey, model, purpose, goalProfile, title, description });
      } catch (err) {
        const code = (err && err.code) || AI_ERROR_CODES.UNKNOWN;
        const reason = (err && err.message) || "판정 실패";
        console.warn("[조준경] fail-open:", code, reason, "| title:", title);
        return failOpen(reason, code);
      }

      const finalVerdict = { ...verdict, status: AI_REQUEST_STATUS.SUCCESS };

      // fail-open 결과는 캐시하지 않는다. 장애가 끝나면 다시 판정해야 한다.
      const updatedCache = await getCache();
      updatedCache[key] = finalVerdict;
      await setCache(updatedCache);
      return finalVerdict;
    } catch (err) {
      return failOpen("알 수 없는 오류", AI_ERROR_CODES.UNKNOWN);
    }
  }

  const api = Object.freeze({ CACHE_VERSION, cacheKeyFor, judgeVideo });

  root.JJG_JUDGE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);