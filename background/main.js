// 조준경 background service worker 진입점.
// 역할: 모듈 로딩과 메시지 라우팅만. 실제 처리는 기능별 모듈에 있다.
// 상태는 절대 변수에 들고 있지 않고 매번 chrome.storage.local에서 읽고 쓴다
// (service worker는 언제든 잠들 수 있음).

// 테스트는 이 파일을 vm에서 직접 실행하며 모듈을 수동으로 주입하므로 importScripts가 없다.
if (typeof importScripts === "function") {
  importScripts(
    "/shared/schema.js",
    "/shared/text.js",
    "/shared/storage.js",
    "/background/gemini.js",
    "/background/verdict.js",
    "/background/judge.js",
    "/background/reason.js",
    "/background/report.js",
    "/background/next-session-rules.js",
    "/background/goal.js"
  );
}

// 메시지 타입 → 처리 함수. 새 기능은 자기 모듈을 만들고 여기에 한 줄만 추가한다.
const JJG_MESSAGE_HANDLERS = {
  JUDGE_VIDEO: (message) => globalThis.JJG_JUDGE.judgeVideo(message),
  JUDGE_REASON: (message) => globalThis.JJG_REASON.judgeReason(message),
  GENERATE_SESSION_REPORT: (message) => globalThis.JJG_REPORT.handleGenerateSessionReport(message),
  GENERATE_NEXT_SESSION_RULES: (message) =>
    globalThis.JJG_NEXT_SESSION_RULES.handleGenerateNextSessionRules(message),
  GENERATE_GOAL_PROFILE: (message) => globalThis.JJG_GOAL.handleGenerateGoalProfile(message),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && JJG_MESSAGE_HANDLERS[message.type];
  if (!handler) return false;

  // 어떤 경우에도 응답을 보낸다. 응답이 없으면 content script가 타임아웃까지 매달린다.
  // 실패 응답은 판정(related/failOpen)과 리포트(ok) 양쪽 형식을 함께 만족시켜서,
  // 예상 못 한 예외에도 fail-open 정책이 유지되게 한다.
  Promise.resolve()
    .then(() => handler(message))
    .catch((err) => {
      const reason = (err && err.message) || "처리 실패";
      console.warn("[조준경] 메시지 처리 실패:", message.type, reason);
      return { ok: false, error: reason, related: true, reason, failOpen: true };
    })
    .then(sendResponse);

  return true; // keep the message channel open for the async response
});
