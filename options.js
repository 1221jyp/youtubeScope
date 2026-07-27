document.addEventListener("DOMContentLoaded", async () => {
  const data = await new Promise((resolve) =>
    chrome.storage.local.get(
      ["jjg_gemini_api_key", "jjg_ollama_url", "jjg_ollama_model"],
      resolve
    )
  );

  document.getElementById("jjg-gemini-key").value = data.jjg_gemini_api_key || "";
  document.getElementById("jjg-ollama-url").value = data.jjg_ollama_url || "http://localhost:11434";
  document.getElementById("jjg-ollama-model").value = data.jjg_ollama_model || "";

  document.getElementById("jjg-save-btn").addEventListener("click", async () => {
    const geminiKey = document.getElementById("jjg-gemini-key").value.trim();
    const ollamaUrl = document.getElementById("jjg-ollama-url").value.trim();
    const ollamaModel = document.getElementById("jjg-ollama-model").value.trim();

    await new Promise((resolve) =>
      chrome.storage.local.set(
        {
          jjg_gemini_api_key: geminiKey,
          jjg_ollama_url: ollamaUrl,
          jjg_ollama_model: ollamaModel,
        },
        resolve
      )
    );

    const msg = document.getElementById("jjg-saved-msg");
    msg.style.display = "block";
    setTimeout(() => {
      msg.style.display = "none";
    }, 2000);
  });
});
