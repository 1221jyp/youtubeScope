// [파트: 목표 달성 확인 — 용진] 몰입 종료 시 목표를 이뤘는지 확인하는 화면.
//
// ⚠️ 지금은 최소 구현이다. 세션이 ending에서 멈추지 않도록 임시로 만들어 둔 것이므로,
//    이 파일만 통째로 갈아끼우면 된다. 지켜야 할 규약은 두 가지뿐이다.
//
//    1. askCompletion({ onConfirm, onCancel })를 export 한다.
//    2. 사용자가 결과를 고르면 onConfirm(COMPLETION_STATUS 값 중 하나)를 호출하고,
//       그만두면 onCancel()을 호출한다. (호출 후 화면을 닫는 것까지 이 모듈 책임)
//
//    onConfirm이 불리면 session.js가 COMPLETION_RESULT를 저장하고 ended로 넘긴 뒤
//    이탈 리포트를 띄운다. 이 파일에서 직접 상태를 바꾸지 않는다.
(function (root) {
  "use strict";

  const { COMPLETION_STATUS } = root.JJG_SCHEMA;
  const { escapeHtml } = root.JJG_UI;

  const BACKDROP_ID = "jjg-completion-backdrop";

  const CHOICES = [
    { status: COMPLETION_STATUS.ACHIEVED, label: "달성했어요", variant: "jjg-choice-achieved" },
    { status: COMPLETION_STATUS.PARTIAL, label: "부분적으로요", variant: "jjg-choice-partial" },
    { status: COMPLETION_STATUS.NOT_ACHIEVED, label: "못 했어요", variant: "jjg-choice-failed" },
  ];

  async function askCompletion({ onConfirm, onCancel }) {
    if (document.getElementById(BACKDROP_ID)) return;

    const purpose = await root.JJG_SESSION.getPurpose();

    const backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.className = "jjg-backdrop";
    backdrop.innerHTML = `
      <div class="jjg-modal">
        <h2>목표를 이루셨나요?</h2>
        <p class="jjg-modal-purpose">${escapeHtml(purpose || "(목적 없음)")}</p>
        <div class="jjg-choice-row" id="jjg-completion-choices"></div>
        <button class="jjg-text-btn" id="jjg-completion-cancel">아직 더 볼래요</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    const choiceRow = backdrop.querySelector("#jjg-completion-choices");

    for (const choice of CHOICES) {
      const btn = document.createElement("button");
      btn.className = `jjg-choice ${choice.variant}`;
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        close();
        onConfirm(choice.status);
      });
      choiceRow.appendChild(btn);
    }

    backdrop.querySelector("#jjg-completion-cancel").addEventListener("click", () => {
      close();
      onCancel();
    });
  }

  root.JJG_COMPLETION = Object.freeze({ askCompletion });
})(typeof globalThis !== "undefined" ? globalThis : this);
