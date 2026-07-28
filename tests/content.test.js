// content script 전체를 manifest 순서대로 로드해서, 모듈 분리로 생기기 쉬운
// "아직 로드되지 않은 모듈 참조"(ReferenceError/undefined 구조 분해)를 잡는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const CONTENT_FILES = manifest.content_scripts.at(-1).js;

// 모듈이 로드되고 부팅되는지만 보면 되므로 DOM은 최소한으로 흉내 낸다.
function createStubElement() {
  const el = {
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    disabled: false,
    style: {},
    appendChild() {},
    remove() {},
    focus() {},
    addEventListener() {},
    classList: { add() {} },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };
  el.querySelector = () => createStubElement();
  el.querySelectorAll = () => [];
  return el;
}

function createContext(storage) {
  const document = {
    body: createStubElement(),
    getElementById: () => null,
    querySelector: () => createStubElement(),
    createElement: () => createStubElement(),
    addEventListener() {},
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    addEventListener() {}, // window.addEventListener
    removeEventListener() {},
    document,
    location: { href: "https://www.youtube.com/" },
    history: { length: 1, back() {} },
    URL,
    Set,
    Promise,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    chrome: {
      runtime: {
        id: "test-extension",
        sendMessage(message, callback) {
          callback({ related: true, reason: "" });
        },
      },
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
    },
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function loadContentScripts(storage = {}) {
  const context = createContext(storage);
  for (const file of CONTENT_FILES) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  return context;
}

function run() {
  // 1. 목적이 없는 상태에서 전체 로드 + 부팅 (목적 선언 모달 경로)
  const fresh = loadContentScripts({});
  for (const name of [
    "JJG_SCHEMA",
    "JJG_STORAGE",
    "JJG_SELECTORS",
    "JJG_MESSAGING",
    "JJG_UI",
    "JJG_LOG",
    "JJG_NAV",
    "JJG_SESSION",
    "JJG_REASON_FLOW",
    "JJG_JUDGE_FLOW",
  ]) {
    assert.ok(fresh[name], `${name}이 등록되지 않았습니다.`);
  }

  // 2. 목적이 이미 있는 상태에서 부팅 (판정 파이프라인 경로)
  loadContentScripts({ jjg_purpose: "해시테이블 공부", jjg_session_log: [] });

  // 3. URL 파싱은 /watch에서만 videoId를 돌려준다.
  const { getVideoIdFromUrl } = fresh.JJG_NAV;
  assert.equal(getVideoIdFromUrl("https://www.youtube.com/watch?v=abc123"), "abc123");
  assert.equal(getVideoIdFromUrl("https://www.youtube.com/"), null);
  assert.equal(getVideoIdFromUrl("https://www.youtube.com/results?search_query=v"), null);
  assert.equal(getVideoIdFromUrl("not-a-url"), null);

  // 4. 로그는 추가한 항목의 인덱스를 돌려주고, 그 인덱스로 갱신할 수 있어야 한다.
  //    (차단 시점에 기록하고 사용자 선택으로 갱신하는 흐름의 핵심)
  return (async () => {
    const storage = {};
    const context = loadContentScripts(storage);
    const { appendLog, updateLogEntry } = context.JJG_LOG;

    assert.equal(await appendLog({ videoId: "a", action: "watched" }), 0);
    assert.equal(await appendLog({ videoId: "b", action: "blocked" }), 1);

    await updateLogEntry(1, { action: "approved_reason", userReason: "이유" });
    assert.equal(storage.jjg_session_log[1].action, "approved_reason");
    assert.equal(storage.jjg_session_log[1].userReason, "이유");

    await updateLogEntry(99, { action: "watched" }); // 없는 인덱스는 조용히 무시
    assert.equal(storage.jjg_session_log.length, 2);

    console.log("content script 로드/동작 시나리오 4개 통과");
  })();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
