// 조준경 content script (isolated world)
// 역할: 목적 선언 모달, URL 변화 감지, 5차원 메타데이터(제목, 설명, 해시태그, 채널명, AI요약/목차) + 자막(Transcript) 실시간 추출 및 판정 요청.

(() => {
  const STORAGE_KEYS = {
    PURPOSE: "jjg_purpose",
    SESSION_ID: "jjg_session_id",
    SESSION_LOG: "jjg_session_log",
  };

  let lastProcessedVideoId = null;
  let overlayState = null;
  let navigateDebounceTimer = null;

  // ---------- storage helpers ----------
  function isExtensionContextValid() {
    return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (data) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(data || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  async function getPurpose() {
    const data = await storageGet([STORAGE_KEYS.PURPOSE]);
    return data[STORAGE_KEYS.PURPOSE] || "";
  }

  async function startNewSession(purpose) {
    await storageSet({
      [STORAGE_KEYS.PURPOSE]: purpose,
      [STORAGE_KEYS.SESSION_ID]: Date.now(),
      [STORAGE_KEYS.SESSION_LOG]: [],
    });
  }

  async function appendLog(entry) {
    const data = await storageGet([STORAGE_KEYS.SESSION_LOG]);
    const log = data[STORAGE_KEYS.SESSION_LOG] || [];
    log.push(entry);
    await storageSet({ [STORAGE_KEYS.SESSION_LOG]: log });
  }

  // ---------- purpose modal ----------
  function showPurposeModal(prefill = "") {
    const existing = document.getElementById("jjg-purpose-modal-backdrop");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "jjg-purpose-modal-backdrop";
    backdrop.innerHTML = `
      <div id="jjg-purpose-modal">
        <h2>지금 유튜브에서 뭘 하려고 하나요?</h2>
        <p>목적을 한 줄로 적으면, 벗어난 영상을 볼 때 알려드릴게요.</p>
        <input id="jjg-purpose-input" type="text" placeholder="예) 자료구조 해시테이블 공부" maxlength="80" />
        <button id="jjg-purpose-submit" type="button">목적 설정하고 시작</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector("#jjg-purpose-input");
    const submitBtn = backdrop.querySelector("#jjg-purpose-submit");

    input.value = prefill;
    setTimeout(() => input.focus(), 100);

    const submit = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }

      if (backdrop && backdrop.parentNode) {
        backdrop.parentNode.removeChild(backdrop);
      }

      try {
        await startNewSession(value);
      } catch (err) {
        console.warn("[조준경] 목적 저장 실패:", err);
      }

      ensureChangePurposeButton();

      try {
        maybeHandleWatchPage(true);
      } catch (err) {
        console.warn("[조준경] watchPage 처리 실패:", err);
      }
    };

    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submit(e);
      }
    });
  }

  function ensureChangePurposeButton() {
    if (document.getElementById("jjg-change-purpose-btn")) return;
    const btn = document.createElement("button");
    btn.id = "jjg-change-purpose-btn";
    btn.textContent = "🎯 목적 변경";
    btn.addEventListener("click", async () => {
      const purpose = await getPurpose();
      showPurposeModal(purpose);
    });
    document.body.appendChild(btn);
  }

  // ---------- metadata & transcript extraction ----------
  function extractTitle() {
    const meta = document.querySelector(SELECTORS.VIDEO_TITLE_META);
    if (meta && meta.content && meta.content.trim()) return meta.content.trim();
    for (const sel of SELECTORS.VIDEO_TITLE_DOM_CANDIDATES) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return "";
  }

  // 영상 설명 추출 (meta 태그 + 유튜브 실제 DOM 설명 영역 전면 교차 추출)
  function extractDescription() {
    let text = "";
    
    // 1차: DOM 영역 (유튜브 SPA 페이지에서 가장 최신의 실제 설명 텍스트)
    for (const sel of (SELECTORS.VIDEO_DESCRIPTION_DOM_CANDIDATES || [])) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        const domText = el.textContent.trim();
        if (domText.length > text.length) text = domText;
      }
    }

    // 2차: meta 태그
    if (!text) {
      const meta = document.querySelector(SELECTORS.VIDEO_DESCRIPTION_META);
      if (meta && meta.content && meta.content.trim()) {
        text = meta.content.trim();
      }
    }

    return text;
  }

  // 영상 키워드 및 해시태그 (#물리학, #삼체 등) 추출
  function extractKeywords() {
    const keywords = new Set();
    
    // 1차: 메타 태그
    const meta = document.querySelector(SELECTORS.VIDEO_KEYWORDS_META);
    if (meta && meta.content) {
      meta.content.split(",").forEach(k => {
        if (k.trim()) keywords.add(k.trim());
      });
    }
    
    // 2차: DOM 영역의 해시태그 태그 (#물리학 등)
    for (const sel of (SELECTORS.HASHTAG_DOM_CANDIDATES || [])) {
      const els = document.querySelectorAll(sel);
      if (els && els.length > 0) {
        els.forEach(e => {
          const txt = e.textContent.trim();
          if (txt) keywords.add(txt);
        });
      }
    }

    return Array.from(keywords).join(", ");
  }

  function extractChannel() {
    const meta = document.querySelector(SELECTORS.CHANNEL_NAME_META);
    if (meta && meta.content && meta.content.trim()) return meta.content.trim();
    for (const sel of (SELECTORS.CHANNEL_NAME_DOM_CANDIDATES || [])) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return "";
  }

  // 유튜브 AI 요약 / 챕터 목차 / 타임스탬프 스니펫 추출
  function extractAiSummary() {
    const summaryParts = [];
    for (const sel of (SELECTORS.AI_SUMMARY_DOM_CANDIDATES || [])) {
      const els = document.querySelectorAll(sel);
      if (els && els.length > 0) {
        els.forEach(e => {
          const txt = e.textContent.trim();
          if (txt && !summaryParts.includes(txt)) summaryParts.push(txt);
        });
      }
    }
    return summaryParts.join(" ");
  }

  // 유튜브 영상 음성 자막(Transcript) 스크립트 추출
  async function extractTranscriptText(videoId) {
    try {
      // 1. window.ytInitialPlayerResponse 자막 트랙 확인
      if (typeof window !== "undefined" && window.ytInitialPlayerResponse) {
        const captionTracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (captionTracks && captionTracks.length > 0) {
          const baseUrl = captionTracks[0].baseUrl;
          if (baseUrl) {
            const res = await fetch(baseUrl);
            const xmlText = await res.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const textNodes = xmlDoc.querySelectorAll("text");
            const lines = Array.from(textNodes).map(n => n.textContent.trim()).filter(Boolean);
            if (lines.length > 0) return lines.slice(0, 300).join(" ");
          }
        }
      }

      // 2. DOM script 태그 내 captionTracks 파싱 (폴백)
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        if (script.textContent && script.textContent.includes("captionTracks")) {
          const match = script.textContent.match(/"captionTracks":\s*(\[.*?\])/);
          if (match) {
            const tracks = JSON.parse(match[1]);
            if (tracks && tracks.length > 0) {
              const baseUrl = tracks[0].baseUrl;
              if (baseUrl) {
                const res = await fetch(baseUrl);
                const xmlText = await res.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, "text/xml");
                const textNodes = xmlDoc.querySelectorAll("text");
                const lines = Array.from(textNodes).map(n => n.textContent.trim()).filter(Boolean);
                if (lines.length > 0) return lines.slice(0, 300).join(" ");
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[조준경] 자막 추출 참고:", err);
    }
    return "";
  }

  function getMetaVideoId() {
    const meta = document.querySelector(SELECTORS.VIDEO_ID_META);
    return meta ? meta.content : null;
  }

  // 유튜브 DOM 요소들이 다 그려질 때까지 대기
  function waitForTitle(videoId, { retries = 15, intervalMs = 200 } = {}) {
    return new Promise((resolve) => {
      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (getVideoIdFromUrl(location.href) !== videoId) {
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

  // ---------- player overlay ----------
  function getPlayerContainer() {
    for (const sel of SELECTORS.PLAYER_CONTAINER_CANDIDATES) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function positionOverlay(el, container) {
    const rect = container.getBoundingClientRect();
    el.style.position = "fixed";
    el.style.top = `${rect.top}px`;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }

  function pauseVideo() {
    const video = document.querySelector("video");
    if (video && !video.paused) video.pause();
  }

  function playVideo() {
    const video = document.querySelector("video");
    if (video && video.paused) video.play().catch(() => {});
  }

  function showOverlay() {
    removeOverlay();
    const container = getPlayerContainer();
    if (!container) return null;

    const el = document.createElement("div");
    el.id = "jjg-video-overlay";
    el.innerHTML = `
      <div class="jjg-box">
        <div class="jjg-spinner"></div>
        <div class="jjg-status">5차원 AI(제목·설명·채널·해시태그·AI요약) 분석 중...</div>
      </div>
    `;
    document.body.appendChild(el);
    positionOverlay(el, container);
    pauseVideo();

    const reposition = () => positionOverlay(el, container);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const ro = new ResizeObserver(reposition);
    ro.observe(container);

    overlayState = {
      el,
      cleanup: () => {
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
        ro.disconnect();
      },
    };
    return overlayState;
  }

  function removeOverlay() {
    if (overlayState) {
      overlayState.cleanup();
      overlayState.el.remove();
      overlayState = null;
    }
  }

  function setOverlayWarning(purpose, reason, onWatchAnyway, onGoBack) {
    if (!overlayState) return;
    const box = overlayState.el.querySelector(".jjg-box");
    if (!box) return;

    box.innerHTML = `
      <div class="jjg-warning-title">이거 "${escapeHtml(purpose)}"이랑 관련 있어?</div>
      <div class="jjg-warning-reason">⚠️ ${escapeHtml(reason || "목적과 무관해 보여요")}</div>
      <div class="jjg-btn-row">
        <button class="jjg-btn-leave" id="jjg-btn-go-back">🎯 돌아가기</button>
        <button class="jjg-btn-watch-anyway" id="jjg-btn-watch-anyway">그래도 볼게</button>
      </div>
    `;

    box.querySelector("#jjg-btn-go-back").addEventListener("click", onGoBack);
    box.querySelector("#jjg-btn-watch-anyway").addEventListener("click", onWatchAnyway);
  }

  function showToast(message) {
    const existing = document.getElementById("jjg-toast");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.id = "jjg-toast";
    el.textContent = message;
    document.body.appendChild(el);

    setTimeout(() => el.remove(), 4000);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- navigation / judge pipeline ----------
  function getVideoIdFromUrl(href) {
    try {
      const url = new URL(href);
      if (url.pathname !== "/watch") return null;
      return url.searchParams.get("v");
    } catch {
      return null;
    }
  }

  function sendMessageWithTimeout(message, timeoutMs = 25000) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ related: true, reason: "판정 지연", failOpen: true });
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !response) {
            resolve({ related: true, reason: "판정 실패", failOpen: true });
            return;
          }
          resolve(response);
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ related: true, reason: "판정 실패", failOpen: true });
        }
      }
    });
  }

  async function maybeHandleWatchPage(force = false) {
    const videoId = getVideoIdFromUrl(location.href);
    if (!videoId) {
      lastProcessedVideoId = null;
      removeOverlay();
      return;
    }
    if (!force && videoId === lastProcessedVideoId) return;
    lastProcessedVideoId = videoId;

    const purpose = await getPurpose();
    if (!purpose) {
      showPurposeModal();
      return;
    }

    showOverlay();
    const title = await waitForTitle(videoId);
    if (getVideoIdFromUrl(location.href) !== videoId) return;
    
    // 유튜브 DOM 요소 렌더링을 위해 짧은 대기 후 수집
    await new Promise(r => setTimeout(r, 250));

    const description = extractDescription();
    const keywords = extractKeywords();
    const channel = extractChannel();
    const aiSummary = extractAiSummary();
    const transcriptText = await extractTranscriptText(videoId);

    console.log("[조준경] 수집된 5차원 메타데이터:", {
      title,
      channel,
      keywords,
      descriptionLength: description.length,
      descriptionSnippet: description.slice(0, 100),
      aiSummaryLength: aiSummary.length,
      transcriptLength: transcriptText.length
    });

    const verdict = await sendMessageWithTimeout({
      type: "JUDGE_VIDEO",
      purpose,
      videoId,
      title,
      description,
      keywords,
      channel,
      aiSummary,
      transcriptText
    });

    if (getVideoIdFromUrl(location.href) !== videoId) return;

    if (verdict.related) {
      removeOverlay();
      playVideo();
      if (verdict.failOpen) {
        showToast(`⚠️ 판정 건너뜀 (${verdict.reason || "알 수 없는 이유"}) — 그냥 통과됨`);
      }
      await appendLog({
        videoId,
        title,
        channel,
        related: true,
        action: verdict.failOpen ? "skipped" : "watched",
        reason: verdict.failOpen ? verdict.reason : undefined,
        ts: Date.now(),
      });
    } else {
      setOverlayWarning(
        purpose,
        verdict.reason,
        async () => {
          removeOverlay();
          playVideo();
          await appendLog({
            videoId,
            title,
            channel,
            related: false,
            action: "left_anyway",
            ts: Date.now(),
          });
        },
        () => {
          if (history.length > 1) {
            history.back();
          } else {
            location.href = "https://www.youtube.com/";
          }
        }
      );
    }
  }

  function debouncedHandleWatchPage() {
    clearTimeout(navigateDebounceTimer);
    navigateDebounceTimer = setTimeout(() => maybeHandleWatchPage(false), 150);
  }

  // ---------- boot ----------
  document.addEventListener("yt-navigate-finish", debouncedHandleWatchPage);
  window.addEventListener("jjg-locationchange", debouncedHandleWatchPage);
  window.addEventListener("popstate", debouncedHandleWatchPage);

  (async () => {
    const purpose = await getPurpose();
    if (!purpose) {
      showPurposeModal();
    } else {
      ensureChangePurposeButton();
      maybeHandleWatchPage(true);
    }
  })();
})();
