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
  async function startNewSession(purpose, goalProfile = null) {
    const session = createSession();

    let validGoalProfile = null;
    if (goalProfile) {
      const check = root.JJG_SCHEMA.normalizeGoalProfile(goalProfile);
      if (check.valid) {
        validGoalProfile = check.value;
      } else {
        console.warn("[조준경] 유효하지 않은 goalProfile 저장 거부:", check.errors);
      }
    }

    await root.JJG_STORAGE.set({
      [STORAGE_KEYS.PURPOSE]: purpose,
      [STORAGE_KEYS.GOAL_PROFILE]: validGoalProfile,
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

  // ---------- 목적 선언 및 구체화 모달 ----------

  function showPurposeModal(prefill = "") {
    if (document.getElementById("jjg-purpose-modal-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "jjg-purpose-modal-backdrop";
    document.body.appendChild(backdrop);

    const renderInputView = (initialValue = prefill, errorText = "") => {
      backdrop.innerHTML = `
        <div id="jjg-purpose-modal">
          <h2>지금 유튜브에서 뭘 하려고 하나요?</h2>
          <p>목적을 한 줄로 적으면, AI가 목표를 구체화해 드릴게요.</p>
          <input id="jjg-purpose-input" type="text" placeholder="예) 자료구조 해시테이블 공부" maxlength="80" />
          ${errorText ? `<div class="jjg-modal-error">${root.JJG_UI.escapeHtml(errorText)}</div>` : ""}
          <button id="jjg-purpose-submit">목적 분석하기</button>
          <button id="jjg-purpose-dismiss" class="jjg-text-btn">나중에 할게요</button>
        </div>
      `;

      const input = backdrop.querySelector("#jjg-purpose-input");
      input.value = initialValue;
      input.focus();

      const submit = async () => {
        const rawPurpose = input.value.trim();
        if (!rawPurpose) {
          input.focus();
          return;
        }
        renderLoadingView(rawPurpose);
      };

      const dismiss = () => backdrop.remove();

      backdrop.querySelector("#jjg-purpose-submit").addEventListener("click", submit);
      backdrop.querySelector("#jjg-purpose-dismiss").addEventListener("click", dismiss);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") dismiss();
      });
    };

    const renderLoadingView = async (rawPurpose) => {
      backdrop.innerHTML = `
        <div id="jjg-purpose-modal">
          <div class="jjg-spinner-dark"></div>
          <h2>AI가 목표를 분석하고 있어요...</h2>
          <p>‘${root.JJG_UI.escapeHtml(rawPurpose)}’ 목적을 구체화하는 중입니다.</p>
        </div>
      `;

      const response = await root.JJG_MESSAGING.sendMessageWithTimeout({
        type: "GENERATE_GOAL_PROFILE",
        purpose: rawPurpose,
      });

      let normalized = null;
      if (response && response.ok && response.goalProfile) {
        const check = root.JJG_SCHEMA.normalizeGoalProfile(response.goalProfile);
        if (check.valid) {
          normalized = check.value;
        }
      }

      if (normalized) {
        renderProfileConfirmView(rawPurpose, normalized);
      } else {
        const err = response?.error || "AI 목표 구체화 생성 실패";
        renderFallbackView(rawPurpose, err);
      }
    };

    const renderProfileConfirmView = (rawPurpose, goalProfile) => {
      const allowedHtml = goalProfile.allowedTopics.length
        ? goalProfile.allowedTopics.map((t) => `<span class="jjg-topic-pill allowed">${root.JJG_UI.escapeHtml(t)}</span>`).join("")
        : "<span>없음</span>";
      const borderlineHtml = goalProfile.borderlineTopics.length
        ? goalProfile.borderlineTopics.map((t) => `<span class="jjg-topic-pill borderline">${root.JJG_UI.escapeHtml(t)}</span>`).join("")
        : "<span>없음</span>";

      backdrop.innerHTML = `
        <div id="jjg-purpose-modal" class="jjg-profile-modal">
          <h2>AI가 이해한 목표가 맞나요?</h2>
          <div class="jjg-raw-purpose-badge">입력 목적: ${root.JJG_UI.escapeHtml(rawPurpose)}</div>
          
          <div class="jjg-profile-section">
            <div class="jjg-profile-label">🎯 주요 목표</div>
            <div class="jjg-profile-content">${root.JJG_UI.escapeHtml(goalProfile.mainGoal)}</div>
          </div>

          <div class="jjg-profile-section">
            <div class="jjg-profile-label">✅ 허용 주제</div>
            <div class="jjg-topic-list">${allowedHtml}</div>
          </div>

          <div class="jjg-profile-section">
            <div class="jjg-profile-label">⚠️ 경계 주제</div>
            <div class="jjg-topic-list">${borderlineHtml}</div>
          </div>

          ${
            goalProfile.completionCondition
              ? `
              <div class="jjg-profile-section">
                <div class="jjg-profile-label">🏁 달성 조건 (종료 시 확인)</div>
                <div class="jjg-profile-content">${root.JJG_UI.escapeHtml(goalProfile.completionCondition)}</div>
              </div>`
              : ""
          }

          <button id="jjg-goal-confirm" class="jjg-confirm-btn">AI가 이해한 목표가 맞아요</button>
          <button id="jjg-goal-edit" class="jjg-secondary-btn">목적 다시 입력하기</button>
          <button id="jjg-purpose-dismiss" class="jjg-text-btn">나중에 할게요</button>
        </div>
      `;

      backdrop.querySelector("#jjg-goal-confirm").addEventListener("click", async () => {
        await startNewSession(rawPurpose, goalProfile);
        backdrop.remove();
        root.JJG_JUDGE_FLOW.handleWatchPage(true);
      });

      backdrop.querySelector("#jjg-goal-edit").addEventListener("click", () => {
        renderInputView(rawPurpose);
      });

      backdrop.querySelector("#jjg-purpose-dismiss").addEventListener("click", () => {
        backdrop.remove();
      });
    };

    const renderFallbackView = (rawPurpose, errorMsg) => {
      backdrop.innerHTML = `
        <div id="jjg-purpose-modal">
          <h2>AI 구체화 안내</h2>
          <p class="jjg-modal-error">${root.JJG_UI.escapeHtml(errorMsg)}</p>
          <p>원문 목적만으로 세션을 시작하시겠어요?</p>
          <button id="jjg-fallback-confirm" class="jjg-confirm-btn">원문 목적으로 시작</button>
          <button id="jjg-goal-edit" class="jjg-secondary-btn">목적 다시 입력하기</button>
          <button id="jjg-purpose-dismiss" class="jjg-text-btn">나중에 할게요</button>
        </div>
      `;

      backdrop.querySelector("#jjg-fallback-confirm").addEventListener("click", async () => {
        await startNewSession(rawPurpose, null);
        backdrop.remove();
        root.JJG_JUDGE_FLOW.handleWatchPage(true);
      });

      backdrop.querySelector("#jjg-goal-edit").addEventListener("click", () => {
        renderInputView(rawPurpose);
      });

      backdrop.querySelector("#jjg-purpose-dismiss").addEventListener("click", () => {
        backdrop.remove();
      });
    };

    renderInputView(prefill);
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
