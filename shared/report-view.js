// AI 몰입 리포트를 DOM으로 그린다. popup과 유튜브 종료 모달이 함께 사용한다.
// 사용자·AI 문자열은 반드시 textContent로 출력하고 innerHTML을 사용하지 않는다.
(function (root) {
  "use strict";

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
    watched: "목표 관련",
    approved_reason: "이유 승인",
    left_anyway: "실제 이탈",
    went_back: "AI 개입 후 돌아감",
    blocked: "관련 없음으로 차단",
    skipped: "판정 건너뜀",
  });

  const COMPLETION_LABELS = Object.freeze({
    achieved: "달성",
    partial: "부분 달성",
    not_achieved: "미달성",
  });

  function appendTextElement(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text == null ? "" : String(text);
    parent.appendChild(element);
    return element;
  }

  function addSection(parent, heading, content, prominent = false) {
    const section = document.createElement("section");
    section.className = prominent ? "jjg-report-section prominent" : "jjg-report-section";
    appendTextElement(section, "h3", "", heading);
    appendTextElement(section, "p", "", content || "해당 내용이 없습니다.");
    parent.appendChild(section);
    return section;
  }

  function addList(parent, heading, items) {
    const section = document.createElement("section");
    section.className = "jjg-report-section";
    appendTextElement(section, "h3", "", heading);
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (safeItems.length === 0) {
      appendTextElement(section, "p", "", "발견된 내용이 없습니다.");
    } else {
      const list = document.createElement("ul");
      safeItems.forEach((item) => appendTextElement(list, "li", "", item));
      section.appendChild(list);
    }
    parent.appendChild(section);
    return section;
  }

  function formatDuration(ms, { estimated = false } = {}) {
    if (!Number.isFinite(Number(ms)) || Number(ms) < 0) return "측정 불가";
    const totalSeconds = Math.floor(Number(ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const value = minutes > 0
      ? `${minutes}분${seconds ? ` ${seconds}초` : ""}`
      : `${seconds}초`;
    return estimated ? `약 ${value}` : value;
  }

  function formatRate(rate) {
    if (!Number.isFinite(Number(rate)) || Number(rate) < 0) return "측정 정보 없음";
    return `${Math.round(Number(rate) * 100)}%`;
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || SOURCE_LABELS.unknown;
  }

  function reportHasActualDeviation(report) {
    if (typeof report?.hasActualDeviation === "boolean") return report.hasActualDeviation;
    if (Number.isFinite(Number(report?.stats?.actualDeviations))) {
      return Number(report.stats.actualDeviations) > 0;
    }
    return Boolean(report?.firstDeviation?.title);
  }

  function renderGoalOverview(container, report) {
    const goal = report?.goalOverview || {};
    const section = document.createElement("section");
    section.className = "jjg-report-goal-card";
    appendTextElement(section, "div", "jjg-report-eyebrow", "오늘의 목표와 달성 결과");
    appendTextElement(
      section,
      "h3",
      "jjg-report-goal-title",
      goal.title || goal.rawPurpose || "이번 세션의 목표"
    );
    const completion = COMPLETION_LABELS[goal.completionStatus] || "달성 결과 확인 완료";
    const duration = Number.isFinite(Number(goal.sessionDurationMs))
      ? ` · ${formatDuration(goal.sessionDurationMs)} 진행` : "";
    appendTextElement(section, "p", "jjg-report-goal-result", `${completion}${duration}`);
    if (goal.completionCondition) {
      appendTextElement(
        section,
        "p",
        "jjg-report-goal-condition",
        `달성 조건: ${goal.completionCondition}`
      );
    }
    container.appendChild(section);
  }

  function renderCoreStats(container, report) {
    const stats = report?.stats || {};
    const timeStats = report?.timeStats || {};
    const section = document.createElement("section");
    section.className = "jjg-report-core-metrics";
    appendTextElement(section, "h3", "jjg-report-section-title", "핵심 지표");
    const grid = document.createElement("div");
    grid.className = "jjg-report-metric-grid";
    const metrics = [
      ["목표 관련 체류 비율", formatRate(timeStats.goalRelatedRate)],
      ["AI 이탈 방지", `${Number(stats.wentBack) || 0}회`],
      ["승인된 목적 외 시청", `${Number(stats.approvedReason) || 0}회`],
      ["실제 이탈", `${Number(stats.actualDeviations) || 0}회`],
    ];
    metrics.forEach(([label, value], index) => {
      const card = document.createElement("div");
      card.className = `jjg-report-metric-card metric-${index + 1}`;
      appendTextElement(card, "div", "jjg-report-metric-value", value);
      appendTextElement(card, "div", "jjg-report-metric-label", label);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    if (!reportHasActualDeviation(report)) {
      appendTextElement(
        section,
        "p",
        "jjg-report-no-deviation",
        "이번 세션에서는 확인된 실제 이탈이 없습니다."
      );
    }
    container.appendChild(section);
  }

  function renderAiCoreAnalysis(container, report) {
    const section = document.createElement("section");
    section.className = "jjg-report-ai-core";
    appendTextElement(section, "h3", "", "AI 핵심 분석");
    const summary =
      report?.aiCoreAnalysis?.summary ||
      report?.analysis?.summary ||
      report?.summary ||
      "세션 기록을 바탕으로 분석할 정보가 충분하지 않습니다.";
    appendTextElement(section, "p", "", summary);
    if (report?.aiStatus?.generated === false && report.aiStatus.message) {
      appendTextElement(section, "p", "jjg-report-ai-fallback", report.aiStatus.message);
    }
    container.appendChild(section);
  }

  function interventionResult(action) {
    if (action === "went_back") return "실제 이탈 방지";
    if (action === "approved_reason") return "목적과의 연결 이유 승인";
    if (action === "blocked") return "관련 없는 영상 접근 차단";
    return ACTION_LABELS[action] || "결과 확인";
  }

  function addDetailRow(parent, label, value) {
    if (value == null || value === "") return;
    const row = document.createElement("div");
    row.className = "jjg-intervention-row";
    appendTextElement(row, "span", "jjg-intervention-label", label);
    appendTextElement(row, "span", "jjg-intervention-value", value);
    parent.appendChild(row);
  }

  function renderInterventionMoments(container, moments) {
    const section = document.createElement("section");
    section.className = "jjg-report-interventions";
    appendTextElement(section, "h3", "jjg-report-section-title", "AI가 몰입을 지켜준 순간");
    const safeMoments = Array.isArray(moments) ? moments.slice(0, 3) : [];
    if (safeMoments.length === 0) {
      appendTextElement(section, "p", "jjg-report-muted", "이번 세션에는 별도의 AI 개입 기록이 없습니다.");
      container.appendChild(section);
      return;
    }
    safeMoments.forEach((moment) => {
      const card = document.createElement("article");
      card.className = `jjg-intervention-card action-${moment.finalAction || "unknown"}`;
      appendTextElement(card, "h4", "", moment.title || "제목이 기록되지 않은 영상");
      const initial = [
        moment.initialReason,
        Number.isFinite(Number(moment.initialScore)) ? `${moment.initialScore}점` : "",
      ].filter(Boolean).join(" · ");
      addDetailRow(card, "최초 판단", initial);
      addDetailRow(card, "이동 원인", sourceLabel(moment.navigationSource));
      addDetailRow(card, "사용자 이유", moment.userReason);
      addDetailRow(card, "AI 재판정", moment.reasonVerdict?.explanation);
      if (moment.dwellMs != null && moment.timeMeasurement !== "unknown") {
        addDetailRow(
          card,
          "체류시간",
          formatDuration(moment.dwellMs, { estimated: moment.timeMeasurement === "estimated" })
        );
      }
      addDetailRow(card, "결과", interventionResult(moment.finalAction));
      section.appendChild(card);
    });
    container.appendChild(section);
  }

  function timelineMeta(item) {
    const parts = [];
    if (item?.dwellMs != null && item?.timeMeasurement !== "unknown") {
      parts.push(`${formatDuration(item.dwellMs, {
        estimated: item.timeMeasurement === "estimated",
      })} 체류`);
    }
    parts.push(`${sourceLabel(item?.navigationSource)}으로 이동`);
    parts.push(ACTION_LABELS[item?.action] || "상태 불명");
    return parts.join(" · ");
  }

  function renderTimeline(container, timeline, heading = "시청 흐름 타임라인") {
    const section = document.createElement("section");
    section.className = "jjg-report-timeline";
    appendTextElement(section, "h3", "jjg-report-section-title", heading);
    const safeTimeline = Array.isArray(timeline) ? timeline : [];
    if (safeTimeline.length === 0) {
      appendTextElement(section, "p", "jjg-report-muted", "기록된 영상 이동 흐름이 없습니다.");
      container.appendChild(section);
      return section;
    }
    safeTimeline.forEach((item, index) => {
      if (index > 0) appendTextElement(section, "div", "jjg-timeline-arrow", "↓");
      const card = document.createElement("article");
      card.className = `jjg-timeline-item action-${item?.action || "unknown"}`;
      appendTextElement(card, "div", "jjg-timeline-title", item?.title || "(제목 없음)");
      appendTextElement(card, "div", "jjg-timeline-meta", timelineMeta(item));
      section.appendChild(card);
    });
    container.appendChild(section);
    return section;
  }

  function renderDeviationAnalysis(container, report) {
    if (!reportHasActualDeviation(report)) return;
    const first = report?.firstDeviation || {};
    const section = document.createElement("section");
    section.className = "jjg-report-deviation";
    appendTextElement(section, "h3", "", "실제 이탈 분석");
    appendTextElement(section, "h4", "", first.title || "최초 실제 이탈 영상");
    if (first.fromTitle) addDetailRow(section, "직전 영상", first.fromTitle);
    addDetailRow(section, "이동 원인", sourceLabel(first.navigationSource));
    if (first.dwellMs != null && first.timeMeasurement !== "unknown") {
      addDetailRow(
        section,
        "이탈 영상 체류시간",
        formatDuration(first.dwellMs, { estimated: first.timeMeasurement === "estimated" })
      );
    }
    addDetailRow(section, "판정 근거", first.reason);
    const rate = report?.timeStats?.actualDeviationRate;
    if (rate != null) addDetailRow(section, "측정 체류시간 중 이탈 비중", formatRate(rate));
    const path = Array.isArray(report?.diversionPath) ? report.diversionPath.filter(Boolean) : [];
    if (path.length) addDetailRow(section, "주요 이탈 경로", path.join(" → "));
    const analysis = report?.analysis?.deviationAnalysis?.summary;
    if (analysis) appendTextElement(section, "p", "jjg-deviation-summary", analysis);
    container.appendChild(section);
  }

  function renderTimeSummary(container, timeStats, dataQuality = null) {
    const rows = [
      ["전체 세션 시간", timeStats?.sessionDurationMs],
      ["측정된 영상 체류시간", timeStats?.measuredDwellMs ?? timeStats?.trackedDwellMs],
      ["목표 관련 영상 체류시간", timeStats?.goalRelatedDwellMs ?? timeStats?.focusedDwellMs],
      ["이유 승인 영상 체류시간", timeStats?.approvedReasonDwellMs ?? timeStats?.approvedDwellMs],
      ["이탈 방지 과정 체류시간", timeStats?.preventedDwellMs],
      ["실제 이탈 영상 체류시간", timeStats?.actualDeviationDwellMs ?? timeStats?.deviationDwellMs],
    ];
    const section = document.createElement("section");
    section.className = "jjg-report-detail-block jjg-time-summary";
    appendTextElement(section, "h4", "", "체류시간 상세");
    const hasKnownTime =
      dataQuality == null ||
      Number(dataQuality.measuredTimeEntries || 0) + Number(dataQuality.estimatedTimeEntries || 0) > 0;
    rows.forEach(([label, value], index) => {
      const row = document.createElement("div");
      row.className = "jjg-report-detail-row";
      appendTextElement(row, "span", "", label);
      appendTextElement(
        row,
        "strong",
        "",
        index > 0 && !hasKnownTime ? "측정 불가" : formatDuration(value)
      );
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  function renderSourceStats(container, sourceStats) {
    const section = document.createElement("section");
    section.className = "jjg-report-detail-block jjg-source-summary";
    appendTextElement(section, "h4", "", "이동 원인별 기록");
    const list = document.createElement("ul");
    const safeStats = Array.isArray(sourceStats) ? sourceStats : [];
    safeStats.forEach((item) => {
      const dwell = Number(item?.timedEntries) > 0
        ? formatDuration(Number(item.dwellMs) || 0, { estimated: Number(item.estimatedEntries) > 0 })
        : "체류시간 측정 불가";
      appendTextElement(
        list,
        "li",
        "",
        `${sourceLabel(item?.source)} ${Number(item?.count) || 0}회 · ${dwell} · ` +
          `돌아감 ${Number(item?.wentBack) || 0}회 · 승인 ${Number(item?.approvedReason) || 0}회 · ` +
          `실제 이탈 ${Number(item?.actualDeviations) || 0}회`
      );
    });
    if (safeStats.length === 0) appendTextElement(list, "li", "", "확인된 이동 원인이 없습니다.");
    section.appendChild(list);
    container.appendChild(section);
  }

  function renderActionStats(container, stats) {
    const section = document.createElement("section");
    section.className = "jjg-report-detail-block";
    appendTextElement(section, "h4", "", "행동별 상세 통계");
    const values = [
      ["목표 관련", stats?.watched],
      ["이유 승인", stats?.approvedReason],
      ["AI 개입 후 돌아감", stats?.wentBack],
      ["차단", stats?.blocked],
      ["실제 이탈", stats?.actualDeviations],
      ["판정 건너뜀", stats?.skipped],
    ];
    values.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "jjg-report-detail-row";
      appendTextElement(row, "span", "", label);
      appendTextElement(row, "strong", "", `${Number(value) || 0}회`);
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  function renderDataQuality(container, dataQuality) {
    const warnings = Array.isArray(dataQuality?.warnings) ? dataQuality.warnings : [];
    const items = [
      "체류시간은 실제 영상 재생시간이 아니라 영상 페이지에 머문 시간을 뜻합니다.",
      `측정되지 않은 로그 ${Number(dataQuality?.unknownTimeEntries) || 0}개`,
      ...warnings,
    ];
    addList(container, "데이터 품질 안내", items);
  }

  function renderAiProcess(container) {
    const section = document.createElement("section");
    section.className = "jjg-report-detail-block jjg-ai-process";
    appendTextElement(section, "h4", "", "AI 분석 과정");
    const steps = [
      ["입력", "사용자 목적, 구체화된 목표, 영상 제목·설명, 사용자 이유"],
      ["AI 처리", "목적 관련성 3단계 판정, 사용자 이유 재판정, 세션 패턴 해석"],
      ["코드 계산", "체류시간, 이동 원인, 행동 횟수, 실제 이탈과 방지 결과"],
      ["결과", "영상 통과·이유 요청·차단 및 세션 종료 후 맞춤 분석"],
    ];
    steps.forEach(([label, text]) => addDetailRow(section, label, text));
    container.appendChild(section);
  }

  function renderDetails(container, report) {
    const details = document.createElement("details");
    details.className = "jjg-report-details";
    appendTextElement(details, "summary", "", "상세 분석 보기");
    const body = document.createElement("div");
    body.className = "jjg-report-details-body";
    renderTimeline(body, report?.timeline, "전체 영상 타임라인");
    renderSourceStats(body, report?.sourceStats);
    renderTimeSummary(body, report?.timeStats, report?.dataQuality);
    renderActionStats(body, report?.stats);
    renderDataQuality(body, report?.dataQuality);
    renderAiProcess(body);
    details.appendChild(body);
    container.appendChild(details);
    return details;
  }

  function ensureNextSessionRulesContainer(container) {
    let host = container.querySelector?.("#jjg-next-session-rules");
    if (host) return host;
    host = document.createElement("div");
    host.id = "jjg-next-session-rules";
    host.className = "jjg-next-session-rules-host";
    const details = container.querySelector?.(".jjg-report-details");
    if (details && typeof container.insertBefore === "function") container.insertBefore(host, details);
    else container.appendChild(host);
    return host;
  }

  function renderReport(container, report) {
    container.replaceChildren();
    const reportRoot = document.createElement("div");
    reportRoot.className = "jjg-immersion-report";
    appendTextElement(reportRoot, "h2", "jjg-immersion-report-title", "AI 몰입 리포트");
    renderGoalOverview(reportRoot, report);
    renderCoreStats(reportRoot, report);
    renderAiCoreAnalysis(reportRoot, report);
    renderInterventionMoments(reportRoot, report?.interventionMoments);
    renderTimeline(
      reportRoot,
      Array.isArray(report?.coreTimeline) ? report.coreTimeline.slice(0, 5) : (report?.timeline || []).slice(0, 5),
      "간단한 몰입 흐름"
    );
    renderDeviationAnalysis(reportRoot, report);
    const rulesHost = document.createElement("div");
    rulesHost.id = "jjg-next-session-rules";
    rulesHost.className = "jjg-next-session-rules-host";
    reportRoot.appendChild(rulesHost);
    renderDetails(reportRoot, report);
    container.appendChild(reportRoot);
    return { reportRoot, rulesHost };
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
    const safeRules = Array.isArray(rules) ? rules.slice(0, 2) : [];
    if (safeRules.length === 0) {
      appendTextElement(section, "p", "jjg-report-muted", emptyMessage);
      container.appendChild(section);
      return;
    }
    const list = document.createElement("ol");
    safeRules.forEach((item) => {
      const listItem = document.createElement("li");
      appendTextElement(listItem, "div", "jjg-next-advice-label", "조언");
      appendTextElement(listItem, "div", "jjg-next-rule", item?.rule || "");
      appendTextElement(listItem, "div", "jjg-next-advice-label", "근거");
      appendTextElement(listItem, "div", "jjg-next-rule-evidence", item?.evidence || "");
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
    formatRate,
    renderTimeSummary,
    renderCoreStats,
    renderSourceStats,
    renderTimeline,
    renderDataQuality,
    reportHasActualDeviation,
    renderNextSessionRules,
    ensureNextSessionRulesContainer,
  });

  root.JJG_REPORT_VIEW = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
