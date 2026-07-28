// [파트: 목적 설정 · 세션 관리] 목적 선언 모달과 세션 시작.
// 앞으로 목적 AI 구체화(GOAL_PROFILE)나 세션 종료 기능도 이 파일에서 다룬다.
(function (root) {
  "use strict";

  const { STORAGE_KEYS, createSession } = root.JJG_SCHEMA;

  async function getPurpose() {
    const data = await root.JJG_STORAGE.get([STORAGE_KEYS.PURPOSE]);
    return data[STORAGE_KEYS.PURPOSE] || "";
  }

  // 새 목적을 정하면 이전 세션의 로그·리포트·달성 결과를 모두 초기화한다.
  async function startNewSession(purpose) {
    const session = createSession();
    await root.JJG_STORAGE.set({
      [STORAGE_KEYS.PURPOSE]: purpose,
      [STORAGE_KEYS.SESSION_ID]: session.sessionId,
      [STORAGE_KEYS.SESSION_STATUS]: session.status,
      [STORAGE_KEYS.SESSION_STARTED_AT]: session.startedAt,
      [STORAGE_KEYS.SESSION_ENDED_AT]: session.endedAt,
      [STORAGE_KEYS.SESSION_LOG]: [],
      [STORAGE_KEYS.SESSION_REPORT]: null,
      [STORAGE_KEYS.COMPLETION_RESULT]: null,
    });
  }

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
      // 목적을 새로 설정한 시점에 현재 페이지가 /watch면 즉시 재판정한다.
      // 로드 순서상 judge-flow가 나중에 등록되므로 호출 시점에 참조한다.
      root.JJG_JUDGE_FLOW.handleWatchPage(true);
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
      showPurposeModal(await getPurpose());
    });
    document.body.appendChild(btn);
  }

  root.JJG_SESSION = Object.freeze({
    getPurpose,
    startNewSession,
    showPurposeModal,
    ensureChangePurposeButton,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
