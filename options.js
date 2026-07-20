const OLLAMA_URL_KEY = "jjg_ollama_url";
const OLLAMA_MODEL_KEY = "jjg_ollama_model";
const DEFAULT_URL = "http://localhost:11434";

document.addEventListener("DOMContentLoaded", async () => {
  const urlInput = document.getElementById("jjg-ollama-url");
  const modelInput = document.getElementById("jjg-ollama-model");

  const data = await new Promise((resolve) =>
    chrome.storage.local.get([OLLAMA_URL_KEY, OLLAMA_MODEL_KEY], resolve)
  );
  urlInput.value = data[OLLAMA_URL_KEY] || DEFAULT_URL;
  modelInput.value = data[OLLAMA_MODEL_KEY] || "";

  document.getElementById("jjg-save-btn").addEventListener("click", async () => {
    const url = urlInput.value.trim() || DEFAULT_URL;
    const model = modelInput.value.trim();
    await new Promise((resolve) =>
      chrome.storage.local.set({ [OLLAMA_URL_KEY]: url, [OLLAMA_MODEL_KEY]: model }, resolve)
    );
    const msg = document.getElementById("jjg-saved-msg");
    msg.style.display = "inline";
    setTimeout(() => (msg.style.display = "none"), 1500);
  });
});
