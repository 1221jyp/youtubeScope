// Gemini API 호출을 한 곳에 모은다. 영상 판정 · 이유 재판정 · 세션 리포트가 공유한다.
// 여기에는 "어떻게 호출하는가"만 두고, "무엇을 물어보는가"(프롬프트)는 각 기능 모듈이 갖는다.
//
// [에러 처리 원칙]
// 실패는 전부 code가 붙은 GeminiError로 던진다. 호출부(judge.js/reason.js/goal.js/...)는
// 이 code를 보고 최종 응답의 status(error/timeout)를 결정한다.
// "AI가 정상적으로 관련없다고 판단한 것"과 "API 자체가 실패한 것"은 절대 같은 값으로 섞이면 안 된다.
// - 정상 판단(거절 포함): decision/accepted 필드에 담긴다 (verdict.js 책임)
// - API 오류: 여기서 code가 붙은 Error로 던져지고, 호출부는 반드시 failOpen()으로만 흡수한다.
(function (root) {
  "use strict";

  const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULT_MODEL = "gemini-flash-latest";

  const { STORAGE_KEYS, AI_ERROR_CODES, AI_REQUEST_STATUS } = root.JJG_SCHEMA;
  const { textOrEmpty } = root.JJG_TEXT;

  // code가 항상 붙어있는 에러. 호출부는 err.code로 원인을 구분한다.
  class GeminiError extends Error {
    constructor(message, code = AI_ERROR_CODES.UNKNOWN) {
      super(message);
      this.name = "GeminiError";
      this.code = code;
    }
  }

  // AI가 판정하지 못했을 때(=API 오류)를 위한 공통 응답.
  // "정상 거절"과 절대 헷갈리면 안 되므로 failOpen: true, errorCode, status를 항상 함께 담는다.
  function failOpen(reason, code = AI_ERROR_CODES.UNKNOWN) {
    const decision = root.JJG_SCHEMA.VIDEO_DECISIONS ? root.JJG_SCHEMA.VIDEO_DECISIONS.ALLOW : "allow";
    return {
      decision,
      score: 100,
      related: true,
      reason,
      failOpen: true,
      errorCode: code,
      status: code === AI_ERROR_CODES.TIMEOUT ? AI_REQUEST_STATUS.TIMEOUT : AI_REQUEST_STATUS.ERROR,
    };
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

  // HTTP 상태 → (사람이 읽을 메시지, 에러 코드). 401/403/400(api key)은 인증 문제,
  // 429는 한도초과, 404는 모델 문제, 5xx는 네트워크/서버 문제로 분류한다.
  function classifyHttpError(status, body) {
    if (status === 400 && /api key/i.test(body || "")) {
      return { message: "Gemini API 키가 유효하지 않음", code: AI_ERROR_CODES.AUTH_ERROR };
    }
    if (status === 401 || status === 403) {
      return { message: "Gemini API 키 권한 없음", code: AI_ERROR_CODES.AUTH_ERROR };
    }
    if (status === 404) {
      return { message: "Gemini 모델을 찾을 수 없음", code: AI_ERROR_CODES.NOT_FOUND };
    }
    if (status === 429) {
      return { message: "Gemini 요청 한도 초과", code: AI_ERROR_CODES.RATE_LIMIT };
    }
    if (status >= 500) {
      return { message: `Gemini 서버 오류(${status})`, code: AI_ERROR_CODES.NETWORK_ERROR };
    }
    return { message: `Gemini API 오류(${status})`, code: AI_ERROR_CODES.UNKNOWN };
  }

  // 과거 코드 호환용: 문자열 메시지만 필요한 곳에서 그대로 쓸 수 있다.
  function errorMessage(status, body) {
    return classifyHttpError(status, body).message;
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
  // 실패는 전부 GeminiError(code 포함)로 던지므로 호출부에서 fail-open 여부와 상태(error/timeout)를 결정한다.
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
      if (err && err.name === "AbortError") {
        throw new GeminiError(timeoutMessage, AI_ERROR_CODES.TIMEOUT);
      }
      console.warn("[조준경] Gemini fetch 실패:", err && err.name, err && err.message);
      throw new GeminiError("Gemini API에 연결할 수 없음", AI_ERROR_CODES.NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[조준경] Gemini API 오류", res.status, errBody);
      const { message, code } = classifyHttpError(res.status, errBody);
      throw new GeminiError(message, code);
    }

    const data = await res.json();
    const args = extractFunctionArgs(data);
    if (!args) {
      console.warn("[조준경] 함수 호출 응답 없음", JSON.stringify(data));
      throw new GeminiError("AI 응답 형식을 해석할 수 없음", AI_ERROR_CODES.PARSE_ERROR);
    }
    return args;
  }

  const api = Object.freeze({
    API_BASE,
    DEFAULT_MODEL,
    GeminiError,
    failOpen,
    getConfig,
    errorMessage,
    classifyHttpError,
    extractFunctionArgs,
    callFunction,
  });

  root.JJG_GEMINI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);