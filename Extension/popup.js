document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const sendBtn = document.getElementById("sendBtn");
  const promptSelect = document.getElementById("promptSelect");

  let currentPrompts = {};
  chrome.storage.sync.get(['prompts'], (result) => {
    if (result.prompts) currentPrompts = result.prompts;
  });

  // Check if we are already recording
  chrome.storage.local.get(["activeSession"], (result) => {
    if (result.activeSession) {
      sendBtn.textContent = "Stop & Download Note";
      statusEl.textContent = "🔴 Recording active...";
    } else {
      sendBtn.textContent = "Start Recording Chat";
      statusEl.textContent = "System Idle.";
    }
  });

  sendBtn.addEventListener("click", async () => {
    chrome.storage.local.get(["activeSession"], async (result) => {
      
      // START RECORDING
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
              if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "START_OBSERVER", session: sessionData });
            });
            sendBtn.textContent = "Stop & Download Note";
            statusEl.textContent = "🔴 Recording session started...";
          });
        } catch (e) {
          statusEl.textContent = "Bridge connection failed.";
        }

      // STOP RECORDING
      } else {
        const chatId = result.activeSession.chatId;
        
        // 1. Instantly trigger the final data grab and shut down the observer
        chrome.storage.local.remove("activeSession", () => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "STOP_OBSERVER" });
          });
        });

        // 2. Lock the UI and start polling the backend status
        sendBtn.disabled = true;
        statusEl.textContent = "Checking background queue...";
        
        const checkStatusInterval = setInterval(async () => {
          try {
            const statusRes = await fetch('http://127.0.0.1:8000/status');
            const statusData = await statusRes.json();
            
            const totalTasks = statusData.queue_size + (statusData.is_processing ? 1 : 0);
            
            if (totalTasks > 0) {
              // Update the UI to show the user exactly what is happening
              statusEl.textContent = `AI is finishing up... (${totalTasks} chunk(s) remaining)`;
              sendBtn.textContent = "Processing...";
            } else {
              // Queue is empty and worker is idle! Safe to download.
              clearInterval(checkStatusInterval);
              statusEl.textContent = "Finalizing Note...";
              
              const res = await fetch(`http://127.0.0.1:8000/download/${chatId}`);
              const data = await res.json();

              const blob = new Blob([data.markdown], { type: 'text/markdown' });
              const downloadUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = data.filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(downloadUrl);

              statusEl.textContent = "Done! Successfully written to Vault.";
              sendBtn.textContent = "Start Recording Chat";
              sendBtn.disabled = false;
            }
          } catch (err) {
            clearInterval(checkStatusInterval);
            statusEl.textContent = "Connection to backend lost.";
            sendBtn.textContent = "Start Recording Chat";
            sendBtn.disabled = false;
          }
        }, 2000); // Poll every 2 seconds
      }
    });
  });
});