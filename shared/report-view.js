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

  function renderTimeSummary(container, timeStats, dataQuality = null) {
    if (!timeStats || typeof timeStats !== "object") return;
    const section = document.createElement("section");
    section.className = "jjg-report-section jjg-time-summary";
    appendTextElement(section, "h3", "", "영상 페이지 체류시간 요약");
    const rows = [
      ["세션 시간", timeStats.sessionDurationMs],
      ["측정된 영상 체류시간", timeStats.trackedDwellMs],
      ["목표 관련 체류시간", timeStats.focusedDwellMs],
      ["이유 승인 영상 체류시간", timeStats.approvedDwellMs],
      ["측정되지 않은 시간", timeStats.untrackedMs],
    ];
    if (Number(timeStats.deviationDwellMs) > 0) {
      rows.splice(4, 0, ["실제 이탈 영상 체류시간", timeStats.deviationDwellMs]);
    }
    const measuredEntries = Number(dataQuality?.measuredTimeEntries) || 0;
    const estimatedEntries = Number(dataQuality?.estimatedTimeEntries) || 0;
    const hasKnownTime = dataQuality == null || measuredEntries + estimatedEntries > 0;
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "jjg-report-metric";
      appendTextElement(row, "span", "jjg-report-metric-label", label);
      const dependsOnMeasuredEntries = label !== "세션 시간" && label !== "측정되지 않은 시간";
      appendTextElement(
        row,
        "span",
        "jjg-report-metric-value",
        dependsOnMeasuredEntries && !hasKnownTime
          ? "측정 불가"
          : formatDuration(value, {
              estimated: dependsOnMeasuredEntries && estimatedEntries > 0,
            })
      );
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  function renderCoreStats(container, report) {
    const stats = report?.stats || {};
    const section = document.createElement("section");
    section.className = "jjg-report-section jjg-core-stats";
    appendTextElement(section, "h3", "", "핵심 통계");
    const actual = Number(stats.actualDeviations) || 0;
    appendTextElement(
      section,
      "p",
      actual ? "jjg-deviation-found" : "jjg-no-deviation",
      actual
        ? `이번 세션에서 실제 이탈 ${actual}회가 확인되었습니다.`
        : "이번 세션에서는 확인된 실제 이탈이 없습니다."
    );
    appendTextElement(
      section,
      "p",
      "",
      `관련 시청 ${Number(stats.watched) || 0}개 · 이유 승인 ${Number(stats.approvedReason) || 0}개 · ` +
        `돌아가기로 방지 ${Number(stats.wentBack) || 0}회 · 차단 ${Number(stats.blocked) || 0}회`
    );
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
        `${SOURCE_LABELS[item?.source] || SOURCE_LABELS.unknown} ${Number(item?.count) || 0}개 · ` +
          `${Number(item?.timedEntries) > 0
            ? `측정된 체류시간 ${formatDuration(Number(item?.dwellMs) || 0, {
                estimated: Number(item?.estimatedEntries) > 0,
              })}`
            : "체류시간 측정 불가"} · ` +
          `실제 이탈 ${Number(item?.actualDeviations) || 0}회`
      );
    });
    section.appendChild(list);
    container.appendChild(section);
  }

  function renderTimeline(container, timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) {
      addSection(container, "시청 흐름 타임라인", "기록된 영상 이동 흐름이 없습니다.");
      return;
    }
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
      const dwellText = item?.dwellMs == null || item?.timeMeasurement === "unknown"
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
    addList(
      container,
      "데이터 품질 안내",
      [
        "체류시간은 실제 영상 재생시간이 아니라 영상 페이지에 머문 시간을 뜻합니다.",
        ...warnings,
      ]
    );
  }

  function reportHasActualDeviation(report) {
    if (typeof report?.hasActualDeviation === "boolean") return report.hasActualDeviation;
    if (Number.isFinite(Number(report?.stats?.actualDeviations))) {
      return Number(report.stats.actualDeviations) > 0;
    }
    return Boolean(report?.firstDeviation?.title);
  }

  function renderAnalysis(container, heading, analysisPart, always = false) {
    const summary = analysisPart?.summary;
    if (!summary) {
      if (always) addSection(container, heading, "현재 리포트에는 이 분석이 포함되지 않았습니다.");
      return;
    }
    addSection(container, heading, summary);
  }

  // container의 기존 내용을 비우고 리포트를 그린다.
  function renderReport(container, report) {
    container.replaceChildren();
    addSection(container, "세션 요약", report?.summary, true);
    renderAnalysis(container, "목표 달성 결과", report?.analysis?.goalAssessment, true);
    renderCoreStats(container, report);
    renderTimeSummary(container, report?.timeStats, report?.dataQuality);
    renderAnalysis(container, "체류시간 분석", report?.analysis?.timeAnalysis, true);
    renderSourceStats(container, report?.sourceStats);
    renderAnalysis(container, "이동 원인 분석", report?.analysis?.sourceAnalysis, true);
    renderTimeline(container, report?.timeline);
    renderAnalysis(container, "집중 흐름 분석", report?.analysis?.focusAnalysis, true);
    renderAnalysis(container, "집중 유지·이탈 방지 분석", report?.analysis?.preventionAnalysis, true);

    if (reportHasActualDeviation(report)) {
      const first = report?.firstDeviation;
      const firstDetails = [first?.title, first?.reason].filter(Boolean);
      if (first?.dwellMs != null && first?.timeMeasurement !== "unknown") {
        firstDetails.push(
          `체류 ${formatDuration(first.dwellMs, {
            estimated: first.timeMeasurement === "estimated",
          })}`
        );
      }
      if (first?.navigationSource) {
        firstDetails.push(SOURCE_LABELS[first.navigationSource] || SOURCE_LABELS.unknown);
      }
      addSection(container, "첫 이탈 지점", firstDetails.join(" — "), true);
      const path = Array.isArray(report?.diversionPath)
        ? report.diversionPath.filter(Boolean) : [];
      if (path.length) addSection(container, "주요 이탈 경로", path.join(" → "));
      renderAnalysis(container, "실제 이탈 분석", report?.analysis?.deviationAnalysis);
    }

    if (Array.isArray(report?.patterns) && report.patterns.length) {
      addList(container, "판정·선택 기록 분석", report.patterns);
    }
    if (Array.isArray(report?.recommendations) && report.recommendations.length) {
      addList(container, "AI의 추가 제안", report.recommendations);
    }
    if (report?.encouragement) addSection(container, "마무리", report.encouragement);
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
    renderCoreStats,
    renderSourceStats,
    renderTimeline,
    renderDataQuality,
    reportHasActualDeviation,
    renderNextSessionRules,
  });

  root.JJG_REPORT_VIEW = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
