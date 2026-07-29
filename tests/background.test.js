const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// background/main.js의 importScripts 목록과 같은 순서여야 한다.
const BACKGROUND_FILES = [
  "shared/schema.js",
  "shared/text.js",
  "shared/storage.js",
  "background/gemini.js",
  "background/verdict.js",
  "background/judge.js",
  "background/reason.js",
  "background/report.js",
  "background/goal.js",
  "background/main.js",
];

function createHarness(initialStorage = {}) {
  const storage = { ...initialStorage };
  let listener;
  let fetchCount = 0;
  let fetchImpl = async () => {
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "session_report",
                    args: {
                      summary: "세션 요약",
                      firstDeviation: { title: "", reason: "" },
                      diversionPath: [],
                      patterns: [],
                      recommendations: ["다음 영상의 목적을 확인하기"],
                      encouragement: "집중 흐름을 잘 이어가고 있어요.",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    };
  };

  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          for (const key of keys) result[key] = storage[key];
          callback(result);
        },
        set(values, callback) {
          Object.assign(storage, values);
          if (callback) callback();
        },
      },
    },
    // shared/storage.js는 runtime.id로 확장 컨텍스트 유효성을 확인한다.
    runtime: {
      id: "test-extension",
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
    },
  };

  const context = vm.createContext({
    chrome,
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (...args) => fetchImpl(...args),
  });
  // manifest의 importScripts 순서와 동일하게 로드한다.
  for (const file of BACKGROUND_FILES) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
  }

  return {
    storage,
    get fetchCount() {
      return fetchCount;
    },
    setFetch(fn) {
      fetchImpl = async (...args) => {
        fetchCount += 1;
        return fn(...args);
      };
    },
    send(message) {
      return new Promise((resolve, reject) => {
        const asyncResponse = listener(message, {}, resolve);
        if (asyncResponse !== true) reject(new Error(`처리되지 않은 메시지: ${message.type}`));
      });
    },
  };
}

function geminiVerdictResponse(args) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: "verdict", args } }],
          },
        },
      ],
    }),
    text: async () => "",
  };
}

