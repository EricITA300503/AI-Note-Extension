let observer = null;
let seenMessages = new Set();
let currentChatId = null;
let currentPrompt = null;

function queryAllDeep(selector, root = document) {
    let results = [];
    try {
        results = Array.from(root.querySelectorAll(selector));
        const allNodes = Array.from(root.querySelectorAll('*'));
        
        const elementsWithShadow = allNodes.filter(el => {
            try { return el.shadowRoot; } catch(e) { return false; }
        });
        
        for (const el of elementsWithShadow) {
            results = results.concat(queryAllDeep(selector, el.shadowRoot));
        }
    } catch(e) {
        // Silently catch cross-origin iframe security blocks
    }
    return results;
}

function extractNewMessages() {
  let newChatText = "";
  const nodes = queryAllDeep('user-query, model-response, [data-message-author-role], .font-user-message, .font-claude-message');

  nodes.forEach(node => {
    let text = "";
    try {
        if (node.shadowRoot) text = node.shadowRoot.textContent.trim();
        else text = node.innerText ? node.innerText.trim() : node.textContent.trim();
    } catch(e) {}

    if (text && !seenMessages.has(text)) {
      seenMessages.add(text);
      let role = 'System';
      const tagName = node.tagName.toLowerCase();
      
      if (tagName === 'user-query') role = 'User';
      else if (tagName === 'model-response') role = 'Gemini';
      else if (node.hasAttribute('data-message-author-role')) {
        role = node.getAttribute('data-message-author-role').toUpperCase();
      }
      newChatText += `--- ${role} ---\n${text}\n\n`;
    }
  });
  return newChatText;
}

function transmitUpdates() {
  const newText = extractNewMessages();
  if (newText.trim() === "" || !currentChatId) return; 

  chrome.runtime.sendMessage({ 
    action: "FORWARD_TO_SERVER", 
    payload: { chat_id: currentChatId, new_text: newText, system_prompt: currentPrompt }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_OBSERVER") {
    seenMessages.clear();
    currentChatId = request.session.chatId;
    currentPrompt = request.session.prompt;
    
    // 🔥 FIX: Acknowledge the popup instantly so it doesn't throw a connection error!
    sendResponse({ success: true });
    
    setTimeout(() => {
        transmitUpdates();
        if (!observer) {
          observer = new MutationObserver(() => {
            clearTimeout(window.observerTimeout);
            window.observerTimeout = setTimeout(transmitUpdates, 8000); 
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }
    }, 500);
    return true;
  } 
  else if (request.action === "STOP_OBSERVER") {
    if (observer) { observer.disconnect(); observer = null; }
    transmitUpdates();
    currentChatId = null;
    sendResponse({ success: true });
    return true;
  }
});