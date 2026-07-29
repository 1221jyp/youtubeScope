// [파트: 목표 달성 확인 — 용진]
// 화면과 사용자 선택만 담당한다. 저장과 세션 상태 전이는 content/session.js의 callback 책임이다.
(function (root) {
  "use strict";

  const {
    STORAGE_KEYS,
    SESSION_STATUS,
    COMPLETION_STATUS,
    normalizeGoalProfile,
  } = root.JJG_SCHEMA;

  const BACKDROP_ID = "jjg-completion-backdrop";
  let opening = false;

  const CHOICES = [
    {
      status: COMPLETION_STATUS.ACHIEVED,
      label: "달성했어요",
      variant: "jjg-choice-achieved",
    },
    {
      status: COMPLETION_STATUS.PARTIAL,
      label: "부분적으로 달성했어요",
      variant: "jjg-choice-partial",
    },
    {
      status: COMPLETION_STATUS.NOT_ACHIEVED,
      label: "아직 달성하지 못했어요",
      variant: "jjg-choice-failed",
    },
  ];

  function appendText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function buildInfoSection(parent, label, value, className) {
    const section = document.createElement("section");
    section.className = className;
    appendText(section, "div", "jjg-completion-label", label);
    appendText(section, "div", "jjg-completion-value", value);
    parent.appendChild(section);
  }

  async function askCompletion({ onConfirm, onCancel } = {}) {
    if (opening || document.getElementById(BACKDROP_ID)) return false;
    opening = true;

    try {
      if ((await root.JJG_SESSION.getStatus()) !== SESSION_STATUS.ENDING) return false;

      const data = await root.JJG_STORAGE.get([
        STORAGE_KEYS.PURPOSE,
        STORAGE_KEYS.GOAL_PROFILE,
      ]);
      // 비동기 저장소 조회 중 상태가 바뀐 경우에도 잘못된 모달을 띄우지 않는다.
      if ((await root.JJG_SESSION.getStatus()) !== SESSION_STATUS.ENDING) return false;

      const purpose =
        typeof data[STORAGE_KEYS.PURPOSE] === "string"
          ? data[STORAGE_KEYS.PURPOSE].trim()
          : "";
      const profileResult = normalizeGoalProfile(data[STORAGE_KEYS.GOAL_PROFILE]);
      const profile = profileResult.valid ? profileResult.value : null;
      const mainGoal = profile?.mainGoal || purpose;
      const goalText = mainGoal || "이번 세션에서 설정한 목적";
      const conditionText =
        profile?.completionCondition ||
        profile?.mainGoal ||
        purpose ||
        "이번 세션에서 설정한 목적을 얼마나 달성했는지 선택해주세요.";

      const backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "jjg-backdrop";

      const modal = document.createElement("div");
      modal.className = "jjg-modal jjg-completion-modal";
      appendText(modal, "h2", "", "목표를 얼마나 달성했나요?");
      buildInfoSection(modal, "이번 세션의 목표", goalText, "jjg-completion-goal");
      buildInfoSection(modal, "달성 조건", conditionText, "jjg-completion-condition");

      const choiceRow = document.createElement("div");
      choiceRow.id = "jjg-completion-choices";
      choiceRow.className = "jjg-choice-row";
      modal.appendChild(choiceRow);

      const processingMessage = appendText(
        modal,
        "p",
        "jjg-completion-status",
        "세션을 종료하고 있어요..."
      );
      processingMessage.id = "jjg-completion-status";
      processingMessage.hidden = true;

      const errorMessage = appendText(modal, "p", "jjg-completion-error", "");
      errorMessage.id = "jjg-completion-error";
      errorMessage.hidden = true;

      const cancelButton = appendText(
        modal,
        "button",
        "jjg-text-btn",
        "아직 더 볼래요"
      );
      cancelButton.id = "jjg-completion-cancel";

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      let processing = false;
      const buttons = [];

      function setProcessing(value, message) {
        processing = value;
        buttons.forEach((button) => {
          button.disabled = value;
        });
        cancelButton.disabled = value;
        processingMessage.textContent = message;
        processingMessage.hidden = !value;
        if (value) errorMessage.hidden = true;
      }

      function showError(message) {
        errorMessage.textContent = message;
        errorMessage.hidden = false;
      }

      async function runAction(callback, value, processingText, errorText) {
        if (processing || typeof callback !== "function") return;
        setProcessing(true, processingText);
        try {
          const succeeded = await callback(value);
          if (succeeded === false) throw new Error("callback returned false");
          backdrop.remove();
        } catch (error) {
          console.warn("[조준경] 목표 달성 확인 처리 실패:", error);
          setProcessing(false, "");
          showError(errorText);
        }
      }

      for (const choice of CHOICES) {
        const button = appendText(
          choiceRow,
          "button",
          `jjg-choice ${choice.variant}`,
          choice.label
        );
        button.dataset.completionStatus = choice.status;
        button.addEventListener("click", () =>
          runAction(
            onConfirm,
            choice.status,
            "세션을 종료하고 있어요...",
            "목표 달성 결과를 저장하지 못했습니다. 다시 시도해주세요."
          )
        );
        buttons.push(button);
      }

      cancelButton.addEventListener("click", () =>
        runAction(
          onCancel,
          undefined,
          "세션으로 돌아가고 있어요...",
          "세션을 계속하지 못했습니다. 다시 시도해주세요."
        )
      );

      return true;
    } finally {
      opening = false;
    }
  }

  root.JJG_COMPLETION = Object.freeze({ askCompletion });
})(typeof globalThis !== "undefined" ? globalThis : this);
