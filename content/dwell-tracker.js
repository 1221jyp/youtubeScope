// [파트: 영상 페이지 체류시간·이동 원인]
// 실제 재생시간이 아니라 /watch 페이지 진입부터 이탈까지의 벽시계 체류시간만 기록한다.
(function (root) {
  "use strict";

  const {
    SESSION_STATUS,
    NAVIGATION_SOURCES,
    TIME_MEASUREMENTS,
  } = root.JJG_SCHEMA;

  const CHECKPOINT_INTERVAL_MS = 10000;

  function videoIdFromHref(href, baseHref = "https://www.youtube.com/") {
    try {
      const url = new URL(href, baseHref);
      if (url.pathname === "/watch") return url.searchParams.get("v") || "";
      if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] || "";
    } catch {
      // 잘못된 링크는 이동 원인을 추측하지 않는다.
    }
    return "";
  }

  function closestMatches(element, selectors) {
    if (!element || typeof element.closest !== "function") return false;
    return selectors.some((selector) => Boolean(element.closest(selector)));
  }

  function classifyNavigationSource({ currentPath = "", currentHref = "", targetHref = "", linkElement = null } = {}) {
    let target;
    try {
      target = new URL(targetHref, currentHref || "https://www.youtube.com/");
    } catch {
      return NAVIGATION_SOURCES.UNKNOWN;
    }
    if (!videoIdFromHref(target.href, currentHref)) return NAVIGATION_SOURCES.UNKNOWN;
    if (target.pathname.startsWith("/shorts/") || currentPath.startsWith("/shorts/")) {
      return NAVIGATION_SOURCES.SHORTS;
    }
    if (
      target.searchParams.has("list") ||
      closestMatches(linkElement, [
        "ytd-playlist-panel-video-renderer",
        "ytd-playlist-video-renderer",
        "ytd-playlist-renderer",
        "[data-playlist-id]",
      ])
    ) {
      return NAVIGATION_SOURCES.PLAYLIST;
    }
    if (currentPath === "/results") return NAVIGATION_SOURCES.SEARCH;
    if (currentPath === "/feed/subscriptions") return NAVIGATION_SOURCES.SUBSCRIPTIONS;
    if (currentPath === "/feed/history") return NAVIGATION_SOURCES.HISTORY;
    if (currentPath === "/") return NAVIGATION_SOURCES.HOME;
    if (
      currentPath === "/watch" ||
      closestMatches(linkElement, [
        "ytd-compact-video-renderer",
        "ytd-watch-next-secondary-results-renderer",
        "#related",
      ])
    ) {
      return NAVIGATION_SOURCES.RECOMMENDATION;
    }
    return NAVIGATION_SOURCES.UNKNOWN;
  }

  function initialNavigationSource(referrer, currentHref) {
    if (!referrer) return NAVIGATION_SOURCES.DIRECT;
    try {
      const referrerUrl = new URL(referrer);
      const currentUrl = new URL(currentHref);
      return referrerUrl.origin === currentUrl.origin
        ? NAVIGATION_SOURCES.UNKNOWN
        : NAVIGATION_SOURCES.EXTERNAL;
    } catch {
      return NAVIGATION_SOURCES.UNKNOWN;
    }
  }

  function createDwellTracker(dependencies = {}) {
    const now = dependencies.now || (() => Date.now());
    const setIntervalFn = dependencies.setInterval || ((fn, ms) => setInterval(fn, ms));
    const clearIntervalFn = dependencies.clearInterval || ((id) => clearInterval(id));
    const getSession = dependencies.getSession || (() => root.JJG_SESSION.getSession());
    const updateById = dependencies.updateLogEntryById ||
      ((entryId, changes) => root.JJG_LOG.updateLogEntryById(entryId, changes));
    const currentVideoId = dependencies.getCurrentVideoId || (() => root.JJG_NAV.getCurrentVideoId());
    const currentHref = dependencies.getCurrentHref || (() => location.href);
    const currentPath = dependencies.getCurrentPath || (() => location.pathname);
    const referrer = dependencies.getReferrer || (() => document.referrer || "");
    const randomId = dependencies.randomId || (() => {
      try {
        return root.crypto?.randomUUID?.() || "";
      } catch {
        return "";
      }
    });

    let active = null;
    let previous = null;
    let pendingNavigation = null;
    let intervalId = null;
    let sequence = 0;

    function makeEntryId(sessionId, enteredAt, videoId) {
      sequence += 1;
      const suffix = randomId() || String(sequence);
      return `${sessionId}:${enteredAt}:${videoId}:${suffix}`;
    }

    function stopInterval() {
      if (intervalId == null) return;
      clearIntervalFn(intervalId);
      intervalId = null;
    }

    function ensureInterval() {
      if (intervalId != null || !active) return;
      intervalId = setIntervalFn(
        () => checkpoint().catch((error) => console.warn("[조준경] 체류시간 중간 저장 실패:", error)),
        CHECKPOINT_INTERVAL_MS
      );
    }

    async function writeTime(entry, leftAt) {
      const safeLeftAt = Math.max(entry.enteredAt, Number(leftAt));
      return updateById(entry.entryId, {
        leftAt: safeLeftAt,
        dwellMs: Math.max(0, safeLeftAt - entry.enteredAt),
        timeMeasurement: TIME_MEASUREMENTS.MEASURED,
      });
    }

    async function checkpoint() {
      if (!active) return false;
      const session = await getSession();
      if (session.status !== SESSION_STATUS.ACTIVE || session.sessionId !== active.sessionId) {
        await finalizeCurrent(now());
        return false;
      }
      return writeTime(active, now());
    }

    async function finalizeCurrent(leftAt = now()) {
      if (!active) {
        stopInterval();
        return false;
      }
      const ending = active;
      active = null;
      stopInterval();
      const updated = await writeTime(ending, leftAt);
      // 실제 로그가 존재해 갱신된 방문만 다음 로그의 fromEntryId 근거로 사용한다.
      previous = updated ? ending : null;
      return updated;
    }

    function navigationForNewEntry(videoId) {
      let source;
      const capturedNavigation = pendingNavigation;
      pendingNavigation = null;
      if (
        capturedNavigation &&
        (!capturedNavigation.targetVideoId || capturedNavigation.targetVideoId === videoId)
      ) {
        source = capturedNavigation.source;
      } else if (!previous) {
        source = initialNavigationSource(referrer(), currentHref());
      } else {
        source = NAVIGATION_SOURCES.UNKNOWN;
      }
      const linked = previous || {};
      return {
        source,
        fromEntryId: linked.entryId || "",
        fromVideoId: linked.videoId || "",
        fromTitle: linked.title || "",
      };
    }

    async function handleLocationChange() {
      const session = await getSession();
      const videoId = currentVideoId() || "";
      const changedSession = active && active.sessionId !== session.sessionId;
      const changedVideo = active && active.videoId !== videoId;
      if (active && (changedSession || changedVideo || session.status !== SESSION_STATUS.ACTIVE)) {
        await finalizeCurrent(now());
      }
      if (session.status !== SESSION_STATUS.ACTIVE || !videoId) {
        stopInterval();
        if (changedSession) previous = null;
        return null;
      }
      if (!active) {
        if (previous && previous.sessionId !== session.sessionId) previous = null;
        const enteredAt = now();
        active = {
          entryId: makeEntryId(session.sessionId, enteredAt, videoId),
          sessionId: session.sessionId,
          videoId,
          title: "",
          enteredAt,
          navigation: navigationForNewEntry(videoId),
        };
      }
      ensureInterval();
      return active;
    }

    async function getEntryContext(videoId, title) {
      if (!active || active.videoId !== videoId) await handleLocationChange();
      if (!active || active.videoId !== videoId) return null;
      if (title) active.title = String(title);
      return {
        entryId: active.entryId,
        sessionId: active.sessionId,
        enteredAt: active.enteredAt,
        leftAt: null,
        dwellMs: null,
        timeMeasurement: TIME_MEASUREMENTS.UNKNOWN,
        navigation: { ...active.navigation },
      };
    }

    function captureLinkClick(event) {
      const link = event?.target?.closest?.("a[href]");
      if (!link) return;
      const href = link.href || link.getAttribute?.("href") || "";
      const targetVideoId = videoIdFromHref(href, currentHref());
      if (!targetVideoId) return;
      pendingNavigation = {
        targetVideoId,
        source: classifyNavigationSource({
          currentPath: currentPath(),
          currentHref: currentHref(),
          targetHref: href,
          linkElement: link,
        }),
      };
    }

    async function resetForSession(sessionId) {
      if (active && active.sessionId !== sessionId) await finalizeCurrent(now());
      active = null;
      previous = null;
      pendingNavigation = null;
      stopInterval();
    }

    function getState() {
      return {
        active: active ? { ...active, navigation: { ...active.navigation } } : null,
        previous: previous ? { ...previous, navigation: { ...previous.navigation } } : null,
        intervalActive: intervalId != null,
      };
    }

    return Object.freeze({
      captureLinkClick,
      handleLocationChange,
      getEntryContext,
      checkpoint,
      finalizeCurrent,
      resetForSession,
      getState,
    });
  }

  const tracker = createDwellTracker();
  root.JJG_DWELL_TRACKER = Object.freeze({
    CHECKPOINT_INTERVAL_MS,
    videoIdFromHref,
    classifyNavigationSource,
    initialNavigationSource,
    createDwellTracker,
    ...tracker,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
