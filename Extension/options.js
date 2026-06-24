function saveOptions() {
  const prompts = {
    masterPrompt: document.getElementById('masterPrompt').value,
    prompt1: document.getElementById('p1').value,
    prompt2: document.getElementById('p2').value,
    prompt3: document.getElementById('p3').value
  };

  chrome.storage.sync.set({ prompts: prompts }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Configuration saved securely!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

function restoreOptions() {
  chrome.storage.sync.get(['prompts'], (result) => {
    if (result.prompts) {
      document.getElementById('masterPrompt').value = result.prompts.masterPrompt || "You are an expert technical editor. Compile the raw chat notes into a beautifully structured, cohesive Markdown document.";
      document.getElementById('p1').value = result.prompts.prompt1 || "Format this into a highly structured documentation page.";
      document.getElementById('p2').value = result.prompts.prompt2 || "Extract all action items and tasks.";
      document.getElementById('p3').value = result.prompts.prompt3 || "Rewrite this text to be more professional.";
    }
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);