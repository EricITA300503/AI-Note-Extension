document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const sendBtn = document.getElementById("sendBtn");
  const promptSelect = document.getElementById("promptSelect");

  let currentPrompts = {};
  chrome.storage.sync.get(['prompts'], (result) => {
    if (result.prompts) currentPrompts = result.prompts;
  });

  function updateUI() {
    chrome.storage.local.get(["activeSession", "processingState"], (result) => {
      if (result.processingState) {
        if (result.processingState.includes("[DONE]") || result.processingState.includes("[ERROR]")) {
          sendBtn.textContent = "Start Recording Chat";
          sendBtn.disabled = false;
          statusEl.textContent = result.processingState;
        } else {
          sendBtn.textContent = "Force Reset (If Stuck)";
          sendBtn.disabled = false;
          statusEl.textContent = result.processingState;
        }
      } else if (result.activeSession) {
        sendBtn.textContent = "Stop & Download Note";
        sendBtn.disabled = false;
        statusEl.textContent = "Recording active...";
      } else {
        sendBtn.textContent = "Start Recording Chat";
        sendBtn.disabled = false;
        statusEl.textContent = "System Idle.";
      }
    });
  }

  updateUI();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.processingState || changes.activeSession)) {
      updateUI();
    }
  });

  sendBtn.addEventListener("click", async () => {
    chrome.storage.local.get(["activeSession", "processingState"], async (result) => {
      
      if (result.processingState && !result.processingState.includes("[DONE]") && !result.processingState.includes("[ERROR]")) {
        chrome.storage.local.remove(["processingState", "activeSession"], () => { updateUI(); });
        return; 
      }

      if (!result.activeSession) {
        const selectedKey = promptSelect.value;
        const chosenPrompt = currentPrompts[selectedKey] || "Summarize this text.";
        statusEl.textContent = "Initializing Vault...";

        try {
          const res = await fetch('http://127.0.0.1:8000/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_prompt: chosenPrompt })
          });
          const data = await res.json();

          const sessionData = { chatId: data.chat_id, prompt: chosenPrompt };
          chrome.storage.local.set({ activeSession: sessionData }, () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) {
                const currentUrl = tabs[0].url || "";
                if (currentUrl.startsWith("chrome://") || currentUrl.startsWith("about:") || currentUrl.includes("chrome.google.com")) {
                  chrome.storage.local.remove("activeSession", () => {
                    chrome.storage.local.set({ processingState: "[ERROR] Chrome blocks extensions here. Go to Gemini!" });
                  });
                  return;
                }
                chrome.tabs.sendMessage(tabs[0].id, { action: "START_OBSERVER", session: sessionData })
                  .then(() => {
                    sendBtn.textContent = "Stop & Download Note";
                    statusEl.textContent = "Recording active...";
                  })
                  .catch((err) => {
                    chrome.storage.local.remove("activeSession", () => {
                      chrome.storage.local.set({ processingState: "[ERROR] Please REFRESH the Gemini page (F5) first!" });
                    });
                  });
              }
            });
          });
        } catch (e) {
          chrome.storage.local.set({ processingState: "[ERROR] Bridge connection failed. Is Python running?" });
        }

      } else {
        const chatId = result.activeSession.chatId;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "STOP_OBSERVER" }).catch(() => {});
          }
        });
        chrome.storage.local.remove("activeSession", () => {
          chrome.runtime.sendMessage({ action: "FINALIZE_SESSION", payload: { chatId: chatId } });
        });
      }
    });
  });
});