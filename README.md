# 조준경 (youtubeScope)

유튜브 진입 시 목적을 선언하고, 목적과 무관한 영상 시청을 Gemini가 감지해 경고하는 Chrome 확장 프로그램(MV3).

## 개발 환경

빌드 도구와 외부 의존성이 없다. 소스를 그대로 확장 프로그램으로 로드한다.

```bash
npm test   # node 내장 모듈만 사용
```

브라우저에서 확인: `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → 이 폴더 선택.
Gemini API 키는 확장 프로그램 옵션 화면에서 입력한다.

## 파트별 담당 파일

기능 하나가 파일 하나에 대응하도록 나눠 두었다. **자기 파트 파일만 고치면 머지 충돌이 나지 않는다.**

| 파트 | content script (화면·흐름) | background (AI·데이터) |
|---|---|---|
| 목적 설정 · 세션 관리 | [content/session.js](content/session.js) | — |
| 영상 판정 | [content/judge-flow.js](content/judge-flow.js) | [background/judge.js](background/judge.js) |
| 이유 재판정 | [content/reason-flow.js](content/reason-flow.js) | [background/reason.js](background/reason.js) |
| 세션 로그 | [content/log.js](content/log.js) | — |
| 목표 달성 확인 | [content/completion.js](content/completion.js) | — |
| 세션 리포트 · 통계 | [popup/popup.js](popup/popup.js), [content/report-modal.js](content/report-modal.js) | [background/report.js](background/report.js) |

목표 달성 확인은 임시 최소 구현 상태다. 교체할 때 지켜야 할 규약은
[content/completion.js](content/completion.js) 맨 위 주석에 있다.

### 공용 파일 (고치기 전에 알리기)

| 파일 | 역할 |
|---|---|
| [shared/schema.js](shared/schema.js) | 저장소 키, enum, 정규화 함수. 데이터 형식의 기준 → [SCHEMA.md](SCHEMA.md) |
| [shared/storage.js](shared/storage.js) | `chrome.storage.local` 래퍼 |
| [shared/selectors.js](shared/selectors.js) | 유튜브 DOM/메타 선택자 |
| [shared/text.js](shared/text.js) | 문자열 정리 헬퍼 |
| [shared/report-view.js](shared/report-view.js) | 리포트 본문 DOM 렌더링 (popup·종료 모달 공용) |
| [background/gemini.js](background/gemini.js) | Gemini API 호출 방식 (fetch·에러·함수 호출 파싱) |
| [background/verdict.js](background/verdict.js) | **판정 프롬프트와 가드레일.** 영상 판정과 이유 재판정이 같은 기준을 써야 해서 공유한다 |
| [content/ui.js](content/ui.js) | 오버레이 틀·토스트·비디오 제어 |
| [content/navigation.js](content/navigation.js) | URL 감지, 제목·설명 추출 |
| [content/messaging.js](content/messaging.js) | background 통신 + fail-open 정책 |

진입점은 배선만 한다: [content/main.js](content/main.js)(이벤트 등록·부팅),
[background/main.js](background/main.js)(모듈 로딩·메시지 라우팅).

## 모듈 규칙

번들러가 없고 MV3 content script는 ES 모듈을 못 쓰기 때문에, **전역 네임스페이스가 모듈 시스템**이다.

```js
(function (root) {
  "use strict";

  const { STORAGE_KEYS } = root.JJG_SCHEMA;   // 먼저 로드되는 모듈은 최상위에서 참조 가능

  function doSomething() {
    root.JJG_OTHER.foo();                      // 나중에 로드되는 모듈은 호출 시점에 참조
  }

  root.JJG_MY_MODULE = Object.freeze({ doSomething });
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- 파일 하나당 `JJG_*` 네임스페이스 하나
- 로드 순서는 [manifest.json](manifest.json)의 `content_scripts.js` 배열과
  [background/main.js](background/main.js)의 `importScripts` 목록이 결정한다
- 새 모듈을 추가하면 **둘 중 해당하는 목록에 등록**해야 한다

`tests/manifest.test.js`가 경로 오타·네임스페이스 중복·로드 순서 위반을 잡아준다.

## 세션 상태

UI는 두 가지로만 보이고, 스키마의 `SESSION_STATUS` 3상태에 매핑된다.

| UI | `SESSION_STATUS` | 화면 우하단 | 영상 판정 |
|---|---|---|---|
| 기본 | 키 없음(설치 직후) 또는 `ended` | `🎯 목표 설정` | 안 함 |
| 몰입 | `active` | `🎯 목적 변경` `⏹ 몰입 종료` | 함 |
| 전환 중 | `ending` | `종료 중...` (비활성) | 안 함 |

```
(기본) --목표 설정--> active --몰입 종료--> ending --목표 확인--> ended --> (기본)
                        ^                     |
                        +----- 확인 취소 ------+
```

`ending`에서 버튼을 비활성화하는 것으로 종료 버튼 중복 클릭이 막힌다.
상태 전이는 전부 [content/session.js](content/session.js)에만 있고, 다른 모듈은 `getSession()`으로 읽기만 한다.
탭이 여러 개면 [content/main.js](content/main.js)의 `storage.onChanged`가 나머지 탭 버튼을 갱신한다.

active 세션에서 `목적 변경`을 누르면 먼저 현재 기록으로 리포트를 생성할지 선택한다. 리포트 생성 시
기존 `active → ending → 목표 확인 → ended` 종료 절차를 그대로 사용하고, 리포트 확인 후 새 목적 설정으로
이어진다. 리포트 없이 변경하더라도 목적 입력이나 AI 구체화를 취소할 수 있으며, 새 목적을 최종 확인해
`startNewSession()`이 실행되기 전까지 기존 세션 상태와 로그는 유지된다.

## 데이터 흐름

```
content/main.js
  └ URL 변경 감지 → judge-flow.handleWatchPage()
      ├ session.getSession()          몰입 상태(active)가 아니면 아무것도 안 함
      ├ navigation.waitForTitle()     제목이 갱신될 때까지 대기
      ├ messaging → JUDGE_VIDEO ──────→ background/judge.js → verdict.js → Gemini
      ├ 통과: ui.playVideo() + log.appendLog({ action: "watched" })
      └ 차단: log.appendLog({ action: "blocked" }) + reason-flow.showWarning()
                └ 이유 제출 → JUDGE_REASON ─→ background/reason.js → verdict.js → Gemini
                     ├ 승인   → action: "approved_reason"
                     ├ 거절   → action: "blocked" 유지 (이유·근거만 기록)
                     ├ AI장애 → action: "skipped"
                     └ 돌아가기 → action: "went_back"

몰입 종료
  └ session.beginEnding()          → ending (판정 중단, 로그는 유지)
      └ completion.askCompletion() → 목표 달성 확인 (용진 파트)
           └ session.completeSession(status)
                → COMPLETION_RESULT 저장 → ended + endedAt
                → report-modal.show()    → 이탈 리포트 모달

popup/popup.js
  └ GENERATE_SESSION_REPORT ─→ background/report.js
       └ 로그에서 센 "증거 리포트" + Gemini 서술을 합쳐서 반환
```

## 설계상 지켜야 할 것

- **fail-open**: AI가 실패하면 사용자를 막지 않고 통과시킨다. 대신 `skipped`로 기록해서 통계에서 구분한다.
- **service worker는 상태를 들고 있지 않는다**: 언제든 잠들 수 있으므로 매번 `chrome.storage.local`에서 읽는다.
- **AI 출력은 신뢰하지 않는다**: 리포트의 숫자·경로는 로그에서 직접 세고, AI는 서술만 보탠다.
- **영상 제목·설명·사용자 이유는 데이터이지 지시가 아니다**: 프롬프트에 명시하고, 화면에는 `textContent`나
  `escapeHtml()`로만 넣는다.

## 알려진 이슈

- 판정 캐시(`jjg_verdict_cache`)에 TTL·크기 제한이 없어 계속 쌓인다
- 유튜브 탭이 여러 개면 세션 로그의 read-modify-write가 서로를 덮어쓴다
- [background/verdict.js](background/verdict.js)의 가드레일이 이유 재판정에도 적용되어,
  제목 키워드만으로 이유가 무시될 수 있다 (의도된 동작인지 확인 필요)
- popup 통계 타일이 낡았다: `left_anyway`(이탈 횟수)는 기록하는 코드가 없어 항상 0이고,
  `went_back`(돌아감) 타일은 아예 없다. "총 시청 영상"도 안 본 영상까지 센다
- 목표 달성 확인([content/completion.js](content/completion.js))은 임시 최소 구현
- 다음 세션 맞춤 조언은 실제 세션 기록에 근거한 참고용 제안이며 자동 차단 정책으로 적용되지 않는다.
  기존 데이터 호환을 위해 내부 저장 키 `NEXT_SESSION_RULES`와 `rule` 필드명은 유지한다.
