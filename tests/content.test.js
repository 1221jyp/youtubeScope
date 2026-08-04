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
      replaceChildren(...children) {
        element.children.forEach((child) => {
          child.parentNode = null;
        });
        element.children = [];
        children.forEach((child) => element.appendChild(child));
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

function testNextSessionRulesView() {
  const document = createInteractiveDocument();
  const context = vm.createContext({ console, document });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync("shared/report-view.js", "utf8"), context, {
    filename: "shared/report-view.js",
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const maliciousRule = '<img src=x onerror="globalThis.attacked=true"> 시청 전에 목적 확인';
  const maliciousEvidence = "<script>globalThis.attacked=true</script>";
  context.JJG_REPORT_VIEW.renderNextSessionRules(container, [
    { rule: maliciousRule, evidence: maliciousEvidence },
  ]);

  const text = allText(container);
  assert.match(text, /다음 세션 맞춤 조언/);
  assert.match(text, /자동으로 적용되지 않습니다/);
  assert.match(text, /조언/);
  assert.match(text, /<img src=x/);
  assert.match(text, /근거/);
  assert.match(text, /<script>/);
  assert.doesNotMatch(text, /다음 세션 규칙/);
  assert.equal(context.attacked, undefined);
  assert.equal(allTags(container).some((tag) => ["IMG", "SCRIPT"].includes(tag)), false);

  context.JJG_REPORT_VIEW.renderNextSessionRules(container, []);
  assert.match(
    allText(container),
    /이번 세션에서는 제안할 만큼 구체적인 행동 근거가 없습니다\./
  );

  context.JJG_REPORT_VIEW.renderReport(container, {
    summary: "요약",
    hasActualDeviation: false,
    stats: {
      watched: 1,
      approvedReason: 0,
      wentBack: 1,
      blocked: 1,
      actualDeviations: 0,
    },
    timeline: [
      {
        title: '<img src=x onerror="globalThis.attacked=true">',
        navigationSource: "search",
        dwellMs: 240000,
        timeMeasurement: "estimated",
        action: "watched",
      },
      {
        title: "측정되지 않은 영상",
        navigationSource: "unknown",
        dwellMs: null,
        timeMeasurement: "unknown",
        action: "blocked",
      },
    ],
    timeStats: {
      sessionDurationMs: 300000,
      trackedDwellMs: 240000,
      focusedDwellMs: 240000,
      deviationDwellMs: 0,
      untrackedMs: 60000,
    },
    sourceStats: [{ source: "search", count: 1, actualDeviations: 0 }],
    dataQuality: { warnings: ["일부 영상의 체류시간을 측정하지 못했습니다."] },
    analysis: {
      focusAnalysis: { summary: "측정된 기록을 중심으로 집중 흐름을 분석했습니다." },
      preventionAnalysis: { summary: "돌아가기로 실제 이탈을 방지했습니다." },
    },
  });
  const noDeviationText = allText(container);
  assert.match(noDeviationText, /약 4분/);
  assert.match(noDeviationText, /체류시간 측정 불가/);
  assert.match(noDeviationText, /이동 원인 불명/);
  assert.match(noDeviationText, /<img src=x/);
  assert.match(noDeviationText, /이번 세션에서는 확인된 실제 이탈이 없습니다/);
  assert.match(noDeviationText, /집중 흐름 분석/);
  assert.match(noDeviationText, /돌아가기로 실제 이탈을 방지/);
  assert.doesNotMatch(noDeviationText, /첫 이탈 지점/);
  assert.doesNotMatch(noDeviationText, /주요 이탈 경로/);
  assert.doesNotMatch(noDeviationText, /실제 이탈 분석/);
  assert.equal(allTags(container).includes("IMG"), false);

  for (const stats of [
    { approvedReason: 1, actualDeviations: 0 },
    { wentBack: 1, actualDeviations: 0 },
    { blocked: 1, skipped: 1, actualDeviations: 0 },
  ]) {
    context.JJG_REPORT_VIEW.renderReport(container, {
      summary: "실제 이탈이 아닌 기록",
      hasActualDeviation: false,
      stats,
    });
    const actionOnlyText = allText(container);
    assert.doesNotMatch(actionOnlyText, /첫 이탈 지점/);
    assert.doesNotMatch(actionOnlyText, /주요 이탈 경로/);
  }

  context.JJG_REPORT_VIEW.renderReport(container, {
    summary: "실제 이탈이 있는 세션",
    hasActualDeviation: true,
    stats: { actualDeviations: 1 },
    firstDeviation: {
      title: "개발자 브이로그",
      reason: "목적과 무관",
      dwellMs: 180000,
      timeMeasurement: "estimated",
      navigationSource: "recommendation",
    },
    diversionPath: ["해시테이블 강의", "개발자 브이로그"],
    analysis: {
      deviationAnalysis: { summary: "이번 세션에서 한 번의 실제 이탈이 확인되었습니다." },
    },
  });
  const deviationText = allText(container);
  assert.match(deviationText, /첫 이탈 지점/);
  assert.match(deviationText, /주요 이탈 경로/);
  assert.match(deviationText, /해시테이블 강의.*개발자 브이로그/);
  assert.match(deviationText, /실제 이탈 분석/);
  assert.match(deviationText, /약 3분/);

  const viewSource = fs.readFileSync("shared/report-view.js", "utf8");
  const modalSource = fs.readFileSync("content/report-modal.js", "utf8");
  const popupSource = fs.readFileSync("popup/popup.js", "utf8");
  const contentCss = fs.readFileSync("content/content.css", "utf8");
  const popupHtml = fs.readFileSync("popup/popup.html", "utf8");
  assert.doesNotMatch(viewSource, /\.innerHTML\s*=/);
  assert.match(modalSource, /renderNextSessionRules/);
  assert.match(popupSource, /renderNextSessionRules/);
  assert.match(modalSource, /다음 세션 맞춤 조언을 준비하고 있어요/);
  assert.match(popupSource, /다음 세션 맞춤 조언을 준비하고 있어요/);
  assert.match(modalSource, /기존 세션 리포트는 정상적으로 확인할 수 있습니다/);
  assert.match(popupSource, /기존 세션 리포트는 정상적으로 확인할 수 있습니다/);
  assert.match(modalSource, /renderReport\(body, response\.report\)/);
  assert.match(popupSource, /JJG_REPORT_VIEW\.renderReport/);
  assert.doesNotMatch(modalSource, /renderTimeline|renderTimeSummary|renderSourceStats/);
  assert.doesNotMatch(popupSource, /renderTimeline|renderTimeSummary|renderSourceStats/);
  assert.match(
    popupSource,
    /if \(Array\.isArray\(storedRules\)\) \{\s*renderRules\(storedRules\);\s*\} else if \(storedRules == null\) \{\s*requestRules\(\);/
  );
  assert.doesNotMatch(popupSource, /storedRules\.length/);
  assert.match(contentCss, /\.jjg-report-modal\s*\{[^}]*width:\s*900px/s);
  assert.match(contentCss, /#jjg-report-modal-body\s*\{[^}]*max-height:\s*72vh/s);
  assert.match(popupHtml, /body\s*\{[^}]*width:\s*560px/s);
  assert.match(popupHtml, /#jjg-report-output\s*\{[^}]*max-height:\s*500px/s);
  assert.ok(
    modalSource.indexOf("renderReport(body") <
      modalSource.lastIndexOf("loadNextSessionRules(backdrop)"),
    "기존 리포트를 먼저 표시한 뒤 맞춤 조언을 별도로 생성해야 한다"
  );

  const schemaSource = fs.readFileSync("shared/schema.js", "utf8");
  const rulesSource = fs.readFileSync("background/next-session-rules.js", "utf8");
  assert.match(schemaSource, /NEXT_SESSION_RULES/);
  assert.match(schemaSource, /function normalizeNextSessionRules/);
  assert.match(rulesSource, /GENERATE_NEXT_SESSION_RULES|NEXT_SESSION_RULES/);
  assert.match(rulesSource, /JJG_NEXT_SESSION_RULES/);
  assert.match(rulesSource, /item\?\.rule|candidate\.rule/);
  assert.match(rulesSource, /evidence/);
}

async function testDwellTrackerAndNavigation() {
  const context = vm.createContext({ console, URL, setInterval, clearInterval });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync("shared/schema.js", "utf8"), context, {
    filename: "shared/schema.js",
  });
  vm.runInContext(fs.readFileSync("content/dwell-tracker.js", "utf8"), context, {
    filename: "content/dwell-tracker.js",
  });

  const { NAVIGATION_SOURCES } = context.JJG_SCHEMA;
  const { classifyNavigationSource, createDwellTracker } = context.JJG_DWELL_TRACKER;
  const fakeLink = (href, matched = []) => ({
    href,
    getAttribute: () => href,
    closest: (selector) => matched.includes(selector) ? {} : null,
  });
  const classify = (currentPath, href, matched = []) => classifyNavigationSource({
    currentPath,
    currentHref: `https://www.youtube.com${currentPath}`,
    targetHref: href,
    linkElement: fakeLink(href, matched),
  });
  assert.equal(classify("/results", "/watch?v=a"), NAVIGATION_SOURCES.SEARCH);
  assert.equal(classify("/watch", "/watch?v=a"), NAVIGATION_SOURCES.RECOMMENDATION);
  assert.equal(classify("/", "/watch?v=a"), NAVIGATION_SOURCES.HOME);
  assert.equal(classify("/watch", "/watch?v=a&list=p"), NAVIGATION_SOURCES.PLAYLIST);
  assert.equal(classify("/feed/subscriptions", "/shorts/a"), NAVIGATION_SOURCES.SHORTS);
  assert.equal(classify("/channel/test", "/watch?v=a"), NAVIGATION_SOURCES.UNKNOWN);

  let clock = 1000;
  let session = { sessionId: 1, status: "active" };
  let videoId = "a";
  let path = "/watch";
  let intervalRegistrations = 0;
  let intervalCallback = null;
  let clearCount = 0;
  const logs = new Map();
  const tracker = createDwellTracker({
    now: () => clock,
    getSession: async () => session,
    getCurrentVideoId: () => videoId,
    getCurrentHref: () => `https://www.youtube.com/watch?v=${videoId}`,
    getCurrentPath: () => path,
    getReferrer: () => "",
    randomId: () => "fixed-" + clock,
    setInterval: (callback) => {
      intervalRegistrations += 1;
      intervalCallback = callback;
      return intervalRegistrations;
    },
    clearInterval: () => { clearCount += 1; },
    updateLogEntryById: async (entryId, changes) => {
      if (!logs.has(entryId)) return false;
      logs.set(entryId, { ...logs.get(entryId), ...changes });
      return true;
    },
  });

  await tracker.handleLocationChange();
  const entryA = await tracker.getEntryContext("a", "영상 A");
  logs.set(entryA.entryId, { ...entryA, action: "approved_reason", userReason: "학습 사례" });
  await tracker.handleLocationChange();
  assert.equal(intervalRegistrations, 1);

  clock = 11000;
  await intervalCallback();
  assert.equal(logs.size, 1);
  assert.equal(logs.get(entryA.entryId).dwellMs, 10000);
  assert.equal(logs.get(entryA.entryId).action, "approved_reason");
  assert.equal(logs.get(entryA.entryId).userReason, "학습 사례");

  const linkB = fakeLink("https://www.youtube.com/watch?v=b", ["ytd-compact-video-renderer"]);
  let prevented = false;
  tracker.captureLinkClick({
    target: { closest: () => linkB },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, false);
  clock = 21000;
  videoId = "b";
  await tracker.handleLocationChange();
  assert.equal(logs.get(entryA.entryId).leftAt, 21000);
  assert.equal(logs.get(entryA.entryId).dwellMs, 20000);

  const entryB = await tracker.getEntryContext("b", "영상 B");
  logs.set(entryB.entryId, { ...entryB, action: "watched" });
  assert.equal(entryB.navigation.source, NAVIGATION_SOURCES.RECOMMENDATION);
  assert.equal(entryB.navigation.fromEntryId, entryA.entryId);
  assert.equal(entryB.navigation.fromVideoId, "a");
  assert.equal(entryB.navigation.fromTitle, "영상 A");

  clock = 26000;
  session = { sessionId: 1, status: "ending" };
  await tracker.handleLocationChange();
  assert.equal(logs.get(entryB.entryId).dwellMs, 5000);
  assert.ok(clearCount >= 1);

  session = { sessionId: 1, status: "active" };
  clock = 27000;
  await tracker.resumeAfterEndingCancel();
  assert.equal(tracker.getState().active.entryId, entryB.entryId);
  clock = 28000;
  await tracker.checkpoint();
  assert.equal(logs.get(entryB.entryId).dwellMs, 7000);

  session = { sessionId: 2, status: "active" };
  videoId = "a";
  clock = 30000;
  await tracker.handleLocationChange();
  const revisitedA = await tracker.getEntryContext("a", "영상 A");
  assert.notEqual(revisitedA.entryId, entryA.entryId);
  assert.equal(revisitedA.sessionId, 2);
  assert.equal(revisitedA.navigation.fromEntryId, "");
}

function createPurposeChangeHarness() {
  const document = createInteractiveDocument();
  const startedAt = Date.now() - 10000;
  const storage = {
    jjg_purpose: "해시테이블 공부",
    jjg_session_id: startedAt,
    jjg_session_status: "active",
    jjg_session_started_at: startedAt,
    jjg_session_ended_at: null,
    jjg_session_log: [{ entryId: "existing", action: "watched" }],
    jjg_completion_result: null,
  };
  const events = [];
  let completionOptions = null;
  let reportOptions = null;
  const context = vm.createContext({ console, document, Date, location: { href: "https://www.youtube.com/" }, history: { length: 1 } });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync("shared/schema.js", "utf8"), context, {
    filename: "shared/schema.js",
  });
  context.JJG_STORAGE = {
    async get(keys) {
      const result = {};
      keys.forEach((key) => { result[key] = storage[key]; });
      return result;
    },
    async set(values) {
      Object.assign(storage, values);
      return true;
    },
  };
  context.JJG_DWELL_TRACKER = {
    async finalizeCurrent() { events.push("dwell_finalized"); },
    async resumeAfterEndingCancel() { events.push("dwell_resumed"); },
    async resetForSession() {},
  };
  context.JJG_COMPLETION = {
    async askCompletion(options) {
      completionOptions = options;
      events.push("completion_opened");
      return true;
    },
  };
  context.JJG_REPORT_MODAL = {
    async show(options) {
      reportOptions = options;
      events.push("report_opened");
    },
  };
  context.JJG_UI = { escapeHtml: (value) => String(value) };
  context.JJG_MESSAGING = { async sendMessageWithTimeout() { return { ok: false }; } };
  context.JJG_SHORTS_BLOCK = {
    async syncShortsUiVisibility() {},
    isShortsUrl() { return false; },
  };
  context.JJG_JUDGE_FLOW = { handleWatchPage() {} };
  vm.runInContext(fs.readFileSync("content/session.js", "utf8"), context, {
    filename: "content/session.js",
  });
  return {
    context,
    document,
    storage,
    events,
    get completionOptions() { return completionOptions; },
    get reportOptions() { return reportOptions; },
  };
}

async function testPurposeChangeFlow() {
  const harness = createPurposeChangeHarness();
  const { context, document, storage, events } = harness;

  const [firstOpen, duplicateOpen] = await Promise.all([
    context.JJG_SESSION.showPurposeChangePrompt(),
    context.JJG_SESSION.showPurposeChangePrompt(),
  ]);
  assert.equal(firstOpen, true);
  assert.equal(duplicateOpen, false);
  const prompt = document.getElementById("jjg-purpose-change-backdrop");
  assert.ok(prompt);
  assert.match(allText(prompt), /목적을 변경하기 전에 이번 세션을 정리할까요/);
  assert.match(allText(prompt), /리포트 생성 후 변경/);
  assert.match(allText(prompt), /리포트 없이 바로 변경/);
  assert.equal(storage.jjg_session_status, "active");
  assert.equal(storage.jjg_session_log.length, 1);

  await document.getElementById("jjg-purpose-change-cancel").click();
  assert.equal(document.getElementById("jjg-purpose-change-backdrop"), null);
  assert.equal(storage.jjg_session_status, "active");

  await context.JJG_SESSION.showPurposeChangePrompt();
  const reportButton = document.getElementById("jjg-change-with-report");
  await reportButton.click();
  assert.equal(storage.jjg_session_status, "ending");
  assert.equal(storage.jjg_session_log.length, 1);
  assert.deepEqual(events.slice(0, 2), ["dwell_finalized", "completion_opened"]);
  await reportButton.click();
  assert.equal(events.filter((event) => event === "completion_opened").length, 1);

  assert.equal(await harness.completionOptions.onCancel(), true);
  assert.equal(storage.jjg_session_status, "active");
  assert.ok(events.includes("dwell_resumed"));

  await context.JJG_SESSION.showPurposeChangePrompt();
  await document.getElementById("jjg-change-with-report").click();
  assert.equal(await harness.completionOptions.onConfirm("partial"), true);
  assert.equal(storage.jjg_session_status, "ended");
  assert.equal(storage.jjg_completion_result.status, "partial");
  assert.equal(storage.jjg_session_log.length, 1);
  assert.equal(harness.reportOptions.showStartNewPurposeButton, true);
  assert.equal(typeof harness.reportOptions.onStartNewPurpose, "function");

  const source = fs.readFileSync("content/session.js", "utf8");
  assert.match(source, /jjg-change-without-report/);
  assert.match(source, /backdrop\.remove\(\);\s*openPurposeEditor\(\);/);
  const directHandler = source.match(
    /directButton\.addEventListener\("click",([\s\S]*?)cancelButton\.addEventListener/
  )?.[1] || "";
  assert.doesNotMatch(directHandler, /beginEnding|GENERATE_SESSION_REPORT|JJG_REPORT_MODAL/);
}

async function testPurposeChangeReportActions() {
  async function loadReportModal(reportResponse) {
    const document = createInteractiveDocument();
    const context = vm.createContext({ console, document, Promise });
    context.globalThis = context;
    context.JJG_REPORT_VIEW = {
      renderReport(container) {
        const text = document.createElement("p");
        text.textContent = "기존 세션 리포트";
        container.appendChild(text);
      },
      renderNextSessionRules(container) {
        const text = document.createElement("p");
        text.textContent = "다음 세션 맞춤 조언";
        container.appendChild(text);
      },
    };
    let reportRequests = 0;
    context.JJG_MESSAGING = {
      async sendMessageWithTimeout(message) {
        if (message.type === "GENERATE_SESSION_REPORT") {
          reportRequests += 1;
          return reportResponse;
        }
        return { ok: true, rules: [] };
      },
    };
    vm.runInContext(fs.readFileSync("content/report-modal.js", "utf8"), context, {
      filename: "content/report-modal.js",
    });
    return {
      context,
      document,
      get reportRequests() { return reportRequests; },
    };
  }

  let opened = 0;
  const success = await loadReportModal({ ok: true, report: { summary: "완료" } });
  await success.context.JJG_REPORT_MODAL.show({
    showStartNewPurposeButton: true,
    onStartNewPurpose: async () => { opened += 1; },
  });
  assert.equal(success.document.getElementById("jjg-report-start-new-purpose").textContent, "새 목적 설정하기");
  assert.match(allText(success.document.body), /기존 세션 리포트/);
  await success.document.getElementById("jjg-report-start-new-purpose").click();
  assert.equal(opened, 1);

  const failure = await loadReportModal({ ok: false, error: "실패" });
  await failure.context.JJG_REPORT_MODAL.show({
    showStartNewPurposeButton: true,
    onStartNewPurpose: async () => { opened += 1; },
  });
  assert.match(allText(failure.document.body), /현재 기록은 그대로 보관되어 있습니다/);
  assert.equal(failure.document.getElementById("jjg-report-retry-purpose-change").textContent, "다시 시도");
  assert.equal(failure.document.getElementById("jjg-report-start-new-purpose").textContent, "리포트 없이 새 목적 설정");
  await failure.document.getElementById("jjg-report-retry-purpose-change").click();
  assert.equal(failure.reportRequests, 2);
  await failure.document.getElementById("jjg-report-start-new-purpose").click();
  assert.equal(opened, 2);
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
    const { appendLog, updateLogEntry, updateLogEntryById } = context.JJG_LOG;

    assert.equal(
      await appendLog({ videoId: "a", title: "영상 A", action: "watched", ts: 1000 }),
      0
    );
    assert.equal(
      await appendLog({
        entryId: "entry-b-1", videoId: "b", title: "영상 B", action: "blocked", ts: 1001,
        enteredAt: 1001, navigation: { source: "recommendation", fromEntryId: "" },
      }),
      1
    );

    await updateLogEntry(1, { action: "approved_reason", userReason: "이유" });
    assert.equal(storage.jjg_session_log[1].action, "approved_reason");
    assert.equal(storage.jjg_session_log[1].userReason, "이유");

    await updateLogEntryById("entry-b-1", {
      leftAt: 2001,
      dwellMs: 1000,
      timeMeasurement: "measured",
    });
    assert.equal(storage.jjg_session_log[1].action, "approved_reason");
    assert.equal(storage.jjg_session_log[1].userReason, "이유");
    assert.equal(storage.jjg_session_log[1].dwellMs, 1000);

    assert.equal(
      await appendLog({
        entryId: "entry-b-2", videoId: "b", title: "영상 B 재방문",
        action: "watched", ts: 3000,
      }),
      2
    );

    await updateLogEntry(99, { action: "watched" }); // 없는 인덱스는 조용히 무시
    assert.equal(storage.jjg_session_log.length, 3);

    await testSessionLifecycle();
    await testCompletionUI();
    testNextSessionRulesView();
    await testDwellTrackerAndNavigation();
    await testPurposeChangeFlow();
    await testPurposeChangeReportActions();
    console.log("content script/목표 달성/규칙 렌더링 시나리오 통과");
  })();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
