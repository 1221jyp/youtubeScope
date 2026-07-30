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
  let failStorageWrites = false;
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
          if (failStorageWrites) {
            chrome.runtime.lastError = { message: "storage write failed" };
            if (callback) callback();
            delete chrome.runtime.lastError;
            return;
          }
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
    setStorageWriteFailure(value) {
      failStorageWrites = value;
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
    jjg_session_status: "ended",
    jjg_session_started_at: 1000,
    jjg_session_ended_at: 2000,
    jjg_completion_result: { status: "partial", checkedAt: 2000 },
    jjg_goal_profile: {
      rawPurpose: "해시테이블 공부",
      mainGoal: "해시테이블 원리 학습",
      allowedTopics: ["해시 함수", "체이닝"],
      borderlineTopics: ["코딩테스트 후기"],
      blockedTopics: ["개발자 브이로그"],
      completionCondition: "충돌 처리 방식을 설명할 수 있음",
    },
    jjg_session_log: log.map((entry, index) => ({
      ts: 1100 + index,
      ...entry,
    })),
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

  // 종료되지 않은 세션은 같은 세션 캐시가 있어도 Gemini나 캐시 결과를 사용하지 않는다.
  for (const status of ["active", "ending"]) {
    const storage = baseStorage([
      { videoId: "a", title: "강의 1", action: "watched", related: true },
      { videoId: "b", title: "강의 2", action: "watched", related: true },
    ]);
    storage.jjg_session_status = status;
    storage.jjg_session_report = {
      sessionId: 100,
      generatedAt: 1,
      report: { summary: "잘못 반환되면 안 되는 캐시" },
    };
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "SESSION_NOT_ENDED");
    assert.equal(harness.fetchCount, 0);
  }

  {
    const storage = baseStorage([
      { videoId: "a", title: "강의 1", action: "watched", related: true },
      { videoId: "b", title: "강의 2", action: "watched", related: true },
    ]);
    storage.jjg_completion_result = null;
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "COMPLETION_RESULT_MISSING");
    assert.equal(harness.fetchCount, 0);
  }

  {
    const storage = baseStorage([
      { videoId: "a", title: "강의 1", action: "watched", related: true },
      { videoId: "b", title: "강의 2", action: "watched", related: true },
    ]);
    storage.jjg_completion_result = { status: "unknown", checkedAt: "잘못된 값" };
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "INVALID_COMPLETION_RESULT");
    assert.equal(harness.fetchCount, 0);
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
                      summary: "존재하지 않는 영상을 시청하며 이탈했습니다.",
                      firstDeviation: {
                        title: "존재하지 않는 영상",
                        reason: "목적에서 벗어났습니다.",
                      },
                      diversionPath: ["해시테이블 강의", "존재하지 않는 영상"],
                      patterns: ["존재하지 않는 영상으로 이동했습니다."],
                      recommendations: ["존재하지 않는 영상을 피하세요."],
                      encouragement: "다음에는 존재하지 않는 영상을 피할 수 있습니다.",
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
    assert.doesNotMatch(JSON.stringify(response.report), /존재하지 않는 영상/);
    assert.equal(response.report.firstDeviation.title, "개발자 브이로그");
    assert.equal(response.report.firstDeviation.reason, "학습과 무관");
    assert.deepEqual(Array.from(response.report.diversionPath), [
      "해시테이블 강의",
      "개발자 브이로그",
    ]);
    assert.equal(response.report.stats.actualDeviations, 1);
    assert.equal(response.report.stats.leftAnyway, 1);
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
    assert.equal(response.report.stats.actualDeviations, 0);
    assert.equal(response.report.stats.wentBack, 1);
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
    assert.equal(response.report.stats.approvedReason, 1);
    assert.equal(response.report.stats.actualDeviations, 0);
  }

  // 다른 sessionId의 left_anyway는 현재 세션 증거와 집계에서 제외한다.
  {
    const harness = createHarness(
      baseStorage([
        {
          sessionId: 100,
          videoId: "a",
          title: "현재 강의 1",
          action: "watched",
          initialVerdict: { decision: "allow", score: 90, reason: "목적 관련" },
        },
        {
          sessionId: 999,
          videoId: "foreign",
          title: "다른 세션 브이로그",
          action: "left_anyway",
          initialVerdict: { decision: "block", score: 10, reason: "목적과 무관" },
        },
        {
          sessionId: 100,
          videoId: "invalid",
          title: "잘못된 로그",
          action: "unknown_action",
        },
        {
          sessionId: 100,
          videoId: "b",
          title: "현재 강의 2",
          action: "watched",
          initialVerdict: { decision: "allow", score: 95, reason: "목적 관련" },
        },
      ])
    );
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, true);
    assert.equal(response.report.stats.actualDeviations, 0);
    assert.equal(response.report.firstDeviation.title, "");
    assert.equal(response.report.summary.includes("다른 세션 브이로그"), false);
  }

  // blocked와 skipped는 별도 횟수만 남기고 실제 이탈에는 포함하지 않는다.
  {
    const harness = createHarness(
      baseStorage([
        {
          videoId: "a",
          title: "관련 강의",
          action: "watched",
          related: true,
        },
        {
          videoId: "b",
          title: "차단 영상",
          action: "blocked",
          related: false,
          reason: "목적과 무관",
        },
        {
          videoId: "c",
          title: "판정 실패 영상",
          action: "skipped",
          related: true,
          reason: "AI 장애",
        },
      ])
    );
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, true);
    assert.equal(response.report.stats.actualDeviations, 0);
    assert.equal(response.report.stats.blocked, 1);
    assert.equal(response.report.stats.skipped, 1);
  }

  // 정규화된 사용자 이유·AI 설명·goalProfile·완료 결과가 Gemini 입력에 포함된다.
  {
    const harness = createHarness(
      baseStorage([
        {
          sessionId: 100,
          videoId: "a",
          title: "해시테이블 강의",
          action: "watched",
          initialVerdict: { decision: "allow", score: 92, reason: "목표와 직접 관련" },
        },
        {
          sessionId: 100,
          videoId: "b",
          title: "코딩테스트 후기",
          action: "approved_reason",
          initialVerdict: { decision: "ask_reason", score: 55, reason: "간접 관련" },
          userReason: "해시테이블 출제 사례를 확인하려고",
          reasonVerdict: { accepted: true, explanation: "목적과 연결되는 구체적인 이유" },
        },
      ])
    );
    let prompt = "";
    harness.setFetch(async (_url, options) => {
      const request = JSON.parse(options.body);
      prompt = request.contents[0].parts[0].text;
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
                        recommendations: [],
                        encouragement: "잘 진행했습니다.",
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
    });
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT", force: true });
    assert.equal(response.ok, true);
    assert.match(prompt, /해시테이블 출제 사례를 확인하려고/);
    assert.match(prompt, /목적과 연결되는 구체적인 이유/);
    assert.match(prompt, /"decision":"ask_reason"/);
    assert.match(prompt, /"score":55/);
    assert.match(prompt, /"initialReason":"간접 관련"/);
    assert.match(prompt, /충돌 처리 방식을 설명할 수 있음/);
    assert.match(prompt, /"status":"partial"/);
    assert.match(prompt, /"startedAt":1000/);
    assert.match(prompt, /"endedAt":2000/);
  }

  // 저장 실패는 성공 응답으로 위장하지 않는다.
  {
    const harness = createHarness(
      baseStorage([
        { videoId: "a", title: "강의 1", action: "watched", related: true },
        { videoId: "b", title: "강의 2", action: "watched", related: true },
      ])
    );
    harness.setStorageWriteFailure(true);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT", force: true });
    assert.equal(response.ok, false);
    assert.equal(response.code, "REPORT_SAVE_FAILED");
    assert.equal(harness.storage.jjg_session_report, undefined);
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
    assert.match(popupSource, /SESSION_STATUS\.ENDED/);
    assert.match(popupSource, /normalizeCompletionResult/);
  }

  console.log("background/popup 핵심 시나리오 25개 통과");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
