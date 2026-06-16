chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.get(['prompts'], (result) => {
      if (!result.prompts) {
        chrome.storage.sync.set({ prompts: {
          prompt1: "Summarize this text into 3 bullet points.",
          prompt2: "Extract all action items and tasks from this text.",
          prompt3: "Rewrite this text to be more professional and concise."
        }});
      }
    });
  }
});

// --- NEW: Relay Listener ---
// This listens for text chunks from the webpage and safely passes them to Python
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FORWARD_TO_SERVER") {
    fetch('http://127.0.0.1:8000/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
    .then(response => response.json())
    .catch(error => console.error("Background Relay Failed:", error));
    
    sendResponse({ success: true });
    return true; 
  }
});