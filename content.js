// 조준경 content script (isolated world)
// 역할: 목적 선언 모달, URL 변화 감지, 영상 판정 요청, 오버레이 표시, 이탈 체인 기록.

(() => {
  const STORAGE_KEYS = {
    PURPOSE: "jjg_purpose",
    SESSION_ID: "jjg_session_id",
    SESSION_LOG: "jjg_session_log",
    SESSION_REPORT: "jjg_session_report",
  };

  let lastProcessedVideoId = null;
  let overlayState = null; // { el, container, cleanup }
  let navigateDebounceTimer = null;

  // ---------- storage helpers ----------
  // 확장을 재로드하면 이미 열려있던 탭의 content script는 컨텍스트가 무효화된다.
  // 그 상태에서 chrome.storage 호출은 예외를 던지므로 조용히 무시한다 (탭을 새로고침하면 해결됨).
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
      [STORAGE_KEYS.SESSION_REPORT]: null,
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
    if (document.getElementById("jjg-purpose-modal-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "jjg-purpose-modal-backdrop";
    backdrop.innerHTML = `
      <div id="jjg-purpose-modal">
        <h2>지금 유튜브에서 뭘 하려고 하나요?</h2>
        <p>목적을 한 줄로 적으면, 벗어난 영상을 볼 때 알려드릴게요.</p>
        <input id="jjg-purpose-input" type="text" placeholder="예) 자료구조 해시테이블 공부" maxlength="80" />
        <button id="jjg-purpose-submit">목적 설정하고 시작</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector("#jjg-purpose-input");
    input.value = prefill;
    input.focus();

    const submit = async () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      await startNewSession(value);
      backdrop.remove();
      ensureChangePurposeButton();
      // 목적을 새로 설정한 시점에 현재 페이지가 /watch면 즉시 재판정
      maybeHandleWatchPage(true);
    };

    backdrop.querySelector("#jjg-purpose-submit").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
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

  // ---------- title/description extraction ----------
  function extractTitle() {
    const meta = document.querySelector(SELECTORS.VIDEO_TITLE_META);
    if (meta && meta.content && meta.content.trim()) return meta.content.trim();
    for (const sel of SELECTORS.VIDEO_TITLE_DOM_CANDIDATES) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return "";
  }

  function extractDescription() {
    const meta = document.querySelector(SELECTORS.VIDEO_DESCRIPTION_META);
    return meta && meta.content ? meta.content.trim() : "";
  }

  function getMetaVideoId() {
    const meta = document.querySelector(SELECTORS.VIDEO_ID_META);
    return meta ? meta.content : null;
  }

  // 내비게이션 직후 meta[name="title"]이 이전 영상 값을 잠깐 들고 있는 경우가 있어서,
  // meta[itemprop="videoId"]가 목표 videoId와 일치할 때만 "신선한" 제목으로 신뢰한다.
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
        <div class="jjg-status">목적과 관련 있는 영상인지 확인 중...</div>
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
    overlayState.el.innerHTML = `
      <div class="jjg-box">
        <div class="jjg-warning-title">이거 "${escapeHtml(purpose)}"이랑 관련 있어?</div>
        <div class="jjg-warning-reason">${escapeHtml(reason || "목적과 무관해 보여요")}</div>
        <div class="jjg-btn-row">
          <button class="jjg-btn-leave" id="jjg-btn-go-back">돌아가기</button>
          <textarea id="jjg-user-reason" placeholder="왜 이 영상을 봐야 하는지 입력하세요." style="width:100%;height:70px;margin:12px 0;"></textarea><button class="jjg-btn-watch-anyway" id="jjg-btn-watch-anyway">AI에게 제출</button>
        </div>
      </div>
    `;
    overlayState.el.querySelector("#jjg-btn-go-back").addEventListener("click", onGoBack);
    overlayState.el.querySelector("#jjg-btn-watch-anyway").addEventListener("click", async ()=>{
const reason=overlayState.el.querySelector("#jjg-user-reason").value.trim();
if(!reason){alert("이유를 입력해주세요.");return;}
const result=await sendMessageWithTimeout({type:"JUDGE_REASON",purpose,title:extractTitle(),description:extractDescription(),userReason:reason});
if(result.related){onWatchAnyway();}else{alert("AI가 이유까지 고려해도 관련 없는 영상으로 판단했습니다.");}
});
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

  // background.js의 Ollama 요청 타임아웃(60초)보다 넉넉히 길게 잡아서,
  // 배경 쪽이 구체적인 실패 사유를 만들어낼 시간을 준다.
  function sendMessageWithTimeout(message, timeoutMs = 65000) {
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
    // 대기 중 다른 영상으로 또 넘어갔으면 이 판정은 버린다.
    if (getVideoIdFromUrl(location.href) !== videoId) return;
    const description = extractDescription();

    const verdict = await sendMessageWithTimeout({
      type: "JUDGE_VIDEO",
      purpose,
      videoId,
      title,
      description,
    });

    if (getVideoIdFromUrl(location.href) !== videoId) return; // 판정 도중 페이지 이동

    if (verdict.related) {
      removeOverlay();
      playVideo();
      if (verdict.failOpen) {
        showToast(`⚠️ 판정 건너뜀 (${verdict.reason || "알 수 없는 이유"}) — 그냥 통과됨`);
      }
      await appendLog({
        videoId,
        title,
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
            related: false,
            action: "left_anyway",
            reason: verdict.reason,
            ts: Date.now(),
          });
        },
        async () => {
          await appendLog({
            videoId,
            title,
            related: false,
            action: "went_back",
            reason: verdict.reason,
            ts: Date.now(),
          });
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
