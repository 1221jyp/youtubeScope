// 유튜브 DOM/메타 선택자를 한 곳에 모아둔다. 유튜브가 클래스명을 바꿔도 여기만 고치면 된다.
const SELECTORS = {
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
};

if (typeof module !== "undefined") {
  module.exports = SELECTORS;
}
