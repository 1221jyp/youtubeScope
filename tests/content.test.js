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
    replaceChildren() {},
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

// 세션 종료 명세의 제약들이 실제로 지켜지는지 검증한다.
async function testSessionLifecycle() {
  const storage = {};
  const { JJG_SESSION, JJG_SCHEMA } = loadContentScripts(storage);
  const { SESSION_STATUS, COMPLETION_STATUS } = JJG_SCHEMA;

  // 5. 목표 설정 → active
  await JJG_SESSION.startNewSession("해시테이블 공부");
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ACTIVE);
  assert.equal(storage.jjg_session_ended_at, null);
  assert.equal(await JJG_SESSION.isFocusing(), true);

  // 로그가 있어도 종료 버튼이 지우지 않는지 확인하기 위해 미리 채워둔다.
  storage.jjg_session_log = [{ videoId: "a", action: "watched" }];

  // 6. 몰입 종료 → ending. 로그는 그대로 남고, 판정은 멈춘다.
  assert.equal(await JJG_SESSION.beginEnding(), true);
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ENDING);
  assert.equal(storage.jjg_session_log.length, 1, "종료 버튼이 로그를 지우면 안 된다");
  assert.equal(await JJG_SESSION.isFocusing(), false);

  // 7. 종료 버튼 중복 클릭은 무시된다 (이미 active가 아님).
  assert.equal(await JJG_SESSION.beginEnding(), false);
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ENDING);

  // 8. 잘못된 달성 결과로는 ended가 되지 않는다.
  assert.equal(await JJG_SESSION.completeSession("아무거나"), false);
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ENDING);
  assert.equal(storage.jjg_completion_result, null, "결과 저장 전에 ended로 넘어가면 안 된다");

  // 확인을 취소하면 몰입 상태로 되돌아간다.
  assert.equal(await JJG_SESSION.cancelEnding(), true);
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ACTIVE);

  // 9. 목표 확인 완료 → 결과 저장 후 ended + endedAt
  await JJG_SESSION.beginEnding();
  assert.equal(await JJG_SESSION.completeSession(COMPLETION_STATUS.PARTIAL), true);
  assert.equal(storage.jjg_completion_result.status, COMPLETION_STATUS.PARTIAL);
  assert.equal(typeof storage.jjg_completion_result.checkedAt, "number");
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ENDED);
  assert.equal(typeof storage.jjg_session_ended_at, "number");
  assert.equal(storage.jjg_session_log.length, 1, "종료 후에도 로그는 남아 있어야 한다");

  // ended 상태에서는 판정하지 않고, 중복 완료도 무시된다.
  assert.equal(await JJG_SESSION.isFocusing(), false);
  assert.equal(await JJG_SESSION.completeSession(COMPLETION_STATUS.ACHIEVED), false);

  // 새 세션을 시작하면 active로 돌아가고 이전 기록이 정리된다.
  await JJG_SESSION.startNewSession("SQL 공부");
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ACTIVE);
  assert.equal(storage.jjg_session_ended_at, null);
  assert.equal(storage.jjg_completion_result, null);
  assert.equal(storage.jjg_session_log.length, 0);
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

    await testSessionLifecycle();
    console.log("content script 로드/동작 시나리오 9개 통과");
  })();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
