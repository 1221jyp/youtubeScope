// 공용 UI 프리미티브: 오버레이 틀, 토스트, 비디오 제어, HTML 이스케이프.
// 기능별 화면 내용은 각 기능 모듈이 채운다 (예: 이유 재판정 화면은 reason-flow.js).
(function (root) {
  "use strict";

  const { PLAYER_CONTAINER_CANDIDATES } = root.JJG_SELECTORS;

  let overlayState = null; // { el, cleanup }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function getPlayerContainer() {
    for (const sel of PLAYER_CONTAINER_CANDIDATES) {
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

  // 판정 대기 화면을 띄우고 영상을 멈춘다. 내용은 이후 기능 모듈이 교체한다.
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

  function getOverlayElement() {
    return overlayState ? overlayState.el : null;
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

  root.JJG_UI = Object.freeze({
    escapeHtml,
    showOverlay,
    removeOverlay,
    getOverlayElement,
    showToast,
    pauseVideo,
    playVideo,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
