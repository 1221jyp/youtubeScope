// MAIN world script: YouTube의 실제 history.pushState/replaceState 호출을 가로채
// 격리된(isolated) content script(content.js)가 들을 수 있는 커스텀 이벤트로 중계한다.
// yt-navigate-finish가 못 잡는 경우(예: 유튜브 내부 이벤트 미발생)의 보조 감지 수단.
(() => {
  if (window.__jjgHistoryHooked) return;
  window.__jjgHistoryHooked = true;

  const notify = () => {
    window.dispatchEvent(new CustomEvent("jjg-locationchange", { detail: { url: location.href } }));
  };

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = origPushState.apply(this, args);
    notify();
    return result;
  };

  history.replaceState = function (...args) {
    const result = origReplaceState.apply(this, args);
    notify();
    return result;
  };

  window.addEventListener("popstate", notify);
})();
