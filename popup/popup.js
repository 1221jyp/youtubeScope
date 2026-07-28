// [파트: 세션 리포트 · 통계] popup 화면. 통계·체인 렌더와 AI 리포트 요청을 담당한다.
const { STORAGE_KEYS } = globalThis.JJG_SCHEMA;
const storage = globalThis.JJG_STORAGE;

let reportLoading = false;

function appendTextElement(parent, tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function renderChain(log) {
  const chainEl = document.getElementById("jjg-chain");
  chainEl.replaceChildren();
  if (log.length === 0) {
    appendTextElement(chainEl, "div", "jjg-empty", "아직 시청한 영상이 없어요.");
    return;
  }

  log.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "jjg-chain-item";
    let icon = "";
    if (entry.action === "left_anyway") {
      item.classList.add("left");
      icon = "⚠️ ";
    } else if (entry.action === "approved_reason") {
      item.classList.add("approved");
      icon = "✅ ";
    } else if (entry.action === "went_back") {
      item.classList.add("prevented");
      icon = "↩️ ";
    } else if (entry.action === "skipped") {
      item.classList.add("skipped");
      icon = "⏭️ ";
    } else if (entry.action === "blocked") {
      item.classList.add("blocked");
      icon = "🚫 ";
    }
    item.textContent = `${icon}${entry.title || "(제목 없음)"}`;
    if ((entry.action === "skipped" || entry.action === "blocked") && entry.reason) {
      appendTextElement(item, "small", "", ` (${entry.reason})`);
    }
    if (entry.action === "approved_reason" && entry.userReason) {
      appendTextElement(item, "small", "", ` (내 이유: ${entry.userReason})`);
    }
    chainEl.appendChild(item);
    if (idx < log.length - 1) appendTextElement(chainEl, "div", "jjg-chain-arrow", "↓");
  });
}

function addReportSection(parent, heading, content, prominent = false) {
  const section = document.createElement("section");
  section.className = prominent ? "jjg-report-section prominent" : "jjg-report-section";
  appendTextElement(section, "h3", "", heading);
  appendTextElement(section, "p", "", content || "해당 내용이 없습니다.");
  parent.appendChild(section);
}

function addReportList(parent, heading, items) {
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

function renderReport(report) {
  const output = document.getElementById("jjg-report-output");
  output.replaceChildren();
  addReportSection(output, "세션 요약", report?.summary, true);

  const first = report?.firstDeviation;
  const firstText =
    first?.title || first?.reason
      ? [first.title, first.reason].filter(Boolean).join(" — ")
      : "이번 세션에서는 확인된 이탈이 없습니다.";
  addReportSection(output, "첫 이탈 지점", firstText, true);

  const path = Array.isArray(report?.diversionPath) ? report.diversionPath.filter(Boolean) : [];
  addReportSection(
    output,
    "주요 이탈 경로",
    path.length ? path.join(" → ") : "표시할 이탈 경로가 없습니다."
  );
  addReportList(output, "발견된 패턴", report?.patterns);
  addReportList(output, "다음 세션 추천", report?.recommendations);
  addReportSection(output, "AI 마무리 메시지", report?.encouragement);

  document.getElementById("jjg-report-error").hidden = true;
  document.getElementById("jjg-report-content").hidden = false;
  document.getElementById("jjg-report-generate").hidden = true;
}

function showReportError(message) {
  document.getElementById("jjg-report-error-message").textContent =
    message || "AI 리포트를 생성하지 못했습니다.";
  document.getElementById("jjg-report-error").hidden = false;
  document.getElementById("jjg-report-content").hidden = true;
  document.getElementById("jjg-report-generate").hidden = true;
}

function setLoading(loading) {
  reportLoading = loading;
  document.getElementById("jjg-report-loading").hidden = !loading;
  document.getElementById("jjg-report-generate").disabled = loading;
  document.getElementById("jjg-report-retry").disabled = loading;
  document.getElementById("jjg-report-regenerate").disabled = loading;
  if (loading) {
    document.getElementById("jjg-report-error").hidden = true;
    document.getElementById("jjg-report-content").hidden = true;
    document.getElementById("jjg-report-generate").hidden = true;
  }
}

function requestReport(force = false) {
  if (reportLoading) return;
  setLoading(true);
  chrome.runtime.sendMessage({ type: "GENERATE_SESSION_REPORT", force }, (response) => {
    setLoading(false);
    if (chrome.runtime.lastError || !response) {
      showReportError("확장 프로그램과 통신하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    if (!response.ok) {
      showReportError(response.error);
      return;
    }
    renderReport(response.report);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const data = await storage.get(Object.values(STORAGE_KEYS));
  const purpose = data[STORAGE_KEYS.PURPOSE] || "(설정 안 됨)";
  const sessionId = data[STORAGE_KEYS.SESSION_ID];
  const log = Array.isArray(data[STORAGE_KEYS.SESSION_LOG]) ? data[STORAGE_KEYS.SESSION_LOG] : [];

  document.getElementById("jjg-purpose").textContent = `목적: ${purpose}`;
  document.getElementById("jjg-total").textContent = String(log.length);
  document.getElementById("jjg-leaves").textContent = String(
    log.filter((entry) => entry.action === "left_anyway").length
  );
  document.getElementById("jjg-approved").textContent = String(
    log.filter((entry) => entry.action === "approved_reason").length
  );
  document.getElementById("jjg-skipped").textContent = String(
    log.filter((entry) => entry.action === "skipped").length
  );
  document.getElementById("jjg-blocked").textContent = String(
    log.filter((entry) => entry.action === "blocked").length
  );
  renderChain(log);

  const cached = data[STORAGE_KEYS.SESSION_REPORT];
  if (sessionId != null && cached?.sessionId === sessionId && cached.report) {
    renderReport(cached.report);
  }

  document.getElementById("jjg-report-generate").addEventListener("click", () => requestReport(false));
  document.getElementById("jjg-report-retry").addEventListener("click", () => requestReport(false));
  document.getElementById("jjg-report-regenerate").addEventListener("click", () => requestReport(true));
});
