// 조준경 background service worker
// 역할: 로컬 Ollama API 호출(judge), 판정 캐싱. 상태는 절대 변수에 들고 있지 않고 매번
// chrome.storage.local에서 읽고 쓴다 (service worker는 언제든 잠들 수 있음).

const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const API_TIMEOUT_MS = 20000; // 로컬 추론은 느릴 수 있어 넉넉히 잡음

const STORAGE_KEYS = {
  OLLAMA_URL: "jjg_ollama_url",
  OLLAMA_MODEL: "jjg_ollama_model",
  VERDICT_CACHE: "jjg_verdict_cache",
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function failOpen(reason) {
  return { related: true, reason, failOpen: true };
}

async function getOllamaConfig() {
  const data = await storageGet([STORAGE_KEYS.OLLAMA_URL, STORAGE_KEYS.OLLAMA_MODEL]);
  return {
    url: (data[STORAGE_KEYS.OLLAMA_URL] || OLLAMA_DEFAULT_URL).replace(/\/$/, ""),
    model: data[STORAGE_KEYS.OLLAMA_MODEL] || "",
  };
}

async function getCache() {
  const data = await storageGet([STORAGE_KEYS.VERDICT_CACHE]);
  return data[STORAGE_KEYS.VERDICT_CACHE] || {};
}

async function setCache(cache) {
  await storageSet({ [STORAGE_KEYS.VERDICT_CACHE]: cache });
}

function cacheKeyFor(purpose, videoId) {
  return `${purpose}||${videoId}`;
}

async function callOllama(url, model, purpose, title, description) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "30m", // 판정할 때마다 모델을 다시 로드하지 않도록 세션 내내 메모리에 유지
        messages: [
          {
            role: "user",
            content:
              `너는 유튜브 영상 제목/설명만 보고 사용자의 목적과 관련 있는지 냉정하게 판정하는 필터야.\n\n` +
              `판정 예시:\n` +
              `- 목적: "자료구조 해시테이블 공부" / 제목: "해시테이블 개념과 구현 - 자료구조 강의 8강" → related: true\n` +
              `- 목적: "자료구조 해시테이블 공부" / 제목: "50만원 미만 사무용 의자 추천 Best4" → related: false\n` +
              `- 목적: "자료구조 해시테이블 공부" / 제목: "Pretty Girl - RESCENE(린센드) MV" → related: false\n` +
              `- 목적: "자료구조 해시테이블 공부" / 제목: "아이돌 안무가 마이클 유 MASTER CLASS" → related: false\n` +
              `- 목적: "SQL 공부" / 제목: "SQL 조인(JOIN) 종류 완벽 정리" → related: true\n` +
              `- 목적: "SQL 공부" / 제목: "오늘 브이로그: 카페 투어" → related: false\n\n` +
              `이제 실제로 판정할 대상:\n` +
              `사용자의 현재 목적: "${purpose}"\n` +
              `영상 제목: ${title || "(제목 없음)"}\n` +
              `영상 설명: ${(description || "").slice(0, 500)}\n\n` +
              `규칙:\n` +
              `1. 제목/설명에 목적과 직접 연결되는 구체적인 내용이 없으면 억지로 연관성을 찾지 말고 false.\n` +
              `2. 오락, 쇼핑, 음악, 브이로그, 잡담, 밈, 챌린지 콘텐츠는 목적과 명시적으로 겹치지 않는 한 무조건 false.\n` +
              `3. "왠지 도움될 것 같다" 같은 느슨한 연결은 false로 처리. 확실한 경우만 true.\n` +
              `4. 제목이 "(제목 없음)"이면 판단 불가이니 true.\n` +
              `5. 반드시 verdict 도구를 호출해서 답해. 도구 호출 없이 일반 텍스트로 답하지 마.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "verdict",
              description: "영상이 사용자의 목적과 관련 있는지 판정한다.",
              parameters: {
                type: "object",
                properties: {
                  related: { type: "boolean" },
                  reason: { type: "string", description: "10자 이내 이유" },
                },
                required: ["related", "reason"],
              },
            },
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("응답 시간 초과");
    }
    console.warn("[조준경] Ollama fetch 실패:", err && err.name, err && err.message, "| url:", url);
    throw new Error("Ollama 서버에 연결할 수 없음");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[조준경] Ollama API 오류", res.status, errBody);
    if (res.status === 404) {
      throw new Error("모델을 찾을 수 없음(pull 필요)");
    }
    throw new Error(`Ollama API 오류(${res.status})`);
  }

  const data = await res.json();

  // 정상 경로: 모델이 tool_calls로 응답
  let args = data.message?.tool_calls?.[0]?.function?.arguments;

  // 일부 모델은 arguments를 문자열로 줄 수 있어 방어적으로 파싱 (2차 방어)
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = null;
    }
  }

  // 도구 호출 없이 본문 텍스트로만 답했을 경우의 폴백 파싱
  if (!args && data.message?.content) {
    try {
      const match = data.message.content.match(/\{[\s\S]*\}/);
      if (match) args = JSON.parse(match[0]);
    } catch {
      args = null;
    }
  }

  if (!args || typeof args.related !== "boolean") {
    console.warn("[조준경] 판정 응답 형식 이상", JSON.stringify(data));
    throw new Error("AI 응답 형식 이상");
  }

  return {
    related: args.related,
    reason: typeof args.reason === "string" ? args.reason : "",
  };
}

async function handleJudgeVideo(message) {
  const { purpose, videoId, title, description } = message;
  const key = cacheKeyFor(purpose, videoId);

  try {
    const cache = await getCache();
    if (cache[key]) return cache[key];

    const { url, model } = await getOllamaConfig();
    if (!model) return failOpen("Ollama 모델이 설정되지 않음");

    let verdict;
    try {
      verdict = await callOllama(url, model, purpose, title, description);
    } catch (err) {
      const reason = (err && err.message) || "판정 실패";
      console.warn("[조준경] fail-open:", reason, "| title:", title);
      return failOpen(reason);
    }

    const updatedCache = await getCache();
    updatedCache[key] = verdict;
    await setCache(updatedCache);
    return verdict;
  } catch (err) {
    return failOpen("알 수 없는 오류");
  }
}


async function handleJudgeReason(message){
 const {purpose,title,description,userReason}=message;
 const {url,model}=await getOllamaConfig();
 if(!model) return failOpen("Ollama 모델이 설정되지 않음");
 return callOllama(url,model,purpose+"\n사용자 이유: "+userReason+"\n이유를 고려해 최종 판정.",title,description);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "JUDGE_REASON") {
    handleJudgeReason(message).then(sendResponse);
    return true;
  }
  if (message && message.type === "JUDGE_VIDEO") {
    handleJudgeVideo(message).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  return false;
});
