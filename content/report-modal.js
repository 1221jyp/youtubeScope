// 세션 종료 직후 유튜브 페이지 위에 이탈 리포트를 띄운다.
// content script에서는 확장 팝업을 열 수 없어서 페이지 안에 모달로 그린다.
// 본문 렌더링은 popup과 같은 shared/report-view.js를 쓴다.
//
// [에러 문구 매핑]
// background(report.js)가 채워 보내는 status("timeout"/"error")와 errorCode를 보고
// 사용자에게 다른 문구를 보여준다. 세션 미종료/로그 부족 같은 앱 레벨 검증 실패는
// errorCode가 없으므로 원문 메시지를 그대로 보여주고 "다시 시도" 안내는 붙이지 않는다.
(function (root) {
  "use strict";

  const { renderReport, renderNextSessionRules } = root.JJG_REPORT_VIEW;
  const { sendMessageWithTimeout } = root.JJG_MESSAGING;

  const BACKDROP_ID = "jjg-report-backdrop";
  // 리포트는 background에서 최대 90초까지 걸릴 수 있다.
  const REQUEST_TIMEOUT_MS = 95000;
  const RULES_TIMEOUT_MS = 95000;

  // errorCode → 사용자에게 보여줄 안내 문구. api_key_not_set/auth_error/rate_limit/network_error/
  // not_found/parse_error는 gemini.js가 분류한 AI 오류, message_failed는 content↔background
  // 통신 자체가 끊긴 경우다.
  const AI_ERROR_MESSAGES = Object.freeze({
    api_key_not_set: "🔑 Gemini API 키가 설정되지 않았어요. 확장 설정에서 키를 등록해주세요.",
    auth_error: "🔑 Gemini API 키가 유효하지 않거나 권한이 없어요. 설정에서 키를 확인해주세요.",
    rate_limit: "🚦 Gemini 요청 한도를 초과했어요. 잠시 후 다시 시도해주세요.",
    network_error: "📡 Gemini 서버에 연결하지 못했어요. 네트워크 상태를 확인하고 다시 시도해주세요.",
    not_found: "⚙️ 설정된 Gemini 모델을 찾을 수 없어요. 설정에서 모델명을 확인해주세요.",
    parse_error: "🤖 AI 응답 형식을 해석하지 못했어요. 다시 시도해주세요.",
    message_failed: "🔌 확장 프로그램과 통신하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해주세요.",
  });

  const DEFAULT_ERROR_MESSAGE =
    "⚠️ 리포트를 생성하지 못했어요. 확장 아이콘을 눌러 다시 시도할 수 있어요.";
  const TIMEOUT_MESSAGE =
    "⏱️ AI 응답이 너무 오래 걸려 리포트를 완성하지 못했어요. 잠시 후 확장 아이콘을 눌러 다시 시도해주세요.";

  // response.status/errorCode를 보고 어떤 문구를 보여줄지 결정한다.
  // 우선순위: timeout > 알려진 errorCode > 서버가 준 원문 error 메시지(앱 레벨 검증 실패) > 기본 문구.
  function resolveErrorMessage(response) {
    if (!response) return DEFAULT_ERROR_MESSAGE;

    // 타임아웃은 원인(AI 응답 지연 vs 메시지 채널 지연)과 무관하게 같은 안내를 보여준다.
    if (response.status === "timeout") return TIMEOUT_MESSAGE;

    if (response.errorCode && AI_ERROR_MESSAGES[response.errorCode]) {
      return AI_ERROR_MESSAGES[response.errorCode];
    }

    // 세션 미종료(SESSION_NOT_ENDED), 로그 부족(INSUFFICIENT_LOG) 등은 재시도해도 소용없으므로
    // 원문 한국어 메시지를 그대로 보여준다.
    if (response.error) return response.error;

    return DEFAULT_ERROR_MESSAGE;
  }

  function close() {
    const backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) backdrop.remove();
  }

  function setBody(backdrop, buildContent) {
    const body = backdrop.querySelector("#jjg-report-modal-body");
    body.replaceChildren();
    buildContent(body);
  }

  function showMessage(backdrop, message) {
    setBody(backdrop, (body) => {
      const p = document.createElement("p");
      p.className = "jjg-report-message";
      p.textContent = message;
      body.appendChild(p);
    });
  }

  function getRulesContainer(backdrop) {
    return backdrop.querySelector("#jjg-next-session-rules");
  }

  async function loadNextSessionRules(backdrop) {
    const container = getRulesContainer(backdrop);
    if (!container) return;
    renderNextSessionRules(container, [], "AI가 다음 세션 규칙을 만들고 있어요...");

    const response = await sendMessageWithTimeout(
      { type: "GENERATE_NEXT_SESSION_RULES" },
      RULES_TIMEOUT_MS
    );
    if (!document.getElementById(BACKDROP_ID) || !getRulesContainer(backdrop)) return;
    if (!response || !response.ok) {
      renderNextSessionRules(container, [], resolveErrorMessage(response));
      return;
    }
    renderNextSessionRules(
      container,
      response.rules,
      response.reason || "제안할 다음 세션 규칙이 없습니다."
    );
  }

  async function show() {
    close();

    const backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.className = "jjg-backdrop";
    backdrop.innerHTML = `
      <div class="jjg-modal jjg-report-modal">
        <h2>몰입 세션이 끝났어요</h2>
        <div id="jjg-report-modal-body"></div>
        <button class="jjg-modal-close" id="jjg-report-modal-close">닫기</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#jjg-report-modal-close").addEventListener("click", close);

    showMessage(backdrop, "AI가 이번 세션의 시청 경로를 분석하고 있어요...");

    const response = await sendMessageWithTimeout(
      { type: "GENERATE_SESSION_REPORT" },
      REQUEST_TIMEOUT_MS
    );

    // 사용자가 기다리는 동안 닫았으면 아무것도 하지 않는다.
    if (!document.getElementById(BACKDROP_ID)) return;

    if (!response || !response.ok) {
      showMessage(backdrop, resolveErrorMessage(response));
      return;
    }

    setBody(backdrop, (body) => {
      renderReport(body, response.report);
      const rulesContainer = document.createElement("div");
      rulesContainer.id = "jjg-next-session-rules";
      body.appendChild(rulesContainer);
    });
    // 규칙 생성 실패가 이미 표시된 증거 리포트를 가리지 않도록 별도로 처리한다.
    loadNextSessionRules(backdrop);
  }

  root.JJG_REPORT_MODAL = Object.freeze({ show, close });
})(typeof globalThis !== "undefined" ? globalThis : this);