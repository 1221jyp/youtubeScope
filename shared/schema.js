(function (root) {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    PURPOSE: "jjg_purpose",
    SESSION_ID: "jjg_session_id",
    SESSION_STATUS: "jjg_session_status",
    SESSION_STARTED_AT: "jjg_session_started_at",
    SESSION_ENDED_AT: "jjg_session_ended_at",
    GOAL_PROFILE: "jjg_goal_profile",
    SESSION_LOG: "jjg_session_log",
    COMPLETION_RESULT: "jjg_completion_result",
    SESSION_REPORT: "jjg_session_report",
    NEXT_SESSION_RULES: "jjg_next_session_rules",
    GEMINI_API_KEY: "jjg_gemini_api_key",
    GEMINI_MODEL: "jjg_gemini_model",
    VERDICT_CACHE: "jjg_verdict_cache",
  });

  const SESSION_STATUS = Object.freeze({
    ACTIVE: "active",
    ENDING: "ending",
    ENDED: "ended",
  });

  const VIDEO_DECISIONS = Object.freeze({
    ALLOW: "allow",
    ASK_REASON: "ask_reason",
    BLOCK: "block",
  });

  const LOG_ACTIONS = Object.freeze({
    WATCHED: "watched",
    APPROVED_REASON: "approved_reason",
    LEFT_ANYWAY: "left_anyway",
    WENT_BACK: "went_back",
    SKIPPED: "skipped",
    BLOCKED: "blocked",
  });

  const COMPLETION_STATUS = Object.freeze({
    ACHIEVED: "achieved",
    PARTIAL: "partial",
    NOT_ACHIEVED: "not_achieved",
  });

  // [신규] AI 요청 공통 상태. 모든 Gemini 호출(judge/reason/goal/report/rules)이 공유한다.
  // idle과 loading은 UI(content script) 쪽에서만 쓰고, background 응답에는 success/error/timeout만 담긴다.
  const AI_REQUEST_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    ERROR: "error",
    TIMEOUT: "timeout",
  });

  // [신규] "정상 거절"이 아니라 "API 자체가 실패한" 원인 분류.
  // gemini.js가 이 값을 붙여서 던지고, 호출부는 이 code로만 UI 문구/재시도 여부를 결정한다.
  const AI_ERROR_CODES = Object.freeze({
    API_KEY_NOT_SET: "api_key_not_set",
    AUTH_ERROR: "auth_error",
    RATE_LIMIT: "rate_limit",
    NOT_FOUND: "not_found",
    NETWORK_ERROR: "network_error",
    TIMEOUT: "timeout",
    PARSE_ERROR: "parse_error",
    MESSAGE_FAILED: "message_failed", // content ↔ background 통신 자체 실패 (Gemini와 무관)
    UNKNOWN: "unknown",
  });

  const MAX_TOPICS = 20;
  const MAX_RULES = 10;

  function result(value, errors) {
    return { valid: errors.length === 0, value, errors };
  }

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function finiteNumber(value) {
    if (value === "" || value == null || typeof value === "boolean") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function enumValues(enumObject) {
    return Object.values(enumObject);
  }

  function normalizeStringList(value, fieldName, errors, maxItems = MAX_TOPICS) {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      errors.push(`${fieldName}은(는) 문자열 배열이어야 합니다.`);
      return [];
    }
    const strings = [];
    let invalidItem = false;
    for (const item of value) {
      if (typeof item !== "string") {
        invalidItem = true;
        continue;
      }
      const cleaned = item.trim();
      if (cleaned && !strings.includes(cleaned)) strings.push(cleaned);
      if (strings.length === maxItems) break;
    }
    if (invalidItem) errors.push(`${fieldName}에는 문자열만 사용할 수 있습니다.`);
    return strings;
  }

  function createSession(now = Date.now()) {
    const timestamp = finiteNumber(now);
    const safeNow = timestamp == null ? Date.now() : timestamp;
    return {
      sessionId: safeNow,
      status: SESSION_STATUS.ACTIVE,
      startedAt: safeNow,
      endedAt: null,
    };
  }

  function normalizeSession(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    if (source !== input) errors.push("세션 데이터는 객체여야 합니다.");

    const sessionId = finiteNumber(source.sessionId);
    const startedAt = finiteNumber(source.startedAt);
    const endedAt = source.endedAt == null ? null : finiteNumber(source.endedAt);
    const status = enumValues(SESSION_STATUS).includes(source.status) ? source.status : null;

    if (sessionId == null) errors.push("sessionId가 유효한 숫자가 아닙니다.");
    if (!status) errors.push("세션 status 값이 유효하지 않습니다.");
    if (startedAt == null) errors.push("startedAt이 유효한 숫자가 아닙니다.");
    if (source.endedAt != null && endedAt == null) errors.push("endedAt이 유효한 숫자 또는 null이 아닙니다.");

    return result({ sessionId, status, startedAt, endedAt }, errors);
  }

  function normalizeGoalProfile(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    if (source !== input) errors.push("목적 구체화 데이터는 객체여야 합니다.");
    return result(
      {
        rawPurpose: cleanString(source.rawPurpose),
        mainGoal: cleanString(source.mainGoal),
        allowedTopics: normalizeStringList(source.allowedTopics, "allowedTopics", errors),
        borderlineTopics: normalizeStringList(source.borderlineTopics, "borderlineTopics", errors),
        blockedTopics: normalizeStringList(source.blockedTopics, "blockedTopics", errors),
        completionCondition: cleanString(source.completionCondition),
      },
      errors
    );
  }

  function normalizeVideoVerdict(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    if (source !== input) errors.push("영상 판정 데이터는 객체여야 합니다.");

    const decision = enumValues(VIDEO_DECISIONS).includes(source.decision)
      ? source.decision
      : null;
    if (!decision) errors.push("decision 값이 유효하지 않습니다.");

    let score = source.score == null ? null : finiteNumber(source.score);
    if (source.score != null && score == null) {
      errors.push("score는 숫자 또는 null이어야 합니다.");
    } else if (score != null) {
      score = Math.min(100, Math.max(0, score));
    }

    return result(
      {
        decision,
        score,
        reason: cleanString(source.reason),
      },
      errors
    );
  }

  function normalizeReasonVerdict(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    if (source !== input) errors.push("이유 재판정 데이터는 객체여야 합니다.");

    let accepted = source.accepted;
    if (typeof accepted === "string") {
      const lowered = accepted.trim().toLowerCase();
      if (lowered === "true") accepted = true;
      else if (lowered === "false") accepted = false;
    }
    if (typeof accepted !== "boolean") {
      accepted = null;
      errors.push("accepted는 boolean이어야 합니다.");
    }

    return result(
      {
        accepted,
        explanation: cleanString(source.explanation),
      },
      errors
    );
  }

  function legacyInitialVerdict(source) {
    if (typeof source.related !== "boolean") return null;
    return {
      decision: source.related ? VIDEO_DECISIONS.ALLOW : VIDEO_DECISIONS.BLOCK,
      score: null,
      reason: cleanString(source.reason),
    };
  }

  function normalizeLogEntry(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    if (source !== input) errors.push("로그 항목은 객체여야 합니다.");
    const isLegacy = !source.initialVerdict && typeof source.related === "boolean";

    const sessionId = source.sessionId == null ? null : finiteNumber(source.sessionId);
    const ts = finiteNumber(source.ts);
    if (source.sessionId != null && sessionId == null) errors.push("sessionId가 유효하지 않습니다.");
    if (ts == null) errors.push("ts가 유효한 숫자가 아닙니다.");

    let initialVerdict = null;
    if (source.initialVerdict != null) {
      const verdictResult = normalizeVideoVerdict(source.initialVerdict);
      initialVerdict = verdictResult.value;
      errors.push(...verdictResult.errors.map((error) => `initialVerdict: ${error}`));
    } else if (isLegacy) {
      initialVerdict = legacyInitialVerdict(source);
    }

    let reasonVerdict = null;
    if (source.reasonVerdict != null) {
      const reasonResult = normalizeReasonVerdict(source.reasonVerdict);
      reasonVerdict = reasonResult.value;
      errors.push(...reasonResult.errors.map((error) => `reasonVerdict: ${error}`));
    }

    const action = enumValues(LOG_ACTIONS).includes(source.action) ? source.action : null;
    if (!action) errors.push("action 값이 유효하지 않습니다.");

    return result(
      {
        sessionId,
        videoId: cleanString(source.videoId),
        title: cleanString(source.title),
        ts,
        initialVerdict,
        userReason: cleanString(source.userReason),
        reasonVerdict,
        action,
      },
      errors
    );
  }

  function normalizeCompletionResult(input) {
    if (input == null) return result(null, []);
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    if (source !== input) errors.push("목표 달성 결과는 객체 또는 null이어야 합니다.");
    const status = enumValues(COMPLETION_STATUS).includes(source.status) ? source.status : null;
    const checkedAt = finiteNumber(source.checkedAt);
    if (!status) errors.push("목표 달성 status 값이 유효하지 않습니다.");
    if (checkedAt == null) errors.push("checkedAt이 유효한 숫자가 아닙니다.");
    return result({ status, checkedAt }, errors);
  }

  function normalizeNextSessionRules(input) {
    const errors = [];
    if (!Array.isArray(input)) {
      return result([], ["다음 세션 규칙은 배열이어야 합니다."]);
    }
    const rules = [];
    input.slice(0, MAX_RULES).forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${index}번째 규칙은 객체여야 합니다.`);
        return;
      }
      const rule = cleanString(item.rule);
      if (!rule) {
        errors.push(`${index}번째 rule은 비어 있을 수 없습니다.`);
        return;
      }
      rules.push({ rule, evidence: cleanString(item.evidence) });
    });
    return result(rules, errors);
  }

  const api = Object.freeze({
    STORAGE_KEYS,
    SESSION_STATUS,
    VIDEO_DECISIONS,
    LOG_ACTIONS,
    COMPLETION_STATUS,
    AI_REQUEST_STATUS,
    AI_ERROR_CODES,
    createSession,
    normalizeSession,
    normalizeGoalProfile,
    normalizeVideoVerdict,
    normalizeReasonVerdict,
    normalizeLogEntry,
    normalizeCompletionResult,
    normalizeNextSessionRules,
  });

  root.JJG_SCHEMA = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);