// [파트: 이유 재판정] 차단 경고 화면과 "이유를 내고 AI 승인받기" 흐름.
// 판정 결과에 따라 호출부(judge-flow.js)가 넘긴 handlers 중 하나만 호출한다.
(function (root) {
  "use strict";

  const { escapeHtml, getOverlayElement } = root.JJG_UI;
  const { extractTitle, extractDescription } = root.JJG_NAV;
  const { sendMessageWithTimeout } = root.JJG_MESSAGING;

  // handlers: { onApproved(userReason, explanation), onRejected(userReason, explanation),
  //             onSkipped(userReason, failReason), onGoBack() }
  function showWarning(purpose, verdictInfo, handlers) {
    const overlay = getOverlayElement();
    if (!overlay) return;

    let decision = "block";
    let score = null;
    let reason = "";

    if (verdictInfo && typeof verdictInfo === "object") {
      decision = verdictInfo.decision || "block";
      score = verdictInfo.score != null ? verdictInfo.score : null;
      reason = verdictInfo.reason || "";
    } else if (typeof verdictInfo === "string") {
      reason = verdictInfo;
    }

    const { VIDEO_DECISIONS } = root.JJG_SCHEMA;
    const isAskReason = decision === VIDEO_DECISIONS.ASK_REASON;

    const titleText = isAskReason
      ? `🤔 "${escapeHtml(purpose)}"과(와) 연관성이 애매합니다${score != null ? ` (${score}점)` : ""}`
      : `⛔ "${escapeHtml(purpose)}" 목적과 무관하여 차단되었습니다${score != null ? ` (${score}점)` : ""}`;

    const defaultReasonText = isAskReason
      ? "목적과의 직접적 연관성이 확실하지 않습니다."
      : "현재 몰입 목적과 떨어진 콘텐츠입니다.";

    if (isAskReason) {
      overlay.innerHTML = `
        <div class="jjg-box">
          <div class="jjg-warning-title">${titleText}</div>
          <div class="jjg-warning-reason">${escapeHtml(reason || defaultReasonText)}</div>
          <textarea id="jjg-user-reason" placeholder="왜 이 영상을 시청해야 하는지 이유를 적어주세요."></textarea>
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
    } else {
      // block인 경우 이유 입력란 없이 돌아가기 버튼만 제공
      overlay.innerHTML = `
        <div class="jjg-box">
          <div class="jjg-warning-title">${titleText}</div>
          <div class="jjg-warning-reason">${escapeHtml(reason || defaultReasonText)}</div>
          <div class="jjg-btn-row">
            <button class="jjg-btn-leave" id="jjg-btn-go-back">돌아가기</button>
          </div>
        </div>
      `;
      overlay.querySelector("#jjg-btn-go-back").addEventListener("click", handlers.onGoBack);
    }
  }

  root.JJG_REASON_FLOW = Object.freeze({ showWarning });
})(typeof globalThis !== "undefined" ? globalThis : this);
