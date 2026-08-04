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

  const SOURCE_LABELS = Object.freeze({
    search: "검색",
    recommendation: "추천 영상",
    home: "홈",
    subscriptions: "구독",
    playlist: "재생목록",
    shorts: "Shorts",
    history: "기록",
    external: "외부 진입",
    direct: "직접 진입",
    unknown: "이동 원인 불명",
  });

  const ACTION_LABELS = Object.freeze({
    watched: "관련 시청",
    approved_reason: "이유 승인",
    left_anyway: "실제 이탈",
    went_back: "돌아감",
    blocked: "차단",
    skipped: "판정 건너뜀",
  });

  function formatDuration(ms, { estimated = false } = {}) {
    if (!Number.isFinite(ms) || ms < 0) return "측정 불가";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const value = minutes > 0
      ? `${minutes}분${seconds ? ` ${seconds}초` : ""}`
      : `${seconds}초`;
    return estimated ? `약 ${value}` : value;
  }

  function renderTimeSummary(container, timeStats) {
    if (!timeStats || typeof timeStats !== "object") return;
    const section = document.createElement("section");
    section.className = "jjg-report-section jjg-time-summary";
    appendTextElement(section, "h3", "", "영상 페이지 체류시간 요약");
    const rows = [
      ["세션 시간", timeStats.sessionDurationMs],
      ["측정된 영상 체류시간", timeStats.trackedDwellMs],
      ["목표 관련 체류시간", timeStats.focusedDwellMs],
      ["실제 이탈 체류시간", timeStats.deviationDwellMs],
      ["측정되지 않은 시간", timeStats.untrackedMs],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "jjg-report-metric";
      appendTextElement(row, "span", "jjg-report-metric-label", label);
      appendTextElement(row, "span", "jjg-report-metric-value", formatDuration(value));
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  function renderSourceStats(container, sourceStats) {
    if (!Array.isArray(sourceStats) || sourceStats.length === 0) return;
    const section = document.createElement("section");
    section.className = "jjg-report-section jjg-source-summary";
    appendTextElement(section, "h3", "", "이동 원인 요약");
    const list = document.createElement("ul");
    sourceStats.forEach((item) => {
      appendTextElement(
        list,
        "li",
        "",
        `${SOURCE_LABELS[item?.source] || SOURCE_LABELS.unknown} ${Number(item?.count) || 0}개 · 이탈 ${Number(item?.actualDeviations) || 0}회`
      );
    });
    section.appendChild(list);
    container.appendChild(section);
  }

  function renderTimeline(container, timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) return;
    const section = document.createElement("section");
    section.className = "jjg-report-section jjg-report-timeline";
    appendTextElement(section, "h3", "", "시청 흐름 타임라인");
    timeline.forEach((item, index) => {
      if (index > 0) {
        appendTextElement(
          section,
          "div",
          "jjg-timeline-arrow",
          `↓ ${SOURCE_LABELS[item?.navigationSource] || SOURCE_LABELS.unknown}으로 이동`
        );
      }
      const card = document.createElement("article");
      card.className = "jjg-timeline-item";
      appendTextElement(
        card,
        "div",
        "jjg-timeline-title",
        `[${SOURCE_LABELS[item?.navigationSource] || SOURCE_LABELS.unknown}] ${item?.title || "(제목 없음)"}`
      );
      const dwellText = item?.dwellMs == null
        ? "체류시간 측정 불가"
        : `체류 ${formatDuration(item.dwellMs, { estimated: item.timeMeasurement === "estimated" })}`;
      appendTextElement(
        card,
        "div",
        "jjg-timeline-meta",
        `${dwellText} · ${ACTION_LABELS[item?.action] || item?.action || "상태 불명"}`
      );
      section.appendChild(card);
    });
    container.appendChild(section);
  }

  function renderDataQuality(container, dataQuality) {
    const warnings = Array.isArray(dataQuality?.warnings) ? dataQuality.warnings : [];
    if (warnings.length === 0) return;
    addList(container, "데이터 품질 안내", warnings);
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
    addList(container, "AI의 추가 제안", report?.recommendations);
    addSection(container, "AI 마무리 메시지", report?.encouragement);
    renderTimeSummary(container, report?.timeStats);
    renderSourceStats(container, report?.sourceStats);
    renderTimeline(container, report?.timeline);
    renderDataQuality(container, report?.dataQuality);
  }

  function renderNextSessionRules(
    container,
    rules,
    emptyMessage = "이번 세션에서는 제안할 만큼 구체적인 행동 근거가 없습니다."
  ) {
    container.replaceChildren();
    const section = document.createElement("section");
    section.className = "jjg-report-section jjg-next-session-rules";
    appendTextElement(section, "h3", "", "다음 세션 맞춤 조언");
    appendTextElement(
      section,
      "p",
      "jjg-next-advice-description",
      "이번 세션의 실제 기록을 바탕으로 다음 세션에서 시도해볼 행동을 제안해요. 이 조언은 자동으로 적용되지 않습니다."
    );

    if (!Array.isArray(rules) || rules.length === 0) {
      appendTextElement(section, "p", "", emptyMessage);
      container.appendChild(section);
      return;
    }

    const list = document.createElement("ol");
    rules.forEach((item) => {
      const listItem = document.createElement("li");
      appendTextElement(listItem, "div", "jjg-next-advice-label", "조언");
      appendTextElement(listItem, "div", "jjg-next-rule", item?.rule || "");
      appendTextElement(listItem, "div", "jjg-next-advice-label", "근거");
      appendTextElement(
        listItem,
        "div",
        "jjg-next-rule-evidence",
        item?.evidence || ""
      );
      list.appendChild(listItem);
    });
    section.appendChild(list);
    container.appendChild(section);
  }

  const api = Object.freeze({
    appendTextElement,
    addSection,
    addList,
    renderReport,
    formatDuration,
    renderTimeSummary,
    renderSourceStats,
    renderTimeline,
    renderDataQuality,
    renderNextSessionRules,
  });

  root.JJG_REPORT_VIEW = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
