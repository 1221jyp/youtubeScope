// [파트: 목적 설정 · 세션 관리] 세션 상태 머신과 화면 위 버튼.
//
// 상태 전이 (SCHEMA.md의 SESSION_STATUS):
//   (없음/ended) --목표 설정--> active --몰입 종료--> ending --목표 확인 완료--> ended
//                                  ^                    |
//                                  +---- 확인 취소 ------+
//
// UI는 두 가지로만 보인다.
//   기본 상태 (없음 또는 ended) : [목표 설정]
//   몰입 상태 (active)          : [목적 변경] [몰입 종료]
//   ending은 전환 중이라 버튼을 비활성화한다 (종료 버튼 중복 클릭 방지가 여기서 해결된다).
(function (root) {
  "use strict";

  const { STORAGE_KEYS, SESSION_STATUS, createSession, normalizeSession } = root.JJG_SCHEMA;

  const BUTTON_BAR_ID = "jjg-session-bar";

  // 저장소는 세션을 키 4개로 나눠 담는다. normalizeSession()은 객체 하나를 받으므로 다시 조립한다.
  async function getSession() {
    const data = await root.JJG_STORAGE.get([
      STORAGE_KEYS.PURPOSE,
      STORAGE_KEYS.SESSION_ID,
      STORAGE_KEYS.SESSION_STATUS,
      STORAGE_KEYS.SESSION_STARTED_AT,
      STORAGE_KEYS.SESSION_ENDED_AT,
    ]);
    const normalized = normalizeSession({
      sessionId: data[STORAGE_KEYS.SESSION_ID],
      status: data[STORAGE_KEYS.SESSION_STATUS],
      startedAt: data[STORAGE_KEYS.SESSION_STARTED_AT],
      endedAt: data[STORAGE_KEYS.SESSION_ENDED_AT],
    });
    return {
      purpose: data[STORAGE_KEYS.PURPOSE] || "",
      // 설치 직후처럼 세션이 없으면 status가 null이다. 기본 상태로 취급한다.
      ...normalized.value,
    };
  }

  async function getPurpose() {
    const data = await root.JJG_STORAGE.get([STORAGE_KEYS.PURPOSE]);
    return data[STORAGE_KEYS.PURPOSE] || "";
  }

  async function getStatus() {
    return (await getSession()).status;
  }

  // 몰입 상태에서만 영상을 판정한다. judge-flow가 이 값을 보고 결정한다.
  async function isFocusing() {
    return (await getStatus()) === SESSION_STATUS.ACTIVE;
  }

  // 새 목적을 정하면 이전 세션의 로그·리포트·달성 결과를 모두 초기화하고 active로 돌아간다.
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
    await renderSessionBar();
  }

  // active → ending. 로그는 절대 지우지 않는다 (리포트가 그대로 써야 한다).
  // 이미 active가 아니면 아무것도 하지 않으므로 중복 클릭이 안전하다.
  async function beginEnding() {
    if ((await getStatus()) !== SESSION_STATUS.ACTIVE) return false;
    await root.JJG_STORAGE.set({ [STORAGE_KEYS.SESSION_STATUS]: SESSION_STATUS.ENDING });
    await renderSessionBar();
    return true;
  }

  // 목표 확인을 취소하면 몰입 상태로 되돌린다.
  async function cancelEnding() {
    if ((await getStatus()) !== SESSION_STATUS.ENDING) return false;
    await root.JJG_STORAGE.set({ [STORAGE_KEYS.SESSION_STATUS]: SESSION_STATUS.ACTIVE });
    await renderSessionBar();
    return true;
  }

  // ending → ended. 목표 달성 결과를 먼저 저장한 뒤에만 ended로 넘어간다.
  // completionStatus는 COMPLETION_STATUS 값(achieved/partial/not_achieved).
  async function completeSession(completionStatus) {
    if ((await getStatus()) !== SESSION_STATUS.ENDING) return false;

    const completion = root.JJG_SCHEMA.normalizeCompletionResult({
      status: completionStatus,
      checkedAt: Date.now(),
    });
    if (!completion.valid) {
      console.warn("[조준경] 목표 달성 결과가 유효하지 않음:", completion.errors);
      return false;
    }

    // 결과 저장이 끝난 뒤에 상태를 바꾼다. 순서가 바뀌면 결과 없는 ended가 생긴다.
    await root.JJG_STORAGE.set({ [STORAGE_KEYS.COMPLETION_RESULT]: completion.value });
    await root.JJG_STORAGE.set({
      [STORAGE_KEYS.SESSION_STATUS]: SESSION_STATUS.ENDED,
      [STORAGE_KEYS.SESSION_ENDED_AT]: Date.now(),
    });
    await renderSessionBar();
    return true;
  }

  // ---------- 화면 위 버튼 ----------

  function makeButton(id, text, onClick, { disabled = false, variant = "" } = {}) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.textContent = text;
    btn.disabled = disabled;
    if (variant) btn.classList.add(variant);
    if (!disabled) btn.addEventListener("click", onClick);
    return btn;
  }

  async function renderSessionBar() {
    const session = await getSession();
    let bar = document.getElementById(BUTTON_BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BUTTON_BAR_ID;
      document.body.appendChild(bar);
    }
    bar.replaceChildren();

    if (session.status === SESSION_STATUS.ACTIVE) {
      bar.appendChild(
        makeButton("jjg-change-purpose-btn", "🎯 목적 변경", async () =>
          showPurposeModal(await getPurpose())
        )
      );
      bar.appendChild(
        makeButton("jjg-end-session-btn", "⏹ 몰입 종료", onEndSessionClick, { variant: "jjg-end" })
      );
      return;
    }

    if (session.status === SESSION_STATUS.ENDING) {
      bar.appendChild(makeButton("jjg-ending-btn", "종료 중...", null, { disabled: true }));
      return;
    }

    // 기본 상태: 세션 없음 또는 ended
    bar.appendChild(
      makeButton("jjg-start-session-btn", "🎯 목표 설정", () => showPurposeModal(""))
    );
  }

  async function onEndSessionClick() {
    if (!(await beginEnding())) return;
    // 목표 달성 확인은 별도 모듈이 담당한다 (용진 파트: content/completion.js).
    root.JJG_COMPLETION.askCompletion({
      onConfirm: async (completionStatus) => {
        if (!(await completeSession(completionStatus))) return;
        root.JJG_REPORT_MODAL.show();
      },
      onCancel: () => cancelEnding(),
    });
  }

  // ---------- 목적 선언 모달 ----------

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
        <button id="jjg-purpose-dismiss" class="jjg-text-btn">나중에 할게요</button>
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
      // 목적을 새로 설정한 시점에 현재 페이지가 /watch면 즉시 재판정한다.
      // 로드 순서상 judge-flow가 나중에 등록되므로 호출 시점에 참조한다.
      root.JJG_JUDGE_FLOW.handleWatchPage(true);
    };

    // 닫아도 기본 상태로 남을 뿐이라 판정은 시작되지 않는다.
    const dismiss = () => backdrop.remove();

    backdrop.querySelector("#jjg-purpose-submit").addEventListener("click", submit);
    backdrop.querySelector("#jjg-purpose-dismiss").addEventListener("click", dismiss);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") dismiss();
    });
  }

  root.JJG_SESSION = Object.freeze({
    getSession,
    getPurpose,
    getStatus,
    isFocusing,
    startNewSession,
    beginEnding,
    cancelEnding,
    completeSession,
    renderSessionBar,
    showPurposeModal,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
