const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

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
        message: {
          tool_calls: [
            {
              function: {
                arguments: {
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
    runtime: {
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
  vm.runInContext(fs.readFileSync("background.js", "utf8"), context);

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

function baseStorage(log) {
  return {
    jjg_purpose: "해시테이블 공부",
    jjg_session_id: 100,
    jjg_session_log: log,
    jjg_ollama_model: "test-model",
    jjg_ollama_url: "http://localhost:11434",
  };
}

async function run() {
  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
                  tool_calls: [{ function: { arguments: { related: "false", reason: "목적과 무관" } } }],
        },
      }),
      text: async () => "",
    }));
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "해시테이블 공부",
      videoId: "video-1",
      title: "해시테이블 강의",
      description: "",
    });
    assert.equal(verdict.related, false);
    assert.equal(
      harness.storage.jjg_verdict_cache["v3||해시테이블 공부||video-1"].related,
      false
    );
  }

  {
    const harness = createHarness(baseStorage([]));
    harness.setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          tool_calls: [
            {
              function: {
                arguments: { related: true, reason: "The video seems useful." },
              },
            },
          ],
        },
      }),
      text: async () => "",
    }));
    const verdict = await harness.send({
      type: "JUDGE_VIDEO",
      purpose: "자료구조 해시테이블 공부",
      videoId: "vlog-1",
      title: "개발자 브이로그: 회사에서의 하루",
      description: "",
    });
    assert.equal(verdict.related, false);
    assert.equal(verdict.guardrail, true);
    assert.match(verdict.reason, /브이로그/);
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
        message: {
          tool_calls: [
            {
              function: {
                arguments: {
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
    assert.match(response.error, /Ollama 서버/);
  }

  {
    const storage = baseStorage([
      { title: "강의 1", action: "watched", related: true },
      { title: "강의 2", action: "watched", related: true },
    ]);
    storage.jjg_ollama_model = "";
    const harness = createHarness(storage);
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.code, "MODEL_NOT_SET");
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
      json: async () => ({ message: { content: "구조화되지 않은 답변" } }),
      text: async () => "",
    }));
    const response = await harness.send({ type: "GENERATE_SESSION_REPORT" });
    assert.equal(response.ok, false);
    assert.match(response.error, /응답 형식/);
  }

  {
    const popupSource = fs.readFileSync("popup.js", "utf8");
    assert.equal(popupSource.includes("innerHTML"), false);
    assert.match(popupSource, /item\.textContent/);
  }

  console.log("background/popup 핵심 시나리오 11개 통과");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
