chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.get(['prompts'], (result) => {
      if (!result.prompts) {
        const defaultPrompts = {
          prompt1: "Summarize this text into 3 bullet points.",
          prompt2: "Extract all action items and tasks from this text.",
          prompt3: "Rewrite this text to be more professional and concise."
        };
        chrome.storage.sync.set({ prompts: defaultPrompts });
      }
    });
  }
});