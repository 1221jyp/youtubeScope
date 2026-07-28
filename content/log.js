// [파트: 세션 로그] 영상 흐름 기록. 저장 형식은 SCHEMA.md의 "로그 action과 공통 로그"를 따른다.
(function (root) {
  "use strict";

  const { STORAGE_KEYS } = root.JJG_SCHEMA;

  async function readLog() {
    const data = await root.JJG_STORAGE.get([STORAGE_KEYS.SESSION_LOG]);
    return data[STORAGE_KEYS.SESSION_LOG] || [];
  }

  // 추가한 항목의 인덱스를 돌려준다. 이후 사용자의 선택으로 같은 항목을 갱신할 때 쓴다.
  async function appendLog(entry) {
    const log = await readLog();
    log.push(entry);
    await root.JJG_STORAGE.set({ [STORAGE_KEYS.SESSION_LOG]: log });
    return log.length - 1;
  }

  // 차단된 시점에 남긴 로그 항목을, 사용자가 나중에 내리는 선택(돌아가기/이유 제출)으로 갱신한다.
  async function updateLogEntry(index, updates) {
    const log = await readLog();
    if (!log[index]) return;
    Object.assign(log[index], updates);
    await root.JJG_STORAGE.set({ [STORAGE_KEYS.SESSION_LOG]: log });
  }

  root.JJG_LOG = Object.freeze({ readLog, appendLog, updateLogEntry });
})(typeof globalThis !== "undefined" ? globalThis : this);
