document.addEventListener("DOMContentLoaded", async () => {
  const data = await new Promise((resolve) =>
    chrome.storage.local.get(["jjg_purpose", "jjg_session_log"], resolve)
  );

  const purpose = data.jjg_purpose || "(설정 안 됨)";
  const log = data.jjg_session_log || [];

  document.getElementById("jjg-purpose").textContent = `목적: ${purpose}`;
  document.getElementById("jjg-total").textContent = String(log.length);
  document.getElementById("jjg-leaves").textContent = String(
    log.filter((e) => e.action === "left_anyway").length
  );
  document.getElementById("jjg-skipped").textContent = String(
    log.filter((e) => e.action === "skipped").length
  );

  const chainEl = document.getElementById("jjg-chain");
  if (log.length === 0) {
    chainEl.innerHTML = '<div class="jjg-empty">아직 시청한 영상이 없어요.</div>';
    return;
  }

  chainEl.innerHTML = log
    .map((entry, idx) => {
      const isLeft = entry.action === "left_anyway";
      const isSkipped = entry.action === "skipped";
      const cls = isLeft ? " left" : isSkipped ? " skipped" : "";
      const icon = isLeft ? "⚠️ " : isSkipped ? "⏭️ " : "✅ ";
      const reasonSuffix = isSkipped && entry.reason ? ` <small>(${escapeHtml(entry.reason)})</small>` : "";
      
      const item = `<div class="jjg-chain-item${cls}">${icon}<strong>${escapeHtml(
        entry.title || "(제목 없음)"
      )}</strong>${reasonSuffix}</div>`;
      const arrow = idx < log.length - 1 ? '<div class="jjg-chain-arrow">↓</div>' : "";
      return item + arrow;
    })
    .join("");
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
