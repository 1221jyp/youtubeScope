// 세션 종료 직후 유튜브 페이지 위에 이탈 리포트를 띄운다.
// content script에서는 확장 팝업을 열 수 없어서 페이지 안에 모달로 그린다.
// 본문 렌더링은 popup과 같은 shared/report-view.js를 쓴다.
(function (root) {
  "use strict";

  const { renderReport } = root.JJG_REPORT_VIEW;
  const { sendMessageWithTimeout } = root.JJG_MESSAGING;

  const BACKDROP_ID = "jjg-report-backdrop";
  // 리포트는 background에서 최대 90초까지 걸릴 수 있다.
  const REQUEST_TIMEOUT_MS = 95000;

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
      showMessage(
        backdrop,
        (response && response.error) ||
          "리포트를 생성하지 못했어요. 확장 아이콘을 눌러 다시 시도할 수 있어요."
      );
      return;
    }

    setBody(backdrop, (body) => renderReport(body, response.report));
  }

  root.JJG_REPORT_MODAL = Object.freeze({ show, close });
})(typeof globalThis !== "undefined" ? globalThis : this);
