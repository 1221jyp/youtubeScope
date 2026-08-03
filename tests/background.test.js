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
  "background/next-session-rules.js",
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
    context,
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

function nextRulesStorage(log) {
  const storage = baseStorage(log);
  storage.jjg_session_report = {
    sessionId: 100,
    generatedAt: 2100,
    report: {
      summary: "증거 중심 리포트",
      firstDeviation: { title: "", reason: "" },
      diversionPath: [],
      stats: {
        watched: 0,
        approvedReason: 0,
        leftAnyway: 0,
        wentBack: 0,
        blocked: 0,
        skipped: 0,
        actualDeviations: 0,
      },
    },
  };
  return storage;
}

function geminiRulesResponse(rules) {
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
                  name: "next_session_rules",
                  args: { rules },
                },
              },
            ],
          },
        },
      ],
    }),
    text: async () => "",
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
        {
          entryId: "entry-a", videoId: "a", title: "해시테이블 강의",
          action: "watched", related: true, enteredAt: 1100, leftAt: 1400,
          dwellMs: 300, timeMeasurement: "measured",
          navigation: { source: "search" },
        },
        {
          entryId: "entry-b", videoId: "b", title: "개발자 브이로그",
          action: "left_anyway", related: false, reason: "학습과 무관",
          enteredAt: 1400, leftAt: 1800, dwellMs: 400, timeMeasurement: "measured",
          navigation: { source: "recommendation", fromEntryId: "entry-a" },
        },
      ])
    );
    harness.storage.jjg_next_session_rules = [
      { rule: "이전 세션 규칙", evidence: "이전 세션 근거" },
    ];
    let timeReportPrompt = "";
    harness.setFetch(async (_url, options) => {
      timeReportPrompt = JSON.parse(options.body).contents[0].parts[0].text;
      return ({
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
                      timeStats: { trackedDwellMs: 999999 },
                      sourceStats: [{ source: "external", count: 99, dwellMs: 999999 }],
                      timeline: [{ title: "존재하지 않는 영상", navigationSource: "external" }],
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
      });
    });
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
    assert.equal(response.report.timeStats.trackedDwellMs, 700);
    assert.equal(response.report.timeStats.focusedDwellMs, 300);
    assert.equal(response.report.timeStats.deviationDwellMs, 400);
    assert.equal(response.report.timeStats.focusedRatio, 300 / 700);
    assert.equal(response.report.timeStats.deviationRatio, 400 / 700);
    assert.deepEqual(Array.from(response.report.sourceStats, (item) => item.source), [
      "search",
      "recommendation",
    ]);
    assert.deepEqual(Array.from(response.report.timeline, (item) => item.title), [
      "해시테이블 강의",
      "개발자 브이로그",
    ]);
    assert.equal(response.report.timeline[1].fromEntryId, "entry-a");
    assert.match(timeReportPrompt, /영상 페이지 체류시간/);
    assert.match(timeReportPrompt, /코드 계산 이동 원인 통계/);
    assert.match(timeReportPrompt, /unknown 이동 원인을 추측하지 않고/);
    assert.equal(harness.storage.jjg_session_report.sessionId, 100);
    assert.equal(harness.storage.jjg_next_session_rules, null);
    const countAfterFirst = harness.fetchCount;
    const cached = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(cached.cached, true);
    assert.equal(harness.fetchCount, countAfterFirst);

    harness.storage.jjg_session_id = 101;
    const nextSession = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(nextSession.cached, false);
    assert.equal(harness.storage.jjg_session_report.sessionId, 101);
  }

  // 시간·출처 통계는 action 의미에 따라 코드에서만 계산한다.
  {
    const harness = createHarness(baseStorage([]));
    const reportApi = harness.context.JJG_REPORT;
    const logs = [
      { title: "관련", action: "watched", dwellMs: 100, navigation: { source: "search" } },
      { title: "승인", action: "approved_reason", dwellMs: 200, navigation: { source: "search" } },
      { title: "이탈", action: "left_anyway", dwellMs: 300, navigation: { source: "recommendation" } },
      { title: "복귀", action: "went_back", dwellMs: 400, navigation: { source: "recommendation" } },
      { title: "차단", action: "blocked", dwellMs: 500, navigation: { source: "unknown" } },
      { title: "건너뜀", action: "skipped", dwellMs: null, navigation: { source: "unknown" } },
    ];
    const timeStats = reportApi.buildTimeStats({ startedAt: 0, endedAt: 2000 }, logs);
    assert.equal(timeStats.sessionDurationMs, 2000);
    assert.equal(timeStats.trackedDwellMs, 1500);
    assert.equal(timeStats.focusedDwellMs, 300);
    assert.equal(timeStats.approvedDwellMs, 200);
    assert.equal(timeStats.deviationDwellMs, 300);
    assert.equal(timeStats.untrackedMs, 500);
    const sourceStats = reportApi.buildSourceStats(logs);
    assert.equal(sourceStats.find((item) => item.source === "search").count, 2);
    assert.equal(sourceStats.find((item) => item.source === "recommendation").actualDeviations, 1);
    assert.equal(sourceStats.find((item) => item.source === "unknown").actualDeviations, 0);
    const quality = reportApi.buildDataQuality([
      { timeMeasurement: "unknown", dwellMs: null, navigation: { source: "unknown" } },
    ], {
      totalLogs: 1,
      invalidLogs: 0,
      timeStats: { sessionDurationMs: 100, trackedDwellMs: 200 },
    });
    assert.equal(quality.unknownTimeEntries, 1);
    assert.equal(quality.unknownNavigationEntries, 1);
    assert.match(quality.warnings.join(" "), /전체 세션 시간보다 깁니다/);
    const emptyTime = reportApi.buildTimeStats({ startedAt: 0, endedAt: 1000 }, [
      { action: "watched", dwellMs: null },
    ]);
    assert.equal(emptyTime.focusedRatio, null);
    assert.equal(emptyTime.deviationRatio, null);
    assert.equal(reportApi.buildEvidenceReport("공부", []).timeline.length, 0);
    assert.equal(reportApi.buildEvidenceReport("공부", [{
      ts: 1, title: "한 개", action: "watched", navigation: { source: "unknown" },
      timeMeasurement: "unknown", dwellMs: null,
    }]).timeline.length, 1);
    const legacyCached = reportApi.normalizeReport({
      summary: "기존 캐시",
      firstDeviation: { title: "", reason: "" },
      diversionPath: [], patterns: [], recommendations: [], encouragement: "",
    });
    assert.equal(legacyCached.timeStats, null);
    assert.deepEqual(Array.from(legacyCached.timeline), []);
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
    const storage = baseStorage([
      { videoId: "a", title: "강의 1", action: "watched", related: true },
      { videoId: "b", title: "강의 2", action: "watched", related: true },
    ]);
    storage.jjg_next_session_rules = [{ rule: "기존 규칙", evidence: "기존 근거" }];
    const harness = createHarness(storage);
    harness.setStorageWriteFailure(true);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT", force: true });
    assert.equal(response.ok, false);
    assert.equal(response.code, "REPORT_SAVE_FAILED");
    assert.equal(harness.storage.jjg_session_report, undefined);
    assert.equal(harness.storage.jjg_next_session_rules[0].rule, "기존 규칙");
  }

  // 다음 세션 규칙: 종료 상태와 완료 결과, 현재 세션 리포트가 모두 필요하다.
  for (const status of ["active", "ending"]) {
    const storage = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    storage.jjg_session_status = status;
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.code, "SESSION_NOT_ENDED");
    assert.equal(harness.fetchCount, 0);
  }

  {
    const missing = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    missing.jjg_completion_result = null;
    const missingHarness = createHarness(missing);
    const missingResponse = await missingHarness.send({
      type: "GENERATE_NEXT_SESSION_RULES",
    });
    assert.equal(missingResponse.code, "COMPLETION_RESULT_MISSING");
    assert.equal(missingHarness.fetchCount, 0);

    const invalid = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    invalid.jjg_completion_result = { status: "invalid", checkedAt: 2000 };
    const invalidHarness = createHarness(invalid);
    const invalidResponse = await invalidHarness.send({
      type: "GENERATE_NEXT_SESSION_RULES",
    });
    assert.equal(invalidResponse.code, "INVALID_COMPLETION_RESULT");
    assert.equal(invalidHarness.fetchCount, 0);
  }

  for (const report of [
    null,
    { sessionId: 999, generatedAt: 1, report: { summary: "이전 세션" } },
  ]) {
    const storage = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    storage.jjg_session_report = report;
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.code, "SESSION_REPORT_MISSING");
    assert.equal(harness.fetchCount, 0);
  }

  // null은 미생성 상태이므로 Gemini를 호출해 새 규칙을 생성한다.
  {
    const storage = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    storage.jjg_next_session_rules = null;
    const evidence = "브이로그에서 left_anyway가 기록되어 실제 이탈로 확인됨.";
    const harness = createHarness(storage);
    harness.setFetch(async () =>
      geminiRulesResponse([{ rule: "브이로그를 열기 전에 목적을 확인한다.", evidence }])
    );
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.ok, true);
    assert.equal(response.cached, undefined);
    assert.equal(harness.fetchCount, 1);
  }

  // []는 생성 완료된 빈 결과다. 반복 요청에도 캐시를 반환하고 Gemini를 호출하지 않는다.
  {
    const storage = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    storage.jjg_next_session_rules = [];
    const harness = createHarness(storage);
    const first = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    const second = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(first.ok, true);
    assert.equal(first.cached, true);
    assert.deepEqual(Array.from(first.rules), []);
    assert.equal(second.cached, true);
    assert.deepEqual(Array.from(second.rules), []);
    assert.equal(harness.fetchCount, 0);
  }

  // 항목이 있는 유효한 배열도 기존 생성 결과로 반환한다.
  {
    const storage = nextRulesStorage([
      { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
    ]);
    storage.jjg_next_session_rules = [
      {
        rule: "브이로그를 열기 전에 목적을 확인한다.",
        evidence: "브이로그에서 left_anyway가 기록되어 실제 이탈로 확인됨.",
      },
    ];
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.ok, true);
    assert.equal(response.cached, true);
    assert.equal(response.rules.length, 1);
    assert.equal(response.rules[0].rule, storage.jjg_next_session_rules[0].rule);
    assert.equal(harness.fetchCount, 0);
  }

  // watched와 skipped뿐이면 구체적 행동 증거가 없으므로 Gemini 없이 []를 저장한다.
  {
    const harness = createHarness(
      nextRulesStorage([
        { videoId: "a", title: "관련 강의", action: "watched", related: true },
        { videoId: "b", title: "판정 실패", action: "skipped", related: true },
      ])
    );
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.ok, true);
    assert.deepEqual(Array.from(response.rules), []);
    assert.equal(harness.fetchCount, 0);
    assert.deepEqual(Array.from(harness.storage.jjg_next_session_rules), []);
  }

  // action 의미, evidence exact match, 일반 조언, 중복, 최대 3개를 함께 검증한다.
  {
    const storage = nextRulesStorage([
      {
        videoId: "left",
        title: "코딩테스트 후기",
        action: "left_anyway",
        related: false,
      },
      {
        videoId: "approved",
        title: "면접 후기",
        action: "approved_reason",
        initialVerdict: { decision: "ask_reason", score: 55, reason: "간접 관련" },
        userReason: "출제 사례를 확인하려고",
        reasonVerdict: { accepted: true, explanation: "목표와 연결되는 이유" },
      },
      {
        videoId: "back",
        title: "개발자 브이로그",
        action: "went_back",
        related: false,
      },
      {
        videoId: "blocked",
        title: "쇼핑 영상",
        action: "blocked",
        related: false,
      },
      {
        videoId: "skipped",
        title: "AI 장애 영상",
        action: "skipped",
        related: true,
      },
    ]);
    storage.jjg_session_report.report.stats = {
      watched: 0,
      approvedReason: 1,
      leftAnyway: 1,
      wentBack: 1,
      blocked: 1,
      skipped: 1,
      actualDeviations: 1,
    };
    storage.jjg_session_report.report.firstDeviation = {
      title: "코딩테스트 후기",
      reason: "목적과 무관",
    };
    storage.jjg_session_report.report.diversionPath = [
      "코딩테스트 후기",
      "개발자 브이로그",
    ];

    const leftEvidence =
      "코딩테스트 후기에서 left_anyway가 기록되어 실제 이탈로 확인됨.";
    const approvedEvidence =
      "면접 후기은(는) 사용자가 이유를 설명하고 AI가 승인해 시청함. 사용자 이유: 출제 사례를 확인하려고 승인 근거: 목표와 연결되는 이유";
    const backEvidence =
      "개발자 브이로그 경고 후 went_back을 선택해 이탈을 방지함.";
    const blockedEvidence =
      "쇼핑 영상은(는) 관련 없다고 차단되었으며 실제 시청 이탈로는 집계하지 않음.";

    const harness = createHarness(storage);
    let prompt = "";
    harness.setFetch(async (_url, options) => {
      prompt = JSON.parse(options.body).contents[0].parts[0].text;
      return geminiRulesResponse([
        {
          rule: "후기 영상을 열기 전에 현재 목표와 연결되는 이유를 한 문장으로 확인한다.",
          evidence: leftEvidence,
        },
        {
          rule: "존재하지 않는 행동을 한다.",
          evidence: "실제 evidenceFacts에 없는 문장",
        },
        { rule: "집중하세요.", evidence: leftEvidence },
        {
          rule: "이유가 필요한 영상은 시청 목적을 먼저 적고 승인을 확인한다.",
          evidence: approvedEvidence,
        },
        {
          rule: "후기 영상을 열기 전에 현재 목표와 연결되는 이유를 한 문장으로 확인한다.",
          evidence: leftEvidence,
        },
        {
          rule: "브이로그 경고가 나오면 이전처럼 돌아가기를 선택한다.",
          evidence: backEvidence,
        },
        {
          rule: "차단된 쇼핑 주제는 열기 전에 목적과 직접 관련되는지 확인한다.",
          evidence: blockedEvidence,
        },
      ]);
    });

    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.ok, true);
    assert.equal(response.rules.length, 3);
    assert.deepEqual(
      Array.from(response.rules, (item) => item.evidence),
      [leftEvidence, approvedEvidence, backEvidence]
    );
    assert.equal(response.rules.some((item) => /집중하세요/.test(item.rule)), false);
    assert.equal(response.rules.some((item) => /존재하지 않는/.test(item.rule)), false);
    assert.equal(
      JSON.stringify(harness.storage.jjg_next_session_rules),
      JSON.stringify(response.rules)
    );
    assert.match(prompt, /left_anyway가 기록되어 실제 이탈/);
    assert.match(prompt, /AI가 승인해 시청함/);
    assert.match(prompt, /went_back을 선택해 이탈을 방지/);
    assert.match(prompt, /차단되었으며 실제 시청 이탈로는 집계하지 않음/);
    assert.equal(prompt.includes("AI 장애 영상"), false);
  }

  // 스키마가 거부하는 AI 출력은 저장하지 않는다.
  {
    const harness = createHarness(
      nextRulesStorage([
        { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
      ])
    );
    harness.setFetch(async () => geminiRulesResponse(["잘못된 규칙 항목"]));
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.code, "INVALID_RULES");
    assert.equal(harness.storage.jjg_next_session_rules, undefined);
  }

  // 저장 실패는 성공으로 응답하지 않는다.
  {
    const harness = createHarness(
      nextRulesStorage([
        { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
      ])
    );
    const evidence = "브이로그에서 left_anyway가 기록되어 실제 이탈로 확인됨.";
    harness.setFetch(async () =>
      geminiRulesResponse([{ rule: "브이로그를 열기 전에 목적을 확인한다.", evidence }])
    );
    harness.setStorageWriteFailure(true);
    const response = await harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    assert.equal(response.code, "RULES_SAVE_FAILED");
  }

  // 같은 세션의 동시 요청은 하나의 Gemini 호출을 공유한다.
  {
    const harness = createHarness(
      nextRulesStorage([
        { videoId: "a", title: "브이로그", action: "left_anyway", related: false },
      ])
    );
    const evidence = "브이로그에서 left_anyway가 기록되어 실제 이탈로 확인됨.";
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    harness.setFetch(async () => {
      await pending;
      return geminiRulesResponse([
        { rule: "브이로그를 열기 전에 목적을 확인한다.", evidence },
      ]);
    });
    const first = harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    const second = harness.send({ type: "GENERATE_NEXT_SESSION_RULES" });
    for (let attempt = 0; attempt < 10 && harness.fetchCount === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(harness.fetchCount, 1);
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    assert.equal(firstResponse.ok, true);
    assert.equal(JSON.stringify(firstResponse), JSON.stringify(secondResponse));
    assert.equal(harness.fetchCount, 1);
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

  console.log("background/popup/다음 세션 규칙 핵심 시나리오 통과");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
