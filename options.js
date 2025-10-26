const timeoutInput = document.getElementById('timeout');
const whitelistInput = document.getElementById('whitelist');
const debugInput = document.getElementById('debug');
const saveBtn = document.getElementById('save');
const messageDiv = document.createElement('div');
messageDiv.style.color = 'green';
messageDiv.style.marginTop = '10px';
document.body.appendChild(messageDiv);

// Load current settings
chrome.storage.sync.get(['timeout', 'whitelist', 'debug'], (data) => {
    timeoutInput.value = data.timeout || 30; // minutes
    whitelistInput.value = (data.whitelist || []).join(',');
    debugInput.checked = data.debug || false;
});

// Save settings and show temporary message
saveBtn.addEventListener('click', () => {
    const timeout = parseInt(timeoutInput.value); // minutes
    const whitelist = whitelistInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const debug = debugInput.checked;

    chrome.storage.sync.set({ timeout, whitelist, debug }, () => {
        console.log('Settings saved:', { timeout, whitelist, debug });

        // Notify background
        chrome.runtime.sendMessage({ action: 'updateSettings', timeout, whitelist, debug }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Failed to notify background:', chrome.runtime.lastError);
            } else {
                console.log('Background updated with new settings.');
            }
        });

        // Show temporary message on page
        messageDiv.textContent = 'Settings saved!';
        setTimeout(() => { messageDiv.textContent = ''; }, 3000); // clear after 3 seconds
    });
});
