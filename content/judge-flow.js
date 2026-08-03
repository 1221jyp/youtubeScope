// [파트: 영상 판정] /watch 진입 시의 판정 파이프라인.
// 목적 확인 → 제목 대기 → background 판정 요청 → 통과/차단 처리 → 로그 기록.
//
// [status 구분]
// verdict.status가 "timeout"/"error"인 경우는 항상 failOpen: true와 함께 오며,
// AI가 정상적으로 내린 판정이 아니다. 통과는 시키되(사용자를 막지 않기 위해)
// 토스트 문구로 지연/오류를 구분해서 알려주고, 로그의 action은 watched가 아니라
// skipped로 남긴다.
(function (root) {
  "use strict";

  const { SESSION_STATUS, LOG_ACTIONS } = root.JJG_SCHEMA;
  const { showOverlay, removeOverlay, playVideo, showToast } = root.JJG_UI;
  const { getCurrentVideoId, waitForTitle, extractDescription } = root.JJG_NAV;
  const { sendMessageWithTimeout } = root.JJG_MESSAGING;
  const { appendLog, updateLogEntry, updateLogEntryById } = root.JJG_LOG;

  let lastProcessedVideoId = null;

  function failOpenLabel(status) {
    return status === "timeout" ? "응답 지연" : "일시적 오류";
  }

  async function handleWatchPage(force = false) {
    const videoId = getCurrentVideoId();
    if (!videoId) {
      lastProcessedVideoId = null;
      removeOverlay();
      return;
    }
    if (!force && videoId === lastProcessedVideoId) return;
    lastProcessedVideoId = videoId;

    // 몰입 상태(active)에서만 판정한다.
    // 기본 상태(세션 없음/ended)와 종료 진행 중(ending)에는 아무것도 하지 않는다.
    const session = await root.JJG_SESSION.getSession();
    if (session.status !== SESSION_STATUS.ACTIVE || !session.purpose) {
      removeOverlay();
      return;
    }
    const purpose = session.purpose;

    showOverlay();
    const title = await waitForTitle(videoId);
    // 대기 중 다른 영상으로 또 넘어갔으면 이 판정은 버린다.
    if (getCurrentVideoId() !== videoId) return;
    const description = extractDescription();

    const verdict = await sendMessageWithTimeout({
      type: "JUDGE_VIDEO",
      purpose,
      videoId,
      title,
      description,
    });

    if (getCurrentVideoId() !== videoId) return; // 판정 도중 페이지 이동

    const { VIDEO_DECISIONS, normalizeVideoVerdict } = root.JJG_SCHEMA;
    const normalized = normalizeVideoVerdict(verdict);
    let initialVerdict = normalized.valid ? normalized.value : null;

    if (!initialVerdict) {
      let legacyDecision = verdict?.related === false ? VIDEO_DECISIONS.BLOCK : VIDEO_DECISIONS.ALLOW;
      let legacyScore = verdict?.score != null ? verdict.score : (legacyDecision === VIDEO_DECISIONS.ALLOW ? 100 : 10);
      initialVerdict = {
        decision: legacyDecision,
        score: legacyScore,
        reason: verdict?.reason || "",
      };
    }

    if (initialVerdict.decision === VIDEO_DECISIONS.ALLOW) {
      await allowVideo(videoId, title, initialVerdict, verdict.failOpen === true, verdict.status);
      return;
    }
    await blockOrAskVideo(videoId, title, purpose, initialVerdict);
  }

  async function allowVideo(videoId, title, initialVerdict, failOpen = false, status) {
    removeOverlay();
    playVideo();
    if (failOpen) {
      showToast(
        `⚠️ 판정 건너뜀 (${failOpenLabel(status)}: ${initialVerdict.reason || "알 수 없는 이유"}) — 그냥 통과됨`
      );
    }
    const entryContext = await root.JJG_DWELL_TRACKER.getEntryContext(videoId, title);
    await appendLog({
      ...(entryContext || {}),
      videoId,
      title,
      initialVerdict,
      related: true,
      action: failOpen ? LOG_ACTIONS.SKIPPED : LOG_ACTIONS.WATCHED,
      reason: failOpen ? initialVerdict.reason : undefined,
      ts: Date.now(),
    });
  }

  async function blockOrAskVideo(videoId, title, purpose, initialVerdict) {
    // 사용자가 아무 버튼도 누르지 않고 다른 영상으로 넘어가도 기록에 남도록,
    // 차단/이유확인 시점에 먼저 기록하고 이후 선택에 따라 같은 항목을 갱신한다.
    const entryContext = await root.JJG_DWELL_TRACKER.getEntryContext(videoId, title);
    const blockedIndex = await appendLog({
      ...(entryContext || {}),
      videoId,
      title,
      initialVerdict,
      related: false,
      action: LOG_ACTIONS.BLOCKED,
      reason: initialVerdict.reason,
      userReason: "",
      reasonVerdict: null,
      ts: Date.now(),
    });
    const updateBlockedLog = (updates) => entryContext?.entryId
      ? updateLogEntryById(entryContext.entryId, updates)
      : updateLogEntry(blockedIndex, updates);

    // 판정을 기다리는 동안 다른 영상으로 넘어갔다면 그 영상을 재생시키면 안 된다.
    const stillOnVideo = () => getCurrentVideoId() === videoId;

    root.JJG_REASON_FLOW.showWarning(purpose, initialVerdict, {
      onApproved: async (userReason, explanation) => {
        if (!stillOnVideo()) return;
        removeOverlay();
        playVideo();
        await updateBlockedLog({
          action: LOG_ACTIONS.APPROVED_REASON,
          userReason,
          reasonVerdict: { accepted: true, explanation: explanation || "" },
        });
      },
      onRejected: async (userReason, explanation) => {
        // action은 blocked로 두고, 사용자가 낸 이유와 AI의 판단 근거만 남긴다.
        await updateBlockedLog({
          userReason,
          reasonVerdict: { accepted: false, explanation: explanation || "" },
        });
      },
      // failStatus: reason-flow.js가 verdict.status("error"/"timeout")를 그대로 넘겨준다.
      // API 오류는 절대 accepted:false(=이유 거절)로 기록하지 않는다.
      onSkipped: async (userReason, failReason, failStatus) => {
        if (!stillOnVideo()) return;
        removeOverlay();
        playVideo();
        showToast(`⚠️ 이유 판정 건너뜀 (${failOpenLabel(failStatus)}: ${failReason || "알 수 없는 이유"}) — 그냥 통과됨`);
        await updateBlockedLog({
          action: LOG_ACTIONS.SKIPPED,
          userReason,
          reason: failReason,
          reasonVerdict: { accepted: false, explanation: failReason || "" },
        });
      },
      onGoBack: async () => {
        await updateBlockedLog({ action: LOG_ACTIONS.WENT_BACK });
        if (history.length > 1) {
          history.back();
        } else {
          location.href = "https://www.youtube.com/";
        }
      },
    });
  }

  root.JJG_JUDGE_FLOW = Object.freeze({ handleWatchPage });
})(typeof globalThis !== "undefined" ? globalThis : this);
