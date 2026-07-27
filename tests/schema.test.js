const assert = require("node:assert/strict");
const schema = require("../schema.js");

const {
  SESSION_STATUS,
  VIDEO_DECISIONS,
  LOG_ACTIONS,
  COMPLETION_STATUS,
  createSession,
  normalizeSession,
  normalizeGoalProfile,
  normalizeVideoVerdict,
  normalizeReasonVerdict,
  normalizeLogEntry,
  normalizeCompletionResult,
  normalizeNextSessionRules,
} = schema;

function run() {
  const session = createSession(1720000000000);
  assert.deepEqual(session, {
    sessionId: 1720000000000,
    status: SESSION_STATUS.ACTIVE,
    startedAt: 1720000000000,
    endedAt: null,
  });
  assert.equal(normalizeSession(session).valid, true);

  const badSession = normalizeSession({
    sessionId: 1,
    status: "paused",
    startedAt: 1,
    endedAt: null,
  });
  assert.equal(badSession.valid, false);
  assert.equal(badSession.value.status, null);

  const profileInput = {
    rawPurpose: " 해시테이블 공부 ",
    mainGoal: "원리와 구현 학습",
    allowedTopics: ["해시 함수", "체이닝", "체이닝", ""],
    borderlineTopics: ["코딩테스트 후기"],
    blockedTopics: ["개발자 브이로그", "쇼핑"],
    completionCondition: "차이를 설명할 수 있음",
  };
  const profile = normalizeGoalProfile(profileInput);
  assert.equal(profile.valid, true);
  assert.deepEqual(profile.value.allowedTopics, ["해시 함수", "체이닝"]);
  assert.equal(profile.value.rawPurpose, "해시테이블 공부");

  const invalidTopics = normalizeGoalProfile({
    allowedTopics: ["SQL", 42, null, "SQL"],
  });
  assert.equal(invalidTopics.valid, false);
  assert.deepEqual(invalidTopics.value.allowedTopics, ["SQL"]);

  const verdict = normalizeVideoVerdict({
    decision: VIDEO_DECISIONS.ASK_REASON,
    score: "55",
    reason: "간접 관련",
  });
  assert.deepEqual(verdict, {
    valid: true,
    value: { decision: "ask_reason", score: 55, reason: "간접 관련" },
    errors: [],
  });

  assert.equal(normalizeVideoVerdict({ decision: "allow", score: 150 }).value.score, 100);
  assert.equal(normalizeVideoVerdict({ decision: "allow", score: -20 }).value.score, 0);

  const invalidDecision = normalizeVideoVerdict({ decision: "maybe", score: 50 });
  assert.equal(invalidDecision.valid, false);
  assert.equal(invalidDecision.value.decision, null);

  const reasonVerdict = normalizeReasonVerdict({
    accepted: "false",
    explanation: "구체적인 연결이 없음",
  });
  assert.equal(reasonVerdict.valid, true);
  assert.equal(reasonVerdict.value.accepted, false);

  const newLog = normalizeLogEntry({
    sessionId: 1720000000000,
    videoId: "abc123",
    title: "코딩테스트 합격 후기",
    ts: 1720000001000,
    initialVerdict: {
      decision: "ask_reason",
      score: 55,
      reason: "간접 관련",
    },
    userReason: "출제 사례 확인",
    reasonVerdict: {
      accepted: true,
      explanation: "목적과 연결됨",
    },
    action: LOG_ACTIONS.APPROVED_REASON,
  });
  assert.equal(newLog.valid, true);
  assert.equal(newLog.value.initialVerdict.score, 55);
  assert.equal(newLog.value.reasonVerdict.accepted, true);

  const legacyLog = normalizeLogEntry({
    videoId: "old-video",
    title: "기존 영상",
    related: false,
    action: "went_back",
    reason: "목적과 무관",
    ts: 1720000002000,
  });
  assert.equal(legacyLog.valid, true);
  assert.deepEqual(legacyLog.value.initialVerdict, {
    decision: VIDEO_DECISIONS.BLOCK,
    score: null,
    reason: "목적과 무관",
  });
  assert.equal(legacyLog.value.userReason, "");
  assert.equal(legacyLog.value.reasonVerdict, null);

  const badAction = normalizeLogEntry({
    videoId: "x",
    title: "x",
    ts: 1,
    action: "unknown",
  });
  assert.equal(badAction.valid, false);
  assert.equal(badAction.value.action, null);

  const completion = normalizeCompletionResult({
    status: COMPLETION_STATUS.PARTIAL,
    checkedAt: "1720000003000",
  });
  assert.equal(completion.valid, true);
  assert.equal(completion.value.checkedAt, 1720000003000);
  assert.deepEqual(normalizeCompletionResult(null), { valid: true, value: null, errors: [] });

  const rules = normalizeNextSessionRules([
    { rule: "후기 영상은 이유 확인", evidence: "후기 이후 브이로그 이동" },
    { rule: " ", evidence: "무효 규칙" },
    "잘못된 항목",
  ]);
  assert.equal(rules.valid, false);
  assert.deepEqual(rules.value, [
    { rule: "후기 영상은 이유 확인", evidence: "후기 이후 브이로그 이동" },
  ]);

  const immutableInput = {
    rawPurpose: " 목적 ",
    allowedTopics: [" A ", "A", 3],
    nested: { untouched: true },
  };
  const snapshot = structuredClone(immutableInput);
  normalizeGoalProfile(immutableInput);
  assert.deepEqual(immutableInput, snapshot);

  console.log("공통 스키마 시나리오 15개 통과");
}

run();
