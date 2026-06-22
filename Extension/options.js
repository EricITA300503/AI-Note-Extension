function saveOptions() {
  const prompts = {
    prompt1: document.getElementById('p1').value,
    prompt2: document.getElementById('p2').value,
    prompt3: document.getElementById('p3').value
  };
  // Grab the checkbox state
  const useDeepSynthesis = document.getElementById('deepSynthesis').checked;

  chrome.storage.sync.set({ prompts: prompts, useDeepSynthesis: useDeepSynthesis }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(() => { status.textContent = ''; }, 1500);
  });
}

function restoreOptions() {
  chrome.storage.sync.get(['prompts', 'useDeepSynthesis'], (result) => {
    if (result.prompts) {
      document.getElementById('p1').value = result.prompts.prompt1;
      document.getElementById('p2').value = result.prompts.prompt2;
      document.getElementById('p3').value = result.prompts.prompt3;
    }
    // Restore the checkbox state
    if (result.useDeepSynthesis !== undefined) {
      document.getElementById('deepSynthesis').checked = result.useDeepSynthesis;
    }
  });
}

// --- 🔥 FIX: Wire the functions up to Chrome Events 🔥 ---
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);