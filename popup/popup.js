// [파트: 세션 리포트 · 통계] popup 화면. 통계·체인 렌더와 AI 리포트 요청을 담당한다.
const {
  STORAGE_KEYS,
  SESSION_STATUS,
  LOG_ACTIONS,
  normalizeCompletionResult,
} = globalThis.JJG_SCHEMA;
const storage = globalThis.JJG_STORAGE;
// 리포트 본문 렌더링은 종료 리포트 모달과 공유한다 (shared/report-view.js).
const { appendTextElement } = globalThis.JJG_REPORT_VIEW;

let reportLoading = false;

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
    if (entry.action === LOG_ACTIONS.LEFT_ANYWAY) {
      item.classList.add("left");
      icon = "⚠️ ";
    } else if (entry.action === LOG_ACTIONS.APPROVED_REASON) {
      item.classList.add("approved");
      icon = "✅ ";
    } else if (entry.action === LOG_ACTIONS.WENT_BACK) {
      item.classList.add("prevented");
      icon = "↩️ ";
    } else if (entry.action === LOG_ACTIONS.SKIPPED) {
      item.classList.add(LOG_ACTIONS.SKIPPED);
      icon = "⏭️ ";
    } else if (entry.action === LOG_ACTIONS.BLOCKED) {
      item.classList.add(LOG_ACTIONS.BLOCKED);
      icon = "🚫 ";
    }
    item.textContent = `${icon}${entry.title || "(제목 없음)"}`;
    if ((entry.action === LOG_ACTIONS.SKIPPED || entry.action === LOG_ACTIONS.BLOCKED) && entry.reason) {
      appendTextElement(item, "small", "", ` (${entry.reason})`);
    }
    if (entry.action === LOG_ACTIONS.APPROVED_REASON && entry.userReason) {
      appendTextElement(item, "small", "", ` (내 이유: ${entry.userReason})`);
    }
    chainEl.appendChild(item);
    if (idx < log.length - 1) appendTextElement(chainEl, "div", "jjg-chain-arrow", "↓");
  });
}

function renderReport(report) {
  globalThis.JJG_REPORT_VIEW.renderReport(document.getElementById("jjg-report-output"), report);

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
    log.filter((entry) => entry.action === LOG_ACTIONS.LEFT_ANYWAY).length
  );
  document.getElementById("jjg-approved").textContent = String(
    log.filter((entry) => entry.action === LOG_ACTIONS.APPROVED_REASON).length
  );
  document.getElementById("jjg-skipped").textContent = String(
    log.filter((entry) => entry.action === LOG_ACTIONS.SKIPPED).length
  );
  document.getElementById("jjg-blocked").textContent = String(
    log.filter((entry) => entry.action === LOG_ACTIONS.BLOCKED).length
  );
  renderChain(log);

  const cached = data[STORAGE_KEYS.SESSION_REPORT];
  const completion = normalizeCompletionResult(data[STORAGE_KEYS.COMPLETION_RESULT]);
  if (
    data[STORAGE_KEYS.SESSION_STATUS] === SESSION_STATUS.ENDED &&
    completion.valid &&
    completion.value &&
    sessionId != null &&
    cached?.sessionId === sessionId &&
    cached.report
  ) {
    renderReport(cached.report);
  }

  document.getElementById("jjg-report-generate").addEventListener("click", () => requestReport(false));
  document.getElementById("jjg-report-retry").addEventListener("click", () => requestReport(false));
  document.getElementById("jjg-report-regenerate").addEventListener("click", () => requestReport(true));
});
