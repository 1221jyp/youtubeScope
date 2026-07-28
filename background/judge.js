// [파트: 영상 판정] JUDGE_VIDEO 처리. 판정 캐시와 fail-open 정책을 담당한다.
// 판정 기준 자체는 verdict.js에 있다.
(function (root) {
  "use strict";

  const { STORAGE_KEYS } = root.JJG_SCHEMA;
  const { getConfig, failOpen } = root.JJG_GEMINI;
  const { callVerdict } = root.JJG_VERDICT;

  // 판정 기준이나 프롬프트를 바꾸면 이 값을 올려서 과거 캐시를 무효화한다.
  const CACHE_VERSION = "v4";

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
      if (cache[key]) return cache[key];

      const { apiKey, model } = await getConfig();
      if (!apiKey) return failOpen("Gemini API 키가 설정되지 않음");

      let verdict;
      try {
        verdict = await callVerdict({ apiKey, model, purpose, title, description });
      } catch (err) {
        const reason = (err && err.message) || "판정 실패";
        console.warn("[조준경] fail-open:", reason, "| title:", title);
        return failOpen(reason);
      }

      // fail-open 결과는 캐시하지 않는다. 장애가 끝나면 다시 판정해야 한다.
      const updatedCache = await getCache();
      updatedCache[key] = verdict;
      await setCache(updatedCache);
      return verdict;
    } catch (err) {
      return failOpen("알 수 없는 오류");
    }
  }

  const api = Object.freeze({ CACHE_VERSION, cacheKeyFor, judgeVideo });

  root.JJG_JUDGE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
