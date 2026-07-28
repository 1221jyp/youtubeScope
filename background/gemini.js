// Gemini API 호출을 한 곳에 모은다. 영상 판정 · 이유 재판정 · 세션 리포트가 공유한다.
// 여기에는 "어떻게 호출하는가"만 두고, "무엇을 물어보는가"(프롬프트)는 각 기능 모듈이 갖는다.
(function (root) {
  "use strict";

  const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULT_MODEL = "gemini-flash-latest";

  const { STORAGE_KEYS } = root.JJG_SCHEMA;
  const { textOrEmpty } = root.JJG_TEXT;

  // AI가 판정하지 못했을 때 사용자를 막지 않기 위한 공통 응답.
  function failOpen(reason) {
    return { related: true, reason, failOpen: true };
  }

  async function getConfig() {
    const data = await root.JJG_STORAGE.get([
      STORAGE_KEYS.GEMINI_API_KEY,
      STORAGE_KEYS.GEMINI_MODEL,
    ]);
    return {
      apiKey: data[STORAGE_KEYS.GEMINI_API_KEY] || "",
      model: textOrEmpty(data[STORAGE_KEYS.GEMINI_MODEL]) || DEFAULT_MODEL,
    };
  }

  function errorMessage(status, body) {
    if (status === 400 && /api key/i.test(body || "")) return "Gemini API 키가 유효하지 않음";
    if (status === 403) return "Gemini API 키 권한 없음";
    if (status === 404) return "Gemini 모델을 찾을 수 없음";
    if (status === 429) return "Gemini 요청 한도 초과";
    return `Gemini API 오류(${status})`;
  }

  // 함수 호출 응답을 우선 읽고, 모델이 평문으로 답한 경우 JSON 블록을 구제한다.
  function extractFunctionArgs(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const fnPart = parts.find((part) => part && part.functionCall);
    let args = fnPart ? fnPart.functionCall.args : null;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = null;
      }
    }
    if (!args) {
      const textPart = parts.find((part) => typeof part?.text === "string");
      if (textPart) {
        try {
          const match = textPart.text.match(/\{[\s\S]*\}/);
          if (match) args = JSON.parse(match[0]);
        } catch {
          args = null;
        }
      }
    }
    return args;
  }

  // 지정한 도구를 반드시 한 번 호출하게 하고, 그 인자만 돌려준다.
  // 실패는 전부 Error로 던지므로 호출부에서 fail-open 여부를 결정한다.
  async function callFunction(options) {
    const {
      apiKey,
      model,
      systemInstruction = null,
      contents,
      tool,
      temperature = 0,
      timeoutMs = 60000,
      timeoutMessage = "응답 시간 초과",
    } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(
        `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(systemInstruction ? { systemInstruction } : {}),
            contents,
            tools: [{ functionDeclarations: [tool] }],
            toolConfig: {
              functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] },
            },
            generationConfig: { temperature },
          }),
          signal: controller.signal,
        }
      );
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error(timeoutMessage);
      console.warn("[조준경] Gemini fetch 실패:", err && err.name, err && err.message);
      throw new Error("Gemini API에 연결할 수 없음");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[조준경] Gemini API 오류", res.status, errBody);
      throw new Error(errorMessage(res.status, errBody));
    }

    const data = await res.json();
    const args = extractFunctionArgs(data);
    if (!args) console.warn("[조준경] 함수 호출 응답 없음", JSON.stringify(data));
    return args;
  }

  const api = Object.freeze({
    API_BASE,
    DEFAULT_MODEL,
    failOpen,
    getConfig,
    errorMessage,
    extractFunctionArgs,
    callFunction,
  });

  root.JJG_GEMINI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
