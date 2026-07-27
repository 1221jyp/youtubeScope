# 조준경 공통 데이터 스키마

공통 상수와 정규화 함수는 `schema.js`의 `globalThis.JJG_SCHEMA`로 제공된다. Node에서는
`require("./schema.js")`로 사용할 수 있다. 정규화 함수는 원본을 변경하지 않으며 다음 형식을 반환한다.

```js
{
  valid: true,
  value: 정규화된_값,
  errors: []
}
```

검증에 실패한 enum 값은 임의의 정상값으로 바꾸지 않고 `null`로 반환한다.

## 저장소 키

| 상수 | 실제 키 | 용도 |
|---|---|---|
| `PURPOSE` | `jjg_purpose` | 기존 원문 목적 |
| `SESSION_ID` | `jjg_session_id` | 현재 세션 ID |
| `SESSION_STATUS` | `jjg_session_status` | 세션 상태 |
| `SESSION_STARTED_AT` | `jjg_session_started_at` | 시작 시각 |
| `SESSION_ENDED_AT` | `jjg_session_ended_at` | 종료 시각 |
| `GOAL_PROFILE` | `jjg_goal_profile` | 구체화된 목적 |
| `SESSION_LOG` | `jjg_session_log` | 영상 로그 배열 |
| `COMPLETION_RESULT` | `jjg_completion_result` | 목표 달성 확인 결과 |
| `SESSION_REPORT` | `jjg_session_report` | AI 세션 리포트 캐시 |
| `NEXT_SESSION_RULES` | `jjg_next_session_rules` | 다음 세션 규칙 |
| `GEMINI_API_KEY` | `jjg_gemini_api_key` | 현행 Gemini API 키 |
| `GEMINI_MODEL` | `jjg_gemini_model` | 현행 Gemini 모델 |
| `VERDICT_CACHE` | `jjg_verdict_cache` | 영상 판정 캐시 |

현재 실행 코드에서 사용하는 기존 키는 이름을 변경하거나 삭제하지 않는다.

## 세션

상태는 `active`, `ending`, `ended` 중 하나다.

```js
const session = JJG_SCHEMA.createSession();
// { sessionId, status: "active", startedAt, endedAt: null }
```

`normalizeSession()`은 잘못된 상태를 `null`로 반환하고 오류를 제공한다. 이 스키마는 종료 상태를
표현할 뿐이며 현재 세션 종료 기능을 구현하지 않는다.

## 목적 구체화

```js
{
  rawPurpose: "해시테이블 공부",
  mainGoal: "해시테이블의 원리와 구현 학습",
  allowedTopics: ["해시 함수", "체이닝"],
  borderlineTopics: ["코딩테스트 후기"],
  blockedTopics: ["개발자 브이로그", "쇼핑"],
  completionCondition: "두 충돌 처리 방식의 차이를 설명할 수 있음"
}
```

`normalizeGoalProfile()`은 문자열 이외의 주제를 제외하고 빈 값과 중복을 제거하며 각 목록을 최대
20개로 제한한다.

## 영상 판정

`VIDEO_DECISIONS`:

- `allow`: 목적에 직접 관련되어 허용
- `ask_reason`: 경계에 있어 사용자 이유가 필요
- `block`: 목적과 무관하여 차단

```js
{
  decision: "ask_reason",
  score: 55,
  reason: "현재 목적과 간접적으로 관련됨"
}
```

`normalizeVideoVerdict()`은 숫자 문자열을 변환하고 점수를 0~100으로 제한한다. 점수를 알 수 없으면
`null`을 허용한다. 잘못된 decision은 `allow`로 통과시키지 않고 `null`과 오류로 반환한다.

## 사용자 이유 재판정

```js
{
  accepted: true,
  explanation: "현재 목적과 연결되는 구체적인 이유입니다."
}
```

