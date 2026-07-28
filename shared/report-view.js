// 세션 리포트를 DOM으로 그린다. popup 화면과 유튜브 페이지의 종료 리포트 모달이 함께 쓴다.
// AI가 만든 문자열을 다루므로 innerHTML을 쓰지 않고 textContent로만 넣는다.
(function (root) {
  "use strict";

  function appendTextElement(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function addSection(parent, heading, content, prominent = false) {
    const section = document.createElement("section");
    section.className = prominent ? "jjg-report-section prominent" : "jjg-report-section";
    appendTextElement(section, "h3", "", heading);
    appendTextElement(section, "p", "", content || "해당 내용이 없습니다.");
    parent.appendChild(section);
  }

  function addList(parent, heading, items) {
    const section = document.createElement("section");
    section.className = "jjg-report-section";
    appendTextElement(section, "h3", "", heading);
    if (!Array.isArray(items) || items.length === 0) {
      appendTextElement(section, "p", "", "발견된 내용이 없습니다.");
    } else {
      const list = document.createElement("ul");
      items.forEach((item) => appendTextElement(list, "li", "", String(item)));
      section.appendChild(list);
    }
    parent.appendChild(section);
  }

  // container의 기존 내용을 비우고 리포트를 그린다.
  function renderReport(container, report) {
    container.replaceChildren();
    addSection(container, "세션 요약", report?.summary, true);

    const first = report?.firstDeviation;
    const firstText =
      first?.title || first?.reason
        ? [first.title, first.reason].filter(Boolean).join(" — ")
        : "이번 세션에서는 확인된 이탈이 없습니다.";
    addSection(container, "첫 이탈 지점", firstText, true);

    const path = Array.isArray(report?.diversionPath) ? report.diversionPath.filter(Boolean) : [];
    addSection(
      container,
      "주요 이탈 경로",
      path.length ? path.join(" → ") : "표시할 이탈 경로가 없습니다."
    );
    addList(container, "발견된 패턴", report?.patterns);
    addList(container, "다음 세션 추천", report?.recommendations);
    addSection(container, "AI 마무리 메시지", report?.encouragement);
  }

  const api = Object.freeze({ appendTextElement, addSection, addList, renderReport });

  root.JJG_REPORT_VIEW = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
