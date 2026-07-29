// [파트: 목적 AI 구체화] GENERATE_GOAL_PROFILE 처리.
// 사용자가 입력한 rawPurpose를 Gemini API를 통해 주요 목표, 허용 주제, 경계 주제, 차단 주제, 달성 조건으로 구체화한다.
(function (root) {
  "use strict";

  const { normalizeGoalProfile } = root.JJG_SCHEMA;
  const { callFunction, getConfig } = root.JJG_GEMINI;
  const { textOrEmpty } = root.JJG_TEXT;

  const TIMEOUT_MS = 45000;

  const GOAL_TOOL = {
    name: "structure_goal",
    description: "사용자가 입력한 목적을 구체화하여 구조화된 목적 프로필 객체를 생성한다.",
    parameters: {
      type: "OBJECT",
      properties: {
        rawPurpose: { type: "STRING", description: "사용자가 입력한 목적 원문 그대로" },
        mainGoal: { type: "STRING", description: "구체화된 주요 목표 요약" },
        allowedTopics: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "목적 달성에 직접 관련된 허용 주제 목록",
        },
        borderlineTopics: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "목적과 간접적으로 관련되거나 후기/면접 등 경계 주제 목록",
        },
        blockedTopics: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "목적과 무관하여 차단해야 할 명백한 주제 목록 (브이로그, 쇼핑, 음악 등)",
        },
        completionCondition: {
          type: "STRING",
          description: "세션 종료 시 목표를 이뤘는지 스스로 판정할 수 있는 구체적이고 평가 가능한 달성 조건",
        },
      },
      required: [
        "rawPurpose",
        "mainGoal",
        "allowedTopics",
        "borderlineTopics",
        "blockedTopics",
        "completionCondition",
      ],
    },
  };

  const SYSTEM_INSTRUCTION =
    `너는 유튜브 학습/작업 세션의 목적을 명확히 구체화하는 분석 도우미다.\n` +
    `사용자가 입력한 한 줄 목적(rawPurpose)을 바탕으로, 유튜브 시청 시 키워드 필터링과 이탈 방지 판단에 쓸 수 있는 구조화된 프로필을 생성한다.\n\n` +
    `원칙:\n` +
    `1. rawPurpose는 사용자가 입력한 텍스트 그대로 유지한다.\n` +
    `2. mainGoal은 사용자의 학습/작업 의도를 명확하게 정리한 핵심 목표로 작성한다.\n` +
    `3. allowedTopics에는 목적 달성에 필요한 핵심 개념, 관련 기술, 학습 주제 태그 3~6개를 넣는다.\n` +
    `4. borderlineTopics에는 같은 분야이지만 이탈 가능성이 있는 준비 후기, 면접 후기, 공부법 잡담 등의 태그 2~4개를 넣는다.\n` +
    `5. blockedTopics에는 목적과 관련 없는 브이로그, 쇼핑, 음악 MV, 예능, 게임 등 차단할 대표 키워드 3~5개를 넣는다.\n` +
    `6. completionCondition은 세션 종료 시 사용자가 목표 달성 여부를 명확히 확인할 수 있는 구체적인 가이드 문장(예: "두 충돌 처리 방식의 차이를 설명할 수 있음")으로 작성한다.\n` +
    `7. 반드시 structure_goal 도구를 한 번 호출하여 답한다.`;

  async function generateGoalProfile({ purpose }) {
    const rawPurpose = textOrEmpty(purpose);
    if (!rawPurpose) {
      return { ok: false, error: "목적이 비어 있습니다." };
    }

    const { apiKey, model } = await getConfig();
    if (!apiKey) {
      return { ok: false, code: "API_KEY_NOT_SET", error: "Gemini API 키가 설정되지 않았습니다." };
    }

    try {
      const args = await callFunction({
        apiKey,
        model,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  task: "사용자 입력 목적 구체화 및 구조화",
                  userRawPurpose: rawPurpose,
                }),
              },
            ],
          },
        ],
        tool: GOAL_TOOL,
        temperature: 0.2,
        timeoutMs: TIMEOUT_MS,
      });

      if (!args) {
        return { ok: false, error: "AI 응답 형식을 해석할 수 없습니다." };
      }

      // rawPurpose가 혹시 Gemini 응답 과정에서 변형되었으면 사용자의 원문으로 확실하게 채워넣음
      const candidate = {
        ...args,
        rawPurpose: rawPurpose,
      };

      const normalized = normalizeGoalProfile(candidate);
      if (!normalized.valid) {
        console.warn("[조준경] normalizeGoalProfile 검증 실패:", normalized.errors);
        return { ok: false, error: "AI가 생성한 목표 구체화 형식이 유효하지 않습니다." };
      }

      return { ok: true, goalProfile: normalized.value };
    } catch (err) {
      const reason = (err && err.message) || "목적 구체화 실패";
      console.warn("[조준경] generateGoalProfile 에러:", reason);
      return { ok: false, error: reason };
    }
  }

  async function handleGenerateGoalProfile(message = {}) {
    return await generateGoalProfile({ purpose: message.purpose });
  }

  const api = Object.freeze({
    generateGoalProfile,
    handleGenerateGoalProfile,
  });

  root.JJG_GOAL = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