`normalizeReasonVerdict()`은 실제 boolean과 기존 AI 호환용 문자열 `"true"`, `"false"`만 인정한다.
그 밖의 값은 `null`과 오류로 반환한다.

## 로그 action과 공통 로그

| action | 의미 |
|---|---|
| `watched` | 초기 판정에서 목적에 맞아 시청 |
| `approved_reason` | 이유 재판정이 승인되어 시청 |
| `left_anyway` | 경고 후에도 시청 |
| `went_back` | 경고 후 돌아감 |
| `skipped` | AI 장애로 판정을 건너뜀 |
| `blocked` | 목적과 무관하여 차단됐고 아직 후속 선택이 없음 |

`blocked`는 최신 기존 코드가 이미 사용하므로 공통 action에 포함한다.

```js
{
  sessionId: 1720000000000,
  videoId: "abc123",
  title: "코딩테스트 합격 후기",
  ts: 1720000001000,
  initialVerdict: {
    decision: "ask_reason",
    score: 55,
    reason: "현재 목적과 간접적으로 관련됨"
  },
  userReason: "해시테이블 출제 사례를 확인하려고",
  reasonVerdict: {
    accepted: true,
    explanation: "목적과 연결되는 구체적인 이유"
  },
  action: "approved_reason"
}
```

이유를 아직 받지 않았다면 `userReason: ""`, `reasonVerdict: null`을 사용한다.

### 기존 로그 호환

`normalizeLogEntry()`은 `{ videoId, title, related, action, reason, ts }` 형식도 읽는다.

- `related: true` → `decision: "allow"`
- `related: false` → `decision: "block"`
- 알 수 없던 `score` → `null`
- 존재하지 않던 `sessionId`, `userReason`, `reasonVerdict` → 각각 `null`, `""`, `null`
- 기존 action은 그대로 유지

저장소의 기존 로그를 자동 수정하거나 덮어쓰지는 않는다. 읽는 기능이 필요한 시점에 정규화한다.

## 목표 달성 결과

상태는 `achieved`, `partial`, `not_achieved` 중 하나다.

```js
{
  status: "partial",
  checkedAt: 1720000003000
}
```

아직 확인하지 않았다면 전체 값으로 `null`을 사용하며 `normalizeCompletionResult(null)`은 정상이다.

## 다음 세션 규칙

```js
[
  {
    rule: "후기 영상은 시청 전에 이유를 확인하기",
    evidence: "이번 세션에서 후기 영상 이후 브이로그로 이동함"
  }
]
```

`normalizeNextSessionRules()`은 최대 10개를 허용한다. 빈 `rule`이나 객체가 아닌 항목은 결과에서
제외하고 오류를 반환한다. 현재 작업에서는 규칙을 생성하거나 적용하지 않는다.

## 기능별 데이터 담당

| 데이터 | 생성 담당 | 사용 담당 |
|---|---|---|
| 세션 기본값 | 목적 설정·향후 세션 시작 기능 | content, popup, background |
| 목적 구체화 | 향후 목적 AI 구체화 기능 | 영상 판정, 완료 확인 |
| 영상 판정 | 향후 3단계 판정 기능 | content 경고·차단, 로그 |
| 이유 재판정 | 사용자 이유 재판정 기능 | content, 로그 |
| 세션 로그 | content의 영상 흐름 기록 | popup, AI 리포트, 완료 확인 |
| 목표 달성 결과 | 향후 완료 확인 기능 | popup, 다음 세션 규칙 |
| 다음 세션 규칙 | 향후 규칙 생성 기능 | 다음 세션 시작 기능 |

## 사용 예

```js
const { STORAGE_KEYS, normalizeLogEntry } = globalThis.JJG_SCHEMA;
const normalized = normalizeLogEntry(rawLogEntry);

if (!normalized.valid) {
  console.warn(normalized.errors);
} else {
  chrome.storage.local.set({
    [STORAGE_KEYS.SESSION_LOG]: [normalized.value],
  });
}
```
