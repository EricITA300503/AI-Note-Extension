chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({ prompts: {
      prompt1: "Extract the core topics, key insights, resources, and action items from this text.",
      prompt2: "Extract all action items and tasks from this text.",
      prompt3: "Rewrite this text to be more professional and concise."
    }});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FORWARD_TO_SERVER") {
    fetch('http://127.0.0.1:8000/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
    .catch(error => console.error("Background Relay Failed:", error));
    
    sendResponse({ success: true });
    return true; 
  }

  if (request.action === "FINALIZE_SESSION") {
    const { chatId } = request.payload;

    chrome.storage.local.set({ processingState: "Catching final messages..." });

    setTimeout(() => {
      chrome.storage.local.set({ processingState: "Checking background queue..." });

      let isSynthesizing = false;
      let synthesisDone = false;

      const checkStatusInterval = setInterval(async () => {
        // Keep-alive to prevent Service Worker sleep/shutdown during Ollama processing
        chrome.runtime.getPlatformInfo(() => {});

        try {
          const statusRes = await fetch('http://127.0.0.1:8000/status');
          const statusData = await statusRes.json();
          const totalTasks = statusData.queue_size + (statusData.is_processing ? 1 : 0);

          if (totalTasks > 0) {
            chrome.storage.local.set({ processingState: `AI is finishing up... (${totalTasks} chunk(s) remaining)` });
          } 
          else if (!isSynthesizing && !synthesisDone) {
            isSynthesizing = true; 
            chrome.storage.local.set({ processingState: "Running Deep AI Synthesis... (May take a while)" });
            
            // 🔥 Fetch the user's custom prompts dynamically from storage
            chrome.storage.sync.get(['prompts'], (syncResult) => {
              const masterRules = syncResult.prompts?.masterPrompt || "You are an expert technical editor.";
              
              // Inject the master rules into the HTTP payload
              fetch(`http://127.0.0.1:8000/synthesize/${chatId}`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ master_prompt: masterRules })
              })
              .then(() => { synthesisDone = true; })
              .catch((e) => {
                console.error("Synthesis failed, falling back to raw download:", e);
                synthesisDone = true;
              });
            });
          }
          else if (synthesisDone) {
            clearInterval(checkStatusInterval); 

            chrome.storage.local.set({ processingState: "Finalizing Note..." });
            const res = await fetch(`http://127.0.0.1:8000/download/${chatId}`);
            const data = await res.json();

            // Handle native browser download trigger
            const base64Str = btoa(unescape(encodeURIComponent(data.markdown)));
            chrome.downloads.download({
              url: 'data:text/markdown;base64,' + base64Str,
              filename: data.filename
            });

            chrome.storage.local.set({ processingState: "✅ Done! Successfully written to Vault." });
          }
        } catch (err) {
          console.error("Interval Error:", err);
          clearInterval(checkStatusInterval);
          chrome.storage.local.set({ processingState: "❌ Connection to backend lost." });
        }
      }, 2000);
    }, 2500);

    sendResponse({ success: true });
    return true;
  }
});