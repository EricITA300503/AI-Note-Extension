document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);

function saveOptions() {
  const prompts = {
    prompt1: document.getElementById('p1').value,
    prompt2: document.getElementById('p2').value,
    prompt3: document.getElementById('p3').value
  };

  chrome.storage.sync.set({ prompts: prompts }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(() => { status.textContent = ''; }, 1500);
  });
}

function restoreOptions() {
  chrome.storage.sync.get(['prompts'], (result) => {
    if (result.prompts) {
      document.getElementById('p1').value = result.prompts.prompt1;
      document.getElementById('p2').value = result.prompts.prompt2;
      document.getElementById('p3').value = result.prompts.prompt3;
    }
  });
}