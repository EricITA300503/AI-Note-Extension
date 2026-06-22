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
      
      // --- START RECORDING ---
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
                
                // FOOLPROOF CHECK: Is Chrome blocking this page?
                const currentUrl = tabs[0].url || "";
                if (currentUrl.startsWith("chrome://") || currentUrl.startsWith("about:") || currentUrl.includes("chrome.google.com")) {
                  statusEl.textContent = "⚠️ Chrome blocks extensions here. Go to Gemini!";
                  chrome.storage.local.remove("activeSession"); 
                  return; // Stop execution entirely
                }

                // If it's a valid page, try to connect
                chrome.tabs.sendMessage(tabs[0].id, { action: "START_OBSERVER", session: sessionData })
                  .then(() => {
                    sendBtn.textContent = "Stop & Download Note";
                    statusEl.textContent = "🔴 Recording session started...";
                  })
                  .catch((err) => {
                    // 🔥 THE FIX: Using console.log instead of console.error 
                    // This stops Chrome from showing a fake "Crash" warning in the Extension dashboard!
                    console.log("Content script missing or tab not refreshed:", err.message);
                    
                    // Tell the user exactly what to do
                    statusEl.textContent = "⚠️ Please REFRESH this page (F5) first!";
                    chrome.storage.local.remove("activeSession"); 
                  });
              }
            });
          });
        } catch (e) {
          statusEl.textContent = "Bridge connection failed. Is Python running?";
        }

      // --- STOP RECORDING ---
      } else {
        const chatId = result.activeSession.chatId;
        
        // 1. Instantly trigger the final data grab and shut down the observer
        chrome.storage.local.remove("activeSession", () => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              // Standard callback pattern prevents unhandled promise rejections
              chrome.tabs.sendMessage(tabs[0].id, { action: "STOP_OBSERVER" }, () => {
                // Check if the receiving end didn't exist
                if (chrome.runtime.lastError) {
                  // Using console.log here as well to prevent dashboard errors
                  console.log("Observer stopped or tab already closed.");
                } else {
                  console.log("✅ Observer stopped successfully.");
                }
              });
            }
          });
        });

        // 2. Lock the UI and wait for the final network transmission
        sendBtn.disabled = true;
        statusEl.textContent = "Catching final messages..."; 
        
        // Wait 2.5 seconds BEFORE we start polling the Python server.
        setTimeout(() => {
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
                clearInterval(checkStatusInterval);
                
                // Check if the user wants the Heavy AI pass before downloading
                chrome.storage.sync.get(['useDeepSynthesis'], async (syncResult) => {
                  if (syncResult.useDeepSynthesis) {
                    // 🔥 FIX: Warn the user that closing the popup kills the script!
                    statusEl.textContent = "⏳ Deep Synthesis running... (DO NOT CLOSE POPUP)";
                    try {
                      await fetch(`http://127.0.0.1:8000/synthesize/${chatId}`, { method: 'POST' });
                    } catch (e) {
                      console.log("Synthesis failed, falling back to Python merge.");
                    }
                  }

                  statusEl.textContent = "Finalizing Note...";
                  
                  // Proceed with the standard Python download merge
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
                });
              }
            } catch (err) {
              clearInterval(checkStatusInterval);
              statusEl.textContent = "Connection to backend lost.";
              sendBtn.textContent = "Start Recording Chat";
              sendBtn.disabled = false;
            }
          }, 2000); // Poll every 2 seconds
        }, 2500); // End of the new 2.5-second delay wrapper
      
      }
    });
  });
});