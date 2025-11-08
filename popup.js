const discardBtn = document.getElementById('discardCurrent');
const optionsBtn = document.getElementById('options');
const pinBtn = document.getElementById('togglePin');
const tabsList = document.getElementById('tabsList');

// Discard current active tab
discardBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.tabs.discard(tab.id, () => {
        if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
        renderTabs();
    });
});

// Open Options page
optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

// Create colored placeholder icon
function createSVGPlaceholder(title, size = 16) {
    const letter = title ? title[0].toUpperCase() : '?';
    const color = '#'+((1<<24)*Math.random()|0).toString(16).padStart(6,'0');
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${color}"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="${size/1.5}" fill="#fff">${letter}</text>
    </svg>
    `;
}

// --- Render tabs with indicator for pinned/whitelisted/audible/discarded states ---
function renderTabs() {
    chrome.runtime.sendMessage({ action: 'getTabData' }, (response) => {
        if (!response) return;
        const { tabs, timeout, whitelist } = response;
        tabsList.innerHTML = '';

        (async () => {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            // Find the active tab in the current window

        tabs.forEach(tab => {
            const div = document.createElement('div');
            div.className = 'tabItem';

            // favicon
            const iconSpan = document.createElement('span');
            if (tab.favIconUrl) {
                const img = document.createElement('img');
                img.src = tab.favIconUrl;
                iconSpan.appendChild(img);
            } else {
                iconSpan.innerHTML = createSVGPlaceholder(tab.title);
            }
            div.appendChild(iconSpan);

            // title
            const titleSpan = document.createElement('span');
            titleSpan.className = 'title';
            titleSpan.textContent = tab.title;

            // progress bar
            const progressContainer = document.createElement('div');
            progressContainer.className = 'progressContainer';
            const progressBar = document.createElement('div');
            progressBar.className = 'progressBar';

            const indicator = document.createElement('span');
            indicator.className = 'indicator';

            const isWhitelisted = whitelist && whitelist.some(entry =>
            entry && tab.url && tab.url.includes(entry.trim())
            );
            const isAudible = tab.audible;
            const isPinned = tab.isPinned;

            // Priority: pinned > whitelisted > audible > discarded > others
            if (isPinned) {
                titleSpan.style.color = 'blue';
                progressBar.style.backgroundColor = 'blue';
                progressBar.style.width = '100%';
                indicator.textContent = '📍';
                indicator.title = 'Pinned — will not be discarded';
                progressBar.title = 'Pinned tab — not discarded';
            } else if (isWhitelisted && !tab.discarded) {
                titleSpan.style.color = 'green';
                progressBar.style.backgroundColor = 'green';
                progressBar.style.width = '100%';
                indicator.textContent = '✅';
                indicator.title = 'Whitelisted URL — will not be discarded';
                progressBar.title = 'Whitelisted tab — not discarded';
            } else if (isAudible) {
                titleSpan.style.color = 'green';
                progressBar.style.backgroundColor = 'green';
                progressBar.style.width = '100%';
                indicator.textContent = '🎵';
                indicator.title = 'Audio playing — will not be discarded';
                progressBar.title = 'Audio tab — not discarded';
            } else if (tab.discarded) {
                titleSpan.style.color = 'gray';
                progressBar.style.backgroundColor = 'gray';
                progressBar.style.width = '100%';
                indicator.textContent = '💤';
                indicator.title = 'Tab discarded';
                progressBar.title = 'Tab discarded';
            } else if (tab.lastActive) {
                const remainingMs = (tab.lastActive + timeout * 60000) - Date.now();
                const fraction = Math.max(0, Math.min(1, remainingMs / (timeout * 60000)));

                const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
                const minutes = Math.floor(remainingSec / 60);
                const seconds = String(remainingSec % 60).padStart(2, '0');
                progressBar.title = `Time left: ${minutes}:${seconds}`;

                if (fraction >= 0.6) {
                    titleSpan.style.color = 'green';
                    progressBar.style.backgroundColor = 'green';
                } else if (fraction >= 0.3) {
                    titleSpan.style.color = 'orange';
                    progressBar.style.backgroundColor = 'orange';
                } else {
                    titleSpan.style.color = 'red';
                    progressBar.style.backgroundColor = 'red';
                }

                progressBar.style.width = `${Math.round(fraction * 100)}%`;
            } else {
                titleSpan.style.color = 'black';
                progressBar.style.backgroundColor = '#ccc';
                progressBar.style.width = '100%';
                progressBar.title = 'No activity recorded';
            }

            // --- Highlight the currently active tab ---
            if (activeTab && tab.id === activeTab.id) {
                div.style.background = 'linear-gradient(90deg, #ffe9f0, #fff)';
                div.style.border = '1px solid #d6336c';
                titleSpan.style.color = '#d6336c';
                titleSpan.style.fontWeight = 'bold';
                indicator.textContent = '⭐';
                indicator.title = 'Currently active tab';
                activeTabElement = div; // remember for scrolling
            }

            progressContainer.appendChild(progressBar);
            div.appendChild(titleSpan);
            div.appendChild(progressContainer);
            div.appendChild(indicator);
            tabsList.appendChild(div);
        });

        // --- Scroll to center the active tab in view ---
        if (activeTabElement) {
            setTimeout(() => {
                activeTabElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 100);
        }

      })();
    });
}

// --- Pin toggle button functionality ---
async function updatePinState() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.runtime.sendMessage({ action: 'isPinned', tabId: tab.id }, (response) => {
        if (response?.pinned) {
            pinBtn.classList.add('pinned');
            pinBtn.title = 'Pinned — will not be discarded';
            pinBtn.textContent = '📍 Unpin';
        } else {
            pinBtn.classList.remove('pinned');
            pinBtn.title = 'Unpinned — can be discarded';
            pinBtn.textContent = '📌 Pin';
        }
    });
}

pinBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.runtime.sendMessage({ action: 'togglePin', tabId: tab.id }, () => {
        updatePinState();
        renderTabs();
    });
});

// Initial load
updatePinState();
renderTabs();
