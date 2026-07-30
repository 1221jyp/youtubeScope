// 유튜브 DOM/메타 선택자를 한 곳에 모아둔다. 유튜브가 클래스명을 바꿔도 여기만 고치면 된다.
(function (root) {
  "use strict";

  const SELECTORS = Object.freeze({
    // meta 태그는 SEO 목적이라 클래스명보다 훨씬 안 바뀐다. 우선 사용.
    VIDEO_TITLE_META: 'meta[name="title"]',
    VIDEO_DESCRIPTION_META: 'meta[name="description"]',
    VIDEO_ID_META: 'meta[itemprop="videoId"]',

    // meta 태그가 아직 안 갱신됐을 때의 DOM 폴백 (여러 후보를 순서대로 시도)
    VIDEO_TITLE_DOM_CANDIDATES: [
      "ytd-watch-metadata h1.ytd-watch-metadata yt-formatted-string",
      "#title h1 yt-formatted-string",
      "#title h1",
      "h1.title.ytd-video-primary-info-renderer",
    ],

    // 오버레이를 씌울 플레이어 컨테이너 (오래된 안정적 id)
    PLAYER_CONTAINER_CANDIDATES: ["#movie_player", "#player-container-id", "#player"],

    // 쇼츠 재생 페이지 URL 경로 접두사
    SHORTS_URL_PATH_PREFIX: "/shorts/",

    // 쇼츠로 이동하는 링크를 포함한 UI를 통째로 숨긴다. 클래스명이 아니라 링크(href)
    // 기준이라 유튜브가 마크업을 바꿔도 비교적 안 깨진다.
    SHORTS_UI_HIDE_SELECTORS: [
      'ytd-guide-entry-renderer:has(a[href="/shorts"])', // 왼쪽 사이드바 "Shorts" 메뉴
      'ytd-mini-guide-entry-renderer:has(a[href="/shorts"])', // 접힌 사이드바
      'ytd-rich-shelf-renderer:has(a[href^="/shorts/"])', // 홈 피드 쇼츠 선반
      "ytd-reel-shelf-renderer", // 검색 결과·시청 페이지 쇼츠 선반
      'ytd-rich-item-renderer:has(a[href^="/shorts/"])', // 홈 그리드에 낱개로 섞인 쇼츠
      'ytd-video-renderer:has(a[href^="/shorts/"])', // 검색 결과에 낱개로 섞인 쇼츠
      'ytd-compact-video-renderer:has(a[href^="/shorts/"])', // 관련 영상 목록의 쇼츠
    ],
  });

  root.JJG_SELECTORS = SELECTORS;
  if (typeof module !== "undefined" && module.exports) module.exports = SELECTORS;
})(typeof globalThis !== "undefined" ? globalThis : this);