// 응답이 영영 오지 않는 회귀(sendResponse 미호출)를 무한 대기 대신 실패로 드러낸다.
function withTimeout(promise, label, ms = 3000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: 응답이 오지 않음`)), ms).unref?.()
    ),
  ]);
}

function baseStorage(log) {
  return {
    jjg_purpose: "해시테이블 공부",
    jjg_session_id: 100,
    jjg_session_log: log,
    jjg_gemini_api_key: "test-key",
    jjg_gemini_model: "gemini-flash-latest",
  };
}

async function run() {
  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async (url) => {
      assert.match(url, /generativelanguage\.googleapis\.com/);
      return geminiVerdictResponse({ decision: "block", score: 10, reason: "목적과 무관" });
    });
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "해시테이블 공부",
      videoId: "video-1",
      title: "해시테이블 강의",
      description: "",
    });
    assert.equal(verdict.decision, "block");
    assert.equal(verdict.score, 10);
    assert.equal(
      harness.storage.jjg_verdict_cache["v5||해시테이블 공부||video-1"].decision,
      "block"
    );
  }

  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () =>
      geminiVerdictResponse({ decision: "allow", score: 90, reason: "The video seems useful." })
    );
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "자료구조 해시테이블 공부",
      videoId: "vlog-1",
      title: "개발자 브이로그: 회사에서의 하루",
      description: "",
    });
    assert.equal(verdict.decision, "block");
    assert.equal(verdict.guardrail, true);
    assert.match(verdict.reason, /브이로그/);
  }

  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () =>
      geminiVerdictResponse({ decision: "ask_reason", score: 55, reason: "코딩 면접 후기 영상입니다." })
    );
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "해시테이블 공부",
      videoId: "interview-1",
      title: "개발자 코딩 면접 후기",
      description: "",
    });
    assert.equal(verdict.decision, "ask_reason");
    assert.equal(verdict.score, 55);
  }

  {
    const harness = createHarness(baseStorage([]));
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "INSUFFICIENT_LOG");
    assert.equal(harness.fetchCount, 0);
  }

  {
    const harness = createHarness(
      baseStorage([
        { title: "판정 실패 1", action: "skipped", related: true },
        { title: "판정 실패 2", action: "skipped", related: true },
      ])
    );
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "INSUFFICIENT_LOG");
    assert.equal(harness.fetchCount, 0);
  }

  {
    const harness = createHarness(
      baseStorage([
        { title: "강의 1", action: "watched", related: true },
        { title: "강의 2", action: "watched", related: true },
      ])
    );
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, true);
    assert.equal(response.report.firstDeviation.title, "");
    assert.deepEqual(Array.from(response.report.diversionPath), []);
  }

  {
    const harness = createHarness(
      baseStorage([
        { title: "해시테이블 강의", action: "watched", related: true },
        { title: "개발자 브이로그", action: "left_anyway", related: false, reason: "학습과 무관" },
      ])
    );
    harness.setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "session_report",
                    args: {
                      summary: "후기 영상을 거쳐 이탈했습니다.",
                      firstDeviation: { title: "<script>가짜 제목</script>", reason: "학습 흐름에서 벗어남" },
                      diversionPath: ["해시테이블 강의", "존재하지 않는 영상", "개발자 브이로그"],
                      patterns: ["학습에서 브이로그로 이동함"],
                      recommendations: ["보기 전에 목적 확인하기"],
                      encouragement: "다음 세션에서 다시 이어가면 됩니다.",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    }));
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, true);
    assert.equal(response.report.firstDeviation.title, "개발자 브이로그");
    assert.deepEqual(Array.from(response.report.diversionPath), [
      "해시테이블 강의",
      "개발자 브이로그",
    ]);
    assert.equal(harness.storage.jjg_session_report.sessionId, 100);
    const countAfterFirst = harness.fetchCount;
    const cached = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(cached.cached, true);
    assert.equal(harness.fetchCount, countAfterFirst);

    harness.storage.jjg_session_id = 101;
    const nextSession = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(nextSession.cached, false);
    assert.equal(harness.storage.jjg_session_report.sessionId, 101);
  }

  {
    const harness = createHarness(
      baseStorage([
        { title: "해시테이블 강의", action: "watched", related: true },
        { title: "브이로그", action: "went_back", related: false, reason: "목적과 무관" },
      ])
    );
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, true);
  }

  {
    const harness = createHarness(
      baseStorage([
        { title: "강의", action: "watched", related: true },
        { title: "브이로그", action: "left_anyway", related: false },
      ])
    );
    harness.setFetch(async () => {
      throw new TypeError("connection refused");
    });
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT", force: true });
    assert.equal(response.ok, false);
    assert.match(response.error, /Gemini API/);
  }

  {
    const storage = baseStorage([
      { title: "강의 1", action: "watched", related: true },
      { title: "강의 2", action: "watched", related: true },
    ]);
    storage.jjg_gemini_api_key = "";
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "API_KEY_NOT_SET");
    assert.equal(harness.fetchCount, 0);
  }

  {
    const harness = createHarness(
      baseStorage([
        { title: "강의 1", action: "watched", related: true },
        { title: "강의 2", action: "watched", related: true },
      ])
    );
    harness.setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "구조화되지 않은 답변" }] } }] }),
      text: async () => "",
    }));
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, false);
    assert.match(response.error, /응답 형식/);
  }

  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "API key not valid",
    }));
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "해시테이블 공부",
      videoId: "video-bad-key",
      title: "해시테이블 강의",
      description: "",
    });
    assert.equal(verdict.failOpen, true);
    assert.match(verdict.reason, /Gemini API 키가 유효하지 않음/);
  }

  {
    const storage = baseStorage([]);
    storage.jjg_gemini_api_key = "";
    const harness = createHarness(storage);
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "해시테이블 공부",
      videoId: "video-no-key",
      title: "해시테이블 강의",
      description: "",
    });
    assert.equal(verdict.failOpen, true);
    assert.match(verdict.reason, /Gemini API 키가 설정되지 않음/);
  }

  // 이유 재판정이 승인되면 이탈이 아니라 approved_reason으로 집계돼야 한다.
  {
    const harness = createHarness(
      baseStorage([
        { title: "해시테이블 강의", action: "watched", related: true },
        {
          title: "코딩테스트 합격 후기",
          action: "approved_reason",
          related: false,
          userReason: "해시테이블 출제 사례를 확인하려고",
          reasonVerdict: { accepted: true, explanation: "목적과 연결됨" },
        },
      ])
    );
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, true);
    assert.equal(response.report.firstDeviation.title, "");
    assert.deepEqual(Array.from(response.report.diversionPath), []);
    assert.match(response.report.summary, /승인받은 영상 1개/);
    assert.match(response.report.summary, /이탈 없음/);
  }

  // Gemini 장애로 callGemini가 던져도 JUDGE_REASON은 반드시 응답해야 한다.
  // 응답하지 않으면 content script가 65초 뒤 fail-open으로 영상을 자동 승인해버린다.
  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () => {
      throw new TypeError("connection refused");
    });
    const verdict = await withTimeout(
      harness.send({
        type: "JUDGE_REASON",
        purpose: "해시테이블 공부",
        title: "개발자 브이로그",
        description: "",
        userReason: "해시테이블 사례를 보려고",
      }),
      "JUDGE_REASON"
    );
    assert.equal(verdict.failOpen, true);
    assert.match(verdict.reason, /Gemini API/);
  }

  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () =>
      geminiVerdictResponse({ decision: "allow", score: 95, reason: "목적과 직접 연결됨" })
    );
    const verdict = await withTimeout(
      harness.send({
        type: "JUDGE_REASON",
        purpose: "해시테이블 공부",
        title: "해시 충돌 처리 사례 분석",
        description: "",
        userReason: "충돌 처리 사례를 확인하려고",
      }),
      "JUDGE_REASON"
    );
    assert.equal(verdict.decision, "allow");
    assert.equal(verdict.failOpen, undefined);
  }

  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "structure_goal",
                    args: {
                      rawPurpose: "해시테이블 공부",
                      mainGoal: "해시테이블의 원리와 구현 학습",
                      allowedTopics: ["해시 함수", "체이닝"],
                      borderlineTopics: ["코딩테스트 후기"],
                      blockedTopics: ["개발자 브이로그"],
                      completionCondition: "체이닝과 오픈 어드레싱 차이를 설명 가능",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    }));

    const response = await harness.send({
      type: "GENERATE_GOAL_PROFILE",
      purpose: "해시테이블 공부",
    });

    assert.equal(response.ok, true);
    assert.equal(response.goalProfile.rawPurpose, "해시테이블 공부");
    assert.equal(response.goalProfile.mainGoal, "해시테이블의 원리와 구현 학습");
    assert.deepEqual(Array.from(response.goalProfile.allowedTopics), ["해시 함수", "체이닝"]);
    assert.equal(response.goalProfile.completionCondition, "체이닝과 오픈 어드레싱 차이를 설명 가능");
  }

  {
    const harness = createHarness(baseStorage([]));
    // AI가 유효하지 않은 항목(예: allowedTopics가 숫자인 배열)을 준 경우 normalizeGoalProfile에서 rejected
    harness.setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "structure_goal",
                    args: {
                      rawPurpose: "해시테이블 공부",
                      mainGoal: "목표",
                      allowedTopics: [123, 456],
                      borderlineTopics: [],
                      blockedTopics: [],
                      completionCondition: "완료 조건",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    }));

    const response = await harness.send({
      type: "GENERATE_GOAL_PROFILE",
      purpose: "해시테이블 공부",
    });

    assert.equal(response.ok, false);
    assert.match(response.error, /유효하지 않습니다/);
  }

  {
    const popupSource = fs.readFileSync("popup/popup.js", "utf8");
    assert.equal(popupSource.includes("innerHTML"), false);
    assert.match(popupSource, /item\.textContent/);
  }

  console.log("background/popup 핵심 시나리오 18개 통과");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
