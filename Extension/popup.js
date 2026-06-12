let currentPrompts = {};

// Load saved prompts
chrome.storage.sync.get(['prompts'], (result) => {
  if (result.prompts) {
    currentPrompts = result.prompts;
  }
});

// The updated Smart Scraper
function scrapePageText() {
  // Priority 1: If the user highlighted specific text, only grab that.
  const selection = window.getSelection().toString();
  if (selection.length > 0) return selection;

  let chatText = "";

  // Priority 2: Google Gemini
  // Gemini uses custom HTML tags: <user-query> and <model-response>
  const geminiNodes = document.querySelectorAll('user-query, model-response');
  if (geminiNodes.length > 0) {
    geminiNodes.forEach(node => {
      const role = node.tagName.toLowerCase() === 'user-query' ? 'User' : 'Gemini';
      chatText += `--- ${role} ---\n${node.innerText}\n\n`;
    });
    return chatText;
  }

  // Priority 3: ChatGPT
  // ChatGPT uses data attributes for roles: data-message-author-role="user" | "assistant"
  const gptNodes = document.querySelectorAll('[data-message-author-role]');
  if (gptNodes.length > 0) {
    gptNodes.forEach(node => {
      const role = node.getAttribute('data-message-author-role').toUpperCase();
      chatText += `--- ${role} ---\n${node.innerText}\n\n`;
    });
    return chatText;
  }

  // Priority 4: Claude
  // Claude relies heavily on specific font classes for messages
  const claudeNodes = document.querySelectorAll('.font-user-message, .font-claude-message');
  if (claudeNodes.length > 0) {
    claudeNodes.forEach(node => {
      chatText += `${node.innerText}\n\n`;
    });
    return chatText;
  }

  // Priority 5: Generic AI/Blog site fallback
  // Grab the <main> tag to ignore sidebars, navbars, and footers
  const mainTag = document.querySelector('main');
  if (mainTag) return mainTag.innerText;

  // Final Fallback: The whole body (with safety truncation)
  return document.body.innerText;
}

document.getElementById('sendBtn').addEventListener('click', async () => {
  const selectedKey = document.getElementById('promptSelect').value;
  const statusEl = document.getElementById('status');
  
  statusEl.textContent = "Extracting chat data...";

  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapePageText,
  }, async (injectionResults) => {
    
    let chatText = injectionResults[0].result;
    
    if (!chatText || chatText.trim() === '') {
      statusEl.textContent = "Error: No chat found on this page.";
      return;
    }

    // --- Safety Valve ---
    // Cap extraction at 16,000 characters to prevent Ollama from crashing
    const CHARACTER_LIMIT = 16000; 
    if (chatText.length > CHARACTER_LIMIT) {
      console.warn(`Text truncated from ${chatText.length} to ${CHARACTER_LIMIT} characters.`);
      chatText = chatText.substring(0, CHARACTER_LIMIT) + "\n...[Text truncated by extension safety limit]...";
    }

    statusEl.textContent = "AI is thinking... (Do not click away)";

    const payload = {
      chat_text: chatText,
      selected_system_prompt: currentPrompts[selectedKey]
    };

    try {
      const response = await fetch('http://127.0.0.1:8000/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        statusEl.textContent = "Done! Downloading note...";
        
        const blob = new Blob([data.markdown], { type: 'text/markdown' });
        const downloadUrl = URL.createObjectURL(blob);
        
        const filename = data.file_saved ? data.file_saved.split('\\').pop().split('/').pop() : 'AI_Chat_Summary.md';

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        
        statusEl.textContent = "Summary Saved!";
      } else {
        statusEl.textContent = "Bridge Error. Check VS Code.";
      }
    } catch (err) {
      statusEl.textContent = "Connection Failed. Is Bridge running?";
    }
  });
});