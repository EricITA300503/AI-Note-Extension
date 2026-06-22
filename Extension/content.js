let observer = null;
let seenMessages = new Set();
let currentChatId = null;
let currentPrompt = null;

//S NEW: Recursive Breadth-First Search to pierce Gemini's Shadow DOM boundaries
function queryAllDeep(selector, root = document) {
    let results = Array.from(root.querySelectorAll(selector));
    
    // Find all elements that host a shadowRoot
    const elementsWithShadow = Array.from(root.querySelectorAll('*')).filter(el => el.shadowRoot);
    
    // Recursively search inside every shadowRoot
    for (const el of elementsWithShadow) {
        results = results.concat(queryAllDeep(selector, el.shadowRoot));
    }
    
    return results;
}

function extractNewMessages() {
  let newChatText = "";
  
  // Use the deep query to hunt down Gemini's custom elements through the Shadow DOM
  const nodes = queryAllDeep('user-query, model-response, [data-message-author-role], .font-user-message, .font-claude-message');

  nodes.forEach(node => {
    // 🔥 FIX: Extract text from inside the Shadow Root if it exists
    let text = "";
    if (node.shadowRoot) {
      text = node.shadowRoot.textContent.trim();
    } else {
      text = node.innerText ? node.innerText.trim() : node.textContent.trim();
    }

    if (text && !seenMessages.has(text)) {
      seenMessages.add(text);

      let role = 'System';
      const tagName = node.tagName.toLowerCase();
      
      // Map Gemini's specific tags to clean roles
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
  
  console.log("=== Local Vault Capture Debug ===");
  console.log("Extracted Text Length:", newText.trim().length);
  
  if (newText.trim() === "" || !currentChatId) {
      return; 
  }

  console.log("🚀 Shadow DOM pierced! Sending chat chunk to background relay...");

  // Send the full payload safely to the background relay
  chrome.runtime.sendMessage({ 
    action: "FORWARD_TO_SERVER", 
    payload: {
      chat_id: currentChatId,
      new_text: newText,
      system_prompt: currentPrompt
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_OBSERVER") {
    seenMessages.clear();
    // Grab the ID and Prompt sent from the popup
    currentChatId = request.session.chatId;
    currentPrompt = request.session.prompt;
    
    transmitUpdates(); // Instantly scrape existing viewport contents

    if (!observer) {
      observer = new MutationObserver(() => {
        clearTimeout(window.observerTimeout);
        // 10-second debounce gives Gemini time to finish streaming its answer
        window.observerTimeout = setTimeout(transmitUpdates, 10000); 
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    sendResponse({ success: true });
  } 
  else if (request.action === "STOP_OBSERVER") {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    transmitUpdates();
    currentChatId = null;
    sendResponse({ success: true });
  }
});