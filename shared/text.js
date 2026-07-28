// 문자열 정리 헬퍼. background와 popup이 공유한다.
(function (root) {
  "use strict";

  function textOrEmpty(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function stringArray(value, maxItems = 8) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }

  function uniqueStrings(items, maxItems = 6) {
    return [...new Set(items.filter(Boolean))].slice(0, maxItems);
  }

  const api = Object.freeze({ textOrEmpty, stringArray, uniqueStrings });

  root.JJG_TEXT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
