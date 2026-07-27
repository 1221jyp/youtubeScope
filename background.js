// 조준경 background service worker
// 역할: 1차 로컬 5차원 AI 엔진(0.3ms) + 2차 Gemini 2.0 Flash / Ollama LLM (자막 스크립트 정밀 분석)

importScripts("similarity-engine.js");

const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const API_TIMEOUT_MS = 20000;

const STORAGE_KEYS = {
  GEMINI_KEY: "jjg_gemini_api_key",
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

async function getAiConfig() {
  const data = await storageGet([STORAGE_KEYS.GEMINI_KEY, STORAGE_KEYS.OLLAMA_URL, STORAGE_KEYS.OLLAMA_MODEL]);
  return {
    geminiKey: data[STORAGE_KEYS.GEMINI_KEY] || "",
    ollamaUrl: (data[STORAGE_KEYS.OLLAMA_URL] || OLLAMA_DEFAULT_URL).replace(/\/$/, ""),
    ollamaModel: data[STORAGE_KEYS.OLLAMA_MODEL] || "",
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

// Gemini 2.0 Flash API 2차 정밀 검증 엔진 (자막/대사/설명 전체 심층 분석)
async function callGeminiApi(apiKey, purpose, title, description, keywords, channel, aiSummary, transcriptText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const promptText = `
너는 사용자의 학습 목표와 유튜브 영상의 실제 대사 자막/메타데이터를 대조해 딴짓 여부를 엄격하게 판정하는 전문가 AI 필터야.

[사용자의 현재 학습/공부 목표]: "${purpose}"

[영상의 실제 정보]:
- 제목: ${title || "(없음)"}
- 채널: ${channel || "(없음)"}
- 키워드/태그: ${keywords || "(없음)"}
- AI요약/목차: ${aiSummary || "(없음)"}
- 영상 설명: ${(description || "").slice(0, 500)}
- 영상 실제 대사/자막(Transcript): ${(transcriptText || "(자막 없음)").slice(0, 1500)}

[판정 지침]:
1. 영상의 대사(Transcript)나 설명/요약/제목에 나오는 개념(예: '삼체 문제', '카오스 이론', '라그랑주 점', '나비 효과' 등)이 사용자의 목표(예: '물리')의 하위 학문이나 관련 분야라면 적극적으로 related: true 판정을 내린다.
2. 제목에 'feat'이나 영화/넷플릭스 언급이 있더라도, 실제 영상 내용이 과학/물리/학술 해설이라면 오락으로 치부하지 말고 related: true로 승인한다.
3. 순수한 오락, 일상 브이로그, 아이돌 MV, 먹방, 단순 게임 하이라이트, 쇼핑 리뷰만 related: false로 차단한다.
4. 반드시 JSON 형식으로만 응답해: {"related": boolean, "reason": "15자 이내 한국어 사유"}
`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API Error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini API 빈 응답");

  const parsed = JSON.parse(text);
  return {
    related: !!parsed.related,
    reason: parsed.reason || (parsed.related ? "목표 부합 영상" : "목표와 무관한 영상"),
    method: "GEMINI_2.0_FLASH_LLM"
  };
}

async function callOllama(url, model, purpose, title, description, keywords, channel, aiSummary, transcriptText) {
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
        keep_alive: "30m",
        messages: [
          {
            role: "user",
            content:
              `사용자의 현재 목적: "${purpose}"\n` +
              `영상 제목: ${title || "(제목 없음)"}\n` +
              `채널 이름: ${channel || "(채널 없음)"}\n` +
              `영상 설명: ${(description || "").slice(0, 500)}\n` +
              `영상 자막 대사: ${(transcriptText || "").slice(0, 800)}\n\n` +
              `규칙:\n` +
              `1. 물리/과학/학술 주제(삼체문제, 카오스이론 등)는 사용자의 목적과 관련 있으면 related: true.\n` +
              `2. 순수 오락, 브이로그, 게임 영상만 false.\n` +
              `3. 반드시 verdict 도구를 호출해서 답해.`,
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
    if (err && err.name === "AbortError") throw new Error("응답 시간 초과");
    throw new Error("Ollama 서버 연결 실패");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Ollama API 오류(${res.status})`);

  const data = await res.json();
  let args = data.message?.tool_calls?.[0]?.function?.arguments;

  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = null; }
  }

  if (!args || typeof args.related !== "boolean") {
    throw new Error("AI 응답 형식 이상");
  }

  return {
    related: args.related,
    reason: typeof args.reason === "string" ? args.reason : "",
    method: "OLLAMA_LLM"
  };
}

async function handleJudgeVideo(message) {
  const { purpose, videoId, title, description, keywords, channel, aiSummary, transcriptText } = message;
  const key = cacheKeyFor(purpose, videoId);

  try {
    const cache = await getCache();
    if (cache[key]) return cache[key];

    // 1단계: 5차원 로컬 AI 초고속 분석 (< 1ms)
    const localVerdict = evaluateVideoIntent(purpose, title, description, keywords, channel, aiSummary);

    // 1차에서 높은 점수로 확실히 통과(Pass)한 영상만 바로 반환
    if (localVerdict.confidence === "HIGH" && localVerdict.related === true) {
      console.log(`[조준경 1차 통과] (${localVerdict.score}) -> related: true`);
      const verdict = {
        related: true,
        reason: localVerdict.reason,
        method: localVerdict.method,
        score: localVerdict.score,
      };
      const updatedCache = await getCache();
      updatedCache[key] = verdict;
      await setCache(updatedCache);
      return verdict;
    }

    // 2차 정밀 분석 수행 (Gemini 2.0 Flash 우선, Ollama 보조)
    const { geminiKey, ollamaUrl, ollamaModel } = await getAiConfig();

    let verdict = null;
    if (geminiKey) {
      try {
        console.log("[조준경 2차 Deep 분석] Gemini 2.0 Flash API로 자막/대사 정밀 분석 중...");
        verdict = await callGeminiApi(geminiKey, purpose, title, description, keywords, channel, aiSummary, transcriptText);
      } catch (err) {
        console.warn("[조준경] Gemini 2.0 Flash API 호출 실패, 로컬 결과로 백업:", err.message);
      }
    }

    if (!verdict && ollamaModel) {
      try {
        console.log("[조준경 2차 Deep 분석] Ollama로 자막/대사 정밀 분석 중...");
        verdict = await callOllama(ollamaUrl, ollamaModel, purpose, title, description, keywords, channel, aiSummary, transcriptText);
      } catch (err) {
        console.warn("[조준경] Ollama 호출 실패, 로컬 결과로 백업:", err.message);
      }
    }

    if (!verdict) {
      verdict = localVerdict;
    }

    const updatedCache = await getCache();
    updatedCache[key] = verdict;
    await setCache(updatedCache);
    return verdict;
  } catch (err) {
    return failOpen("알 수 없는 오류");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "JUDGE_VIDEO") {
    handleJudgeVideo(message).then(sendResponse);
    return true;
  }
  return false;
});
