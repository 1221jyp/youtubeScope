// URL에서 영상 식별, 페이지에서 제목·설명 추출. 유튜브 SPA 특성을 흡수하는 계층이다.
(function (root) {
  "use strict";

  const {
    VIDEO_TITLE_META,
    VIDEO_TITLE_DOM_CANDIDATES,
    VIDEO_DESCRIPTION_META,
    VIDEO_ID_META,
  } = root.JJG_SELECTORS;

  function getVideoIdFromUrl(href) {
    try {
      const url = new URL(href);
      if (url.pathname !== "/watch") return null;
      return url.searchParams.get("v");
    } catch {
      return null;
    }
  }

  function getCurrentVideoId() {
    return getVideoIdFromUrl(location.href);
  }

  function extractTitle() {
    const meta = document.querySelector(VIDEO_TITLE_META);
    if (meta && meta.content && meta.content.trim()) return meta.content.trim();
    for (const sel of VIDEO_TITLE_DOM_CANDIDATES) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return "";
  }

  function extractDescription() {
    const meta = document.querySelector(VIDEO_DESCRIPTION_META);
    return meta && meta.content ? meta.content.trim() : "";
  }

  function getMetaVideoId() {
    const meta = document.querySelector(VIDEO_ID_META);
    return meta ? meta.content : null;
  }

  // 내비게이션 직후 meta[name="title"]이 이전 영상 값을 잠깐 들고 있는 경우가 있어서,
  // meta[itemprop="videoId"]가 목표 videoId와 일치할 때만 "신선한" 제목으로 신뢰한다.
  function waitForTitle(videoId, { retries = 15, intervalMs = 200 } = {}) {
    return new Promise((resolve) => {
      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (getCurrentVideoId() !== videoId) {
          resolve("");
          return;
        }
        const fresh = getMetaVideoId() === videoId;
        const title = extractTitle();
        if ((fresh && title) || attempts >= retries) {
          resolve(title);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  root.JJG_NAV = Object.freeze({
    getVideoIdFromUrl,
    getCurrentVideoId,
    getMetaVideoId,
    extractTitle,
    extractDescription,
    waitForTitle,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
