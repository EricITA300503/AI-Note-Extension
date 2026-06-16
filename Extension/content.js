let observer = null;
let seenMessages = new Set();
let currentChatId = null;
let currentPrompt = null;

function extractNewMessages() {
  let newChatText = "";
  const nodes = document.querySelectorAll('user-query, model-response, [data-message-author-role], .font-user-message, .font-claude-message');

  nodes.forEach(node => {
    const text = node.innerText.trim();
    if (text && !seenMessages.has(text)) {
      seenMessages.add(text);

      let role = 'System';
      if (node.tagName.toLowerCase() === 'user-query') role = 'User';
      else if (node.tagName.toLowerCase() === 'model-response') role = 'Gemini';
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