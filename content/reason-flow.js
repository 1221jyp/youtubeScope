// [파트: 이유 재판정] 차단 경고 화면과 "이유를 내고 AI 승인받기" 흐름.
// 판정 결과에 따라 호출부(judge-flow.js)가 넘긴 handlers 중 하나만 호출한다.
(function (root) {
  "use strict";

  const { escapeHtml, getOverlayElement } = root.JJG_UI;
  const { extractTitle, extractDescription } = root.JJG_NAV;
  const { sendMessageWithTimeout } = root.JJG_MESSAGING;

  // handlers: { onApproved(userReason, explanation), onRejected(userReason, explanation),
  //             onSkipped(userReason, failReason), onGoBack() }
  function showWarning(purpose, reason, handlers) {
    const overlay = getOverlayElement();
    if (!overlay) return;

    overlay.innerHTML = `
      <div class="jjg-box">
        <div class="jjg-warning-title">이거 "${escapeHtml(purpose)}"이랑 관련 있어?</div>
        <div class="jjg-warning-reason">${escapeHtml(reason || "목적과 무관해 보여요")}</div>
        <textarea id="jjg-user-reason" placeholder="왜 이 영상을 봐야 하는지 입력하세요."></textarea>
        <div class="jjg-reason-result" id="jjg-reason-result" hidden></div>
        <div class="jjg-btn-row">
          <button class="jjg-btn-leave" id="jjg-btn-go-back">돌아가기</button>
          <button class="jjg-btn-watch-anyway" id="jjg-btn-submit-reason">AI에게 제출</button>
        </div>
      </div>
    `;

    const textarea = overlay.querySelector("#jjg-user-reason");
    const resultEl = overlay.querySelector("#jjg-reason-result");
    const submitBtn = overlay.querySelector("#jjg-btn-submit-reason");

    function showResult(message) {
      resultEl.textContent = message;
      resultEl.hidden = false;
    }

    overlay.querySelector("#jjg-btn-go-back").addEventListener("click", handlers.onGoBack);
    submitBtn.addEventListener("click", async () => {
      const userReason = textarea.value.trim();
      if (!userReason) {
        showResult("이유를 입력해 주세요.");
        textarea.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "AI가 확인 중...";
      const verdict = await sendMessageWithTimeout({
        type: "JUDGE_REASON",
        purpose,
        title: extractTitle(),
        description: extractDescription(),
        userReason,
      });
      submitBtn.disabled = false;
      submitBtn.textContent = "AI에게 제출";

      // AI 장애로 판정하지 못한 경우는 승인이 아니라 "건너뜀"으로 구분해서 기록한다.
      if (verdict.failOpen) {
        handlers.onSkipped(userReason, verdict.reason);
        return;
      }
      if (verdict.related) {
        handlers.onApproved(userReason, verdict.reason);
        return;
      }
      handlers.onRejected(userReason, verdict.reason);
      showResult(
        verdict.reason
          ? `AI 판단: ${verdict.reason}`
          : "AI가 이유까지 고려해도 관련 없는 영상으로 판단했어요."
      );
    });
  }

  root.JJG_REASON_FLOW = Object.freeze({ showWarning });
})(typeof globalThis !== "undefined" ? globalThis : this);
