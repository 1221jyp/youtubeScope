const GEMINI_API_KEY_KEY = "jjg_gemini_api_key";
const GEMINI_MODEL_KEY = "jjg_gemini_model";
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

document.addEventListener("DOMContentLoaded", async () => {
  const geminiKeyInput = document.getElementById("jjg-gemini-key");
  const geminiModelInput = document.getElementById("jjg-gemini-model");

  const data = await new Promise((resolve) =>
    chrome.storage.local.get([GEMINI_API_KEY_KEY, GEMINI_MODEL_KEY], resolve)
  );
  geminiKeyInput.value = data[GEMINI_API_KEY_KEY] || "";
  geminiModelInput.value = data[GEMINI_MODEL_KEY] || DEFAULT_GEMINI_MODEL;

  document.getElementById("jjg-save-btn").addEventListener("click", async () => {
    const geminiKey = geminiKeyInput.value.trim();
    const geminiModel = geminiModelInput.value.trim() || DEFAULT_GEMINI_MODEL;
    await new Promise((resolve) =>
      chrome.storage.local.set(
        { [GEMINI_API_KEY_KEY]: geminiKey, [GEMINI_MODEL_KEY]: geminiModel },
        resolve
      )
    );
    const msg = document.getElementById("jjg-saved-msg");
    msg.style.display = "inline";
    setTimeout(() => (msg.style.display = "none"), 1500);
  });
});
