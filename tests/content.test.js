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
    MutationObserver: class {
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

function createInteractiveDocument() {
  function findById(node, id) {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }

  function createElement(tagName) {
    const listeners = {};
    const element = {
      tagName: String(tagName).toUpperCase(),
      id: "",
      className: "",
      textContent: "",
      children: [],
      parentNode: null,
      hidden: false,
      disabled: false,
      dataset: {},
      classList: {
        add(className) {
          element.className = `${element.className} ${className}`.trim();
        },
      },
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      remove() {
        if (!element.parentNode) return;
        element.parentNode.children = element.parentNode.children.filter(
          (child) => child !== element
        );
        element.parentNode = null;
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      querySelector(selector) {
        return selector.startsWith("#") ? findById(element, selector.slice(1)) : null;
      },
      click() {
        if (element.disabled || !listeners.click) return undefined;
        return listeners.click();
      },
    };
    return element;
  }

  const document = {
    createElement,
    body: null,
    getElementById(id) {
      return findById(document.body, id);
    },
  };
  document.body = createElement("body");
  return document;
}

function allText(node) {
  return [node.textContent, ...node.children.flatMap(allText)].filter(Boolean).join(" ");
}

function allTags(node) {
  return [node.tagName, ...node.children.flatMap(allTags)];
}

function createCompletionHarness({
  status = "ending",
  purpose = "해시테이블 공부",
  goalProfile = null,
} = {}) {
  const document = createInteractiveDocument();
  const storage = {
    jjg_purpose: purpose,
    jjg_goal_profile: goalProfile,
  };
  const context = vm.createContext({
    console,
    document,
    Promise,
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync("shared/schema.js", "utf8"), context, {
    filename: "shared/schema.js",
  });
  context.JJG_STORAGE = {
    async get(keys) {
      const values = {};
      keys.forEach((key) => {
        values[key] = storage[key];
      });
      return values;
    },
  };
  context.JJG_SESSION = {
    async getStatus() {
      return status;
    },
  };
  vm.runInContext(fs.readFileSync("content/completion.js", "utf8"), context, {
    filename: "content/completion.js",
  });
  return { context, document };
}

async function testCompletionUI() {
  // 1~3. ending에서만 표시한다.
  for (const [status, expected] of [
    ["active", false],
    ["ending", true],
    ["ended", false],
    [null, false],
  ]) {
    const { context, document } = createCompletionHarness({ status });
    assert.equal(
      await context.JJG_COMPLETION.askCompletion({ onConfirm() {}, onCancel() {} }),
      expected
    );
    assert.equal(Boolean(document.getElementById("jjg-completion-backdrop")), expected);
  }

  // 4. 정상 goalProfile 표시.
  {
    const { context, document } = createCompletionHarness({
      goalProfile: {
        rawPurpose: "해시테이블 공부",
        mainGoal: "해시테이블의 원리와 구현 학습",
        allowedTopics: [],
        borderlineTopics: [],
        blockedTopics: [],
        completionCondition: "체이닝과 오픈 어드레싱의 차이를 설명할 수 있음",
      },
    });
    await context.JJG_COMPLETION.askCompletion({ onConfirm() {}, onCancel() {} });
    const text = allText(document.body);
    assert.match(text, /해시테이블의 원리와 구현 학습/);
    assert.match(text, /체이닝과 오픈 어드레싱의 차이/);
  }

  // 5~6. profile 또는 completionCondition이 없으면 purpose/mainGoal 순으로 fallback한다.
  {
    const noProfile = createCompletionHarness({ purpose: "SQL 공부" });
    await noProfile.context.JJG_COMPLETION.askCompletion({ onConfirm() {}, onCancel() {} });
    assert.match(allText(noProfile.document.body), /SQL 공부/);

    const noCondition = createCompletionHarness({
      goalProfile: {
        rawPurpose: "SQL 공부",
        mainGoal: "JOIN 원리 학습",
        allowedTopics: [],
        borderlineTopics: [],
        blockedTopics: [],
        completionCondition: "",
      },
    });
    await noCondition.context.JJG_COMPLETION.askCompletion({ onConfirm() {}, onCancel() {} });
    assert.match(allText(noCondition.document.body), /JOIN 원리 학습/);
  }

  async function choose(status) {
    const { context, document } = createCompletionHarness();
    const received = [];
    await context.JJG_COMPLETION.askCompletion({
      async onConfirm(value) {
        received.push(value);
        return true;
      },
      onCancel() {
        throw new Error("취소 callback이 호출되면 안 됨");
      },
    });
    const row = document.getElementById("jjg-completion-choices");
    const button = row.children.find((item) => item.dataset.completionStatus === status);
    await button.click();
    return received;
  }

  // 7~9. 세 가지 결과 enum을 그대로 한 번 전달한다.
  assert.deepEqual(await choose("achieved"), ["achieved"]);
  assert.deepEqual(await choose("partial"), ["partial"]);
  assert.deepEqual(await choose("not_achieved"), ["not_achieved"]);

  // 10. 계속 보기는 onCancel만 호출한다.
  {
    const { context, document } = createCompletionHarness();
    let confirms = 0;
    let cancels = 0;
    await context.JJG_COMPLETION.askCompletion({
      onConfirm() {
        confirms += 1;
      },
      async onCancel() {
        cancels += 1;
        return true;
      },
    });
    await document.getElementById("jjg-completion-cancel").click();
    assert.equal(confirms, 0);
    assert.equal(cancels, 1);
  }

  // 11. 빠른 중복 클릭은 callback을 한 번만 실행한다.
  {
    const { context, document } = createCompletionHarness();
    let calls = 0;
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await context.JJG_COMPLETION.askCompletion({
      async onConfirm() {
        calls += 1;
        await pending;
        return true;
      },
      onCancel() {},
    });
    const button = document.getElementById("jjg-completion-choices").children[0];
    const first = button.click();
    button.click();
    assert.equal(calls, 1);
    release();
    await first;
  }

  // 12. 이미 표시된 모달은 중복 생성하지 않는다.
  {
    const { context, document } = createCompletionHarness();
    assert.equal(await context.JJG_COMPLETION.askCompletion({}), true);
    assert.equal(await context.JJG_COMPLETION.askCompletion({}), false);
    assert.equal(
      document.body.children.filter((child) => child.id === "jjg-completion-backdrop").length,
      1
    );
  }

  // 13. callback 실패 시 모달과 오류를 유지한다.
  {
    const { context, document } = createCompletionHarness();
    await context.JJG_COMPLETION.askCompletion({
      async onConfirm() {
        return false;
      },
      onCancel() {},
    });
    await document.getElementById("jjg-completion-choices").children[0].click();
    assert.ok(document.getElementById("jjg-completion-backdrop"));
    const error = document.getElementById("jjg-completion-error");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /저장하지 못했습니다/);
  }

  // 14. 사용자/AI 문자열은 텍스트 노드로만 표시한다.
  {
    const malicious = '<img src=x onerror="globalThis.attacked=true">';
    const maliciousCondition = "<script>globalThis.attacked=true</script>";
    const { context, document } = createCompletionHarness({
      purpose: malicious,
      goalProfile: {
        rawPurpose: malicious,
        mainGoal: malicious,
        allowedTopics: [],
        borderlineTopics: [],
        blockedTopics: [],
        completionCondition: maliciousCondition,
      },
    });
    await context.JJG_COMPLETION.askCompletion({});
    assert.match(allText(document.body), /<img src=x/);
    assert.match(allText(document.body), /<script>/);
    assert.equal(context.attacked, undefined);
    assert.equal(allTags(document.body).some((tag) => ["IMG", "SCRIPT"].includes(tag)), false);
  }

  // 15. callback 안의 저장 → ended → 리포트 순서를 모두 기다린 뒤 닫는다.
  {
    const { context, document } = createCompletionHarness();
    const events = [];
    await context.JJG_COMPLETION.askCompletion({
      async onConfirm() {
        events.push("completion_saved");
        await Promise.resolve();
        events.push("ended");
        await Promise.resolve();
        events.push("report_shown");
        return true;
      },
      onCancel() {},
    });
    await document.getElementById("jjg-completion-choices").children[0].click();
    assert.deepEqual(events, ["completion_saved", "ended", "report_shown"]);
    assert.equal(document.getElementById("jjg-completion-backdrop"), null);
  }
}

// 세션 종료 명세의 제약들이 실제로 지켜지는지 검증한다.
async function testSessionLifecycle() {
  const storage = {};
  const { JJG_SESSION, JJG_SCHEMA } = loadContentScripts(storage);
  const { SESSION_STATUS, COMPLETION_STATUS } = JJG_SCHEMA;

  // 5. 목표 설정 → active (goalProfile 전달)
  const sampleGoalProfile = {
    rawPurpose: "해시테이블 공부",
    mainGoal: "해시테이블의 원리와 구현 학습",
    allowedTopics: ["해시 함수", "체이닝"],
    borderlineTopics: ["코딩테스트 후기"],
    blockedTopics: ["개발자 브이로그"],
    completionCondition: "체이닝 설명 가능",
  };
  await JJG_SESSION.startNewSession("해시테이블 공부", sampleGoalProfile);
  assert.equal(storage.jjg_purpose, "해시테이블 공부");
  assert.equal(storage.jjg_session_status, SESSION_STATUS.ACTIVE);
  assert.equal(storage.jjg_session_ended_at, null);
  assert.deepEqual(storage.jjg_goal_profile, JJG_SCHEMA.normalizeGoalProfile(sampleGoalProfile).value);
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

  // 새 세션을 시작하면 active로 돌아가고 이전 기록과 goalProfile이 교체된다.
  await JJG_SESSION.startNewSession("SQL 공부");
  assert.equal(storage.jjg_purpose, "SQL 공부");
  assert.equal(storage.jjg_goal_profile, null, "이전 세션의 goalProfile이 재사용되지 않아야 함");
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

    assert.equal(
      await appendLog({ videoId: "a", title: "영상 A", action: "watched", ts: 1000 }),
      0
    );
    assert.equal(
      await appendLog({ videoId: "b", title: "영상 B", action: "blocked", ts: 1001 }),
      1
    );

    await updateLogEntry(1, { action: "approved_reason", userReason: "이유" });
    assert.equal(storage.jjg_session_log[1].action, "approved_reason");
    assert.equal(storage.jjg_session_log[1].userReason, "이유");

    await updateLogEntry(99, { action: "watched" }); // 없는 인덱스는 조용히 무시
    assert.equal(storage.jjg_session_log.length, 2);

    await testSessionLifecycle();
    await testCompletionUI();
    console.log("content script 및 목표 달성 확인 시나리오 24개 통과");
  })();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
