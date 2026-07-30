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

`normalizeSession()`은 잘못된 상태를 `null`로 반환하고 오류를 제공한다.

### 상태 전이 (구현됨)

```
(status 없음) --목표 설정--> active --몰입 종료--> ending --목표 확인 완료--> ended
                               ^                     |
                               +----- 확인 취소 ------+
```

- `active`가 아니면 새 영상 판정을 시작하지 않는다.
- `ending`에서 종료 버튼은 비활성화되어 중복 클릭이 막힌다.
- `COMPLETION_RESULT`를 저장한 뒤에만 `ended`로 넘어가고, 그때 `endedAt`을 함께 쓴다.
- 새 세션을 시작하면 `active`로 돌아가며 로그·리포트·달성 결과가 초기화된다.

저장소는 세션을 키 4개(`SESSION_ID`/`SESSION_STATUS`/`SESSION_STARTED_AT`/`SESSION_ENDED_AT`)로
나눠 담는다. `normalizeSession()`은 객체 하나를 받으므로 읽을 때 다시 조립해서 넘겨야 한다.
상태 전이는 `content/session.js`에만 두고 다른 모듈은 읽기만 한다.

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

리포트 분석 대상은 `watched`, `approved_reason`, `left_anyway`, `went_back`, `blocked`이며 `skipped`는
AI 장애 기록이라 이탈 분석에서 제외한다. 실제 이탈로 집계하는 action은 `left_anyway` 하나뿐이다.

현재 UI에는 "그래도 시청" 버튼이 없고 이유를 제출해 AI 승인을 받아야 하므로, `left_anyway`는 과거
로그에만 남아 있는 레거시 action이다.

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

### content.js가 실제로 기록하는 형식

현재 `content.js`는 아직 `initialVerdict` 대신 레거시 필드(`related`, `reason`)를 쓰면서
이유 재판정 결과만 공통 스키마 필드로 함께 남기는 과도기 형식으로 기록한다.

```js
{
  videoId, title, ts,
  related: false,
  reason: "목적과 무관한 브이로그 콘텐츠",  // 초기 판정 근거
  userReason: "해시테이블 출제 사례를 확인하려고",
  reasonVerdict: { accepted: true, explanation: "목적과 연결됨" },
  action: "approved_reason"
}
```

차단 시점에 `action: "blocked"`, `userReason: ""`, `reasonVerdict: null`로 먼저 기록하고 이후 선택에
따라 같은 항목을 갱신한다.

- AI가 이유를 승인 → `action: "approved_reason"`, `reasonVerdict.accepted: true`
- AI가 이유를 거절 → `action`은 `blocked` 유지, `reasonVerdict.accepted: false`로 근거만 기록
- AI 장애로 판정 불가 → `action: "skipped"` (승인과 구분해서 이탈 분석에서 제외)
- 돌아가기 → `action: "went_back"`

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

`NEXT_SESSION_RULES`는 하나의 저장소 키에서 생성 상태까지 구분한다.

- `null` 또는 `undefined`: 아직 생성하지 않음
- `[]`: 생성했지만 제안할 규칙 없음
- 배열에 항목 존재: 생성된 규칙 있음

```js
[
  {
    rule: "후기 영상은 시청 전에 이유를 확인하기",
    evidence: "이번 세션에서 후기 영상 이후 브이로그로 이동함"
  }
]
```

`normalizeNextSessionRules()`은 최대 10개를 허용한다. 빈 `rule`이나 객체가 아닌 항목은 결과에서
제외하고 오류를 반환한다. 실제 규칙 생성 기능은 정규화된 로그의 증거 문장과 정확히 연결된 규칙만
최대 3개 저장한다. 규칙 자동 적용이나 위반 감시는 아직 구현하지 않는다.

## 기능별 데이터 담당

| 데이터 | 생성 담당 | 사용 담당 |
|---|---|---|
| 세션 기본값 | 목적 설정·향후 세션 시작 기능 | content, popup, background |
| 목적 구체화 | 향후 목적 AI 구체화 기능 | 영상 판정, 완료 확인 |
| 영상 판정 | 향후 3단계 판정 기능 | content 경고·차단, 로그 |
| 이유 재판정 | 사용자 이유 재판정 기능 | content, 로그 |
| 세션 로그 | content의 영상 흐름 기록 | popup, AI 리포트, 완료 확인 |
| 목표 달성 결과 | 향후 완료 확인 기능 | popup, 다음 세션 규칙 |
| 다음 세션 규칙 | `background/next-session-rules.js` | popup, 종료 리포트 모달 |

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
