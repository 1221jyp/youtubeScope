// 유튜브 DOM/메타 선택자 모음
const SELECTORS = {
  // meta 태그
  VIDEO_TITLE_META: 'meta[name="title"]',
  VIDEO_DESCRIPTION_META: 'meta[name="description"]',
  VIDEO_KEYWORDS_META: 'meta[name="keywords"]',
  VIDEO_ID_META: 'meta[itemprop="videoId"]',
  CHANNEL_NAME_META: 'link[itemprop="name"]',

  // DOM 폴백 (제목)
  VIDEO_TITLE_DOM_CANDIDATES: [
    "ytd-watch-metadata h1.ytd-watch-metadata yt-formatted-string",
    "#title h1 yt-formatted-string",
    "#title h1",
    "h1.title.ytd-video-primary-info-renderer",
  ],

  // DOM 폴백 (상세 설명 - 유튜브 SPA 페이지에서 meta 태그보다 우월함)
  VIDEO_DESCRIPTION_DOM_CANDIDATES: [
    "ytd-watch-metadata #description-inline-expander",
    "#description-inline-expander yt-attributed-string",
    "#description-inline-expander",
    "ytd-watch-metadata #description",
    "#attributed-snippet-text",
    "#description yt-formatted-string",
    "#description-text",
    "ytd-expandable-video-description-body-renderer"
  ],

  // DOM 폴백 (해시태그 - #물리학, #삼체 등)
  HASHTAG_DOM_CANDIDATES: [
    "ytd-watch-metadata a[href*='/hashtag/']",
    "#description a[href*='/hashtag/']",
    "a.yt-simple-endpoint[href*='/hashtag/']",
    "yt-formatted-string.super-title a"
  ],

  // DOM 폴백 (채널명)
  CHANNEL_NAME_DOM_CANDIDATES: [
    "ytd-channel-name a",
    "#channel-name a",
    "#owner #channel-name",
    ".ytd-video-owner-renderer a"
  ],

  // 유튜브 AI 요약 및 챕터(타임스탬프) 선택자
  AI_SUMMARY_DOM_CANDIDATES: [
    "#ai-summary-content",
    "ytd-video-description-transcript-section-renderer",
    "ytd-structured-description-content-renderer",
    "ytd-macro-markers-list-item-renderer #details h3",
    "#macro-markers #title",
    "#chapters yt-formatted-string",
    "ytd-transcript-renderer"
  ],

  PLAYER_CONTAINER_CANDIDATES: ["#movie_player", "#player-container-id", "#player"],
};

if (typeof module !== "undefined") {
  module.exports = SELECTORS;
}
