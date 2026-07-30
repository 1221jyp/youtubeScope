// [파트: 세션 로그] 영상 흐름 기록. 저장 형식은 SCHEMA.md의 "로그 action과 공통 로그"를 따른다.
(function (root) {
  "use strict";

  const {
    STORAGE_KEYS,
    normalizeReasonVerdict,
    normalizeLogEntry,
  } = root.JJG_SCHEMA;

  async function readLog() {
    const data = await root.JJG_STORAGE.get([STORAGE_KEYS.SESSION_LOG]);
    return data[STORAGE_KEYS.SESSION_LOG] || [];
  }

  // 같은 영상이 이미 있으면 새로 만들지 않고 기존 인덱스를 반환한다.
  async function appendLog(entry) {
    const log = await readLog();

    const normalized = normalizeLogEntry(entry);
    if (!normalized.valid) {
      console.warn("[조준경] 유효하지 않은 로그 저장 거부:", normalized.errors);
      return -1;
    }

    const existingIndex = log.findIndex(
      (item) => item.videoId === normalized.value.videoId
    );

    if (existingIndex !== -1) {
      log[existingIndex] = {
        ...log[existingIndex],
        ...normalized.value,
      };

      await root.JJG_STORAGE.set({
        [STORAGE_KEYS.SESSION_LOG]: log,
      });

      return existingIndex;
    }

    log.push(normalized.value);

    await root.JJG_STORAGE.set({
      [STORAGE_KEYS.SESSION_LOG]: log,
    });

    return log.length - 1;
  }

  // 차단 시 만든 로그를 사용자의 최종 선택으로 갱신
  async function updateLogEntry(index, updates) {
    const log = await readLog();

    if (!log[index]) return false;

    const updated = {
      ...log[index],
      ...updates,
    };

    if (updated.reasonVerdict) {
      const reasonResult = normalizeReasonVerdict(updated.reasonVerdict);

      if (!reasonResult.valid) {
        console.warn(
          "[조준경] 유효하지 않은 reasonVerdict:",
          reasonResult.errors
        );
        return false;
      }

      updated.reasonVerdict = reasonResult.value;
    }

    const normalized = normalizeLogEntry(updated);

    if (!normalized.valid) {
      console.warn(
        "[조준경] 유효하지 않은 로그 저장 거부:",
        normalized.errors
      );
      return false;
    }

    log[index] = normalized.value;

    await root.JJG_STORAGE.set({
      [STORAGE_KEYS.SESSION_LOG]: log,
    });

    return true;
  }

  root.JJG_LOG = Object.freeze({
    readLog,
    appendLog,
    updateLogEntry,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);