const ALARM_PERIOD_MINUTES = 1;

let tabTimestamps = {};
let settings = { timeout: 30, whitelist: [], debug : false }; // default timeout in minutes
let skipList = new Set();

// Load settings
chrome.storage.sync.get(['timeout', 'whitelist', 'debug'], (data) => {
    if (data.timeout) settings.timeout = data.timeout;
    if (data.whitelist) settings.whitelist = data.whitelist;
    if (data.debug) settings.debug = data.debug;
    if (settings.debug) console.log('Settings loaded:', settings);
});

// --- Initialize tab timestamps on startup or extension reload ---
function initializeTimestamps() {
    chrome.tabs.query({}, (tabs) => {
        const now = Date.now();
        let newCount = 0;

        for (const tab of tabs) {
            // Only initialize if the tab doesn’t already have a timestamp
            if (!(tab.id in tabTimestamps)) {
                tabTimestamps[tab.id] = now;
                newCount++;
            }
        }

        if (settings.debug) {
            console.log(
                `initializeTimestamps: ensured timestamps for ${tabs.length} tabs, ` +
                `${newCount} were newly initialized`
            );
        }
        chrome.storage.local.set({tabTimestamps});
    });
}

chrome.runtime.onStartup.addListener(() => {
    if (settings.debug) console.log('Browser startup detected — scheduling timestamp update');

    // Wait a bit for Chrome to restore all tabs
    setTimeout(() => {
        initializeTimestamps();
    }, 8000); // 8 seconds — tweak for slower systems
});
chrome.runtime.onInstalled.addListener(initializeTimestamps);


// Update timestamp
function updateTabTimestamp(tabId) {
    tabTimestamps[tabId] = Date.now();
    chrome.storage.local.set({tabTimestamps});
    if (settings.debug) console.log(`Timestamp updated for tab ${tabId}`);
}

// Check whitelist
function isWhitelisted(url) {
    return settings.whitelist.some(part => url.includes(part));
}

// Safe discard tab
function discardTab(tab) {
    if (tab.active) {
        if (settings.debug) console.log(`Skipped active ${tab.id}`);
        return;
    }
    if (tab.discarded) {
        if (settings.debug) console.log(`Skipped already discarded ${tab.id}`);
        return;
    }
    if (tab.audible) {
        if (settings.debug) console.log(`Skipped audible ${tab.id}`);
        return;
    }
    if (tab.pinned) {
        if (settings.debug) console.log(`Skipped pinned ${tab.id}`);
        return;
    }
    if (skipList.has(tab.id)) {
        if (settings.debug) console.log(`Skipped ignored ${tab.id}`);
        return;
    }
    if (isWhitelisted(tab.url)) {
        if (settings.debug) console.log(`Skipped whitelisted ${tab.id}`);
        return;
    }
    if (settings.debug) console.log(`Attempting to discard tab ${tab.id}: ${tab.title}`);
    chrome.tabs.discard(tab.id, () => {
        if (chrome.runtime.lastError) {
            if (settings.debug) console.log(`Could not discard tab ${tab.id}: ${chrome.runtime.lastError.message}`);
            return;
        }
        if (settings.debug) console.log(`Tab ${tab.id} discarded`);
    });
}

// Set toolbar icon safely
function setToolbarIcon(tab) {
    let iconPath = 'icons/normal.png';
    if (isWhitelisted(tab.url)) iconPath = 'icons/whitelisted.png';
    if (tab.discarded) iconPath = 'icons/discarded.png';
    if (skipList.has(tab.id)) iconPath = 'icons/whitelisted.png';

    chrome.action.setIcon({
        tabId: tab.id,
        path: {
            16: iconPath,
            32: iconPath,
            48: iconPath,
            128: iconPath
        }
    }, () => {
        if (chrome.runtime.lastError) {
            if (settings.debug) console.log(`Could not set icon for tab ${tab.id}: ${chrome.runtime.lastError.message}`);
            return;
        }
        if (settings.debug) console.log(`Toolbar icon updated for tab ${tab.id}`);
    });
}

// Event listeners for updating icons and time stamps
chrome.tabs.onCreated.addListener(tab => updateTabTimestamp(tab.id));

chrome.tabs.onActivated.addListener(activeInfo => {
    updateTabTimestamp(activeInfo.tabId);
    chrome.tabs.get(activeInfo.tabId, tab => {
        if (chrome.runtime.lastError) {
            if (settings.debug) console.log(`Could not set icon for tab ${tab.id}: ${chrome.runtime.lastError.message}`);
            return;
        }
        setToolbarIcon(tab);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && changeInfo.status === 'complete') {
        if (chrome.runtime.lastError) {
            if (settings.debug) console.log(`Could not set icon for tab ${tab.id}: ${chrome.runtime.lastError.message}`);
            return;
        }
        setToolbarIcon(tab);
    }
});


// Main timer function but needs to be run in the main body too after the worker restarted from inactive
function CheckTabsFromTimer() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            if (settings.debug) console.log(`Strange, no active tabs to update timestamp`);
        } else {
            updateTabTimestamp(tabs[0].id);
        }
    });
    chrome.tabs.query({}, (tabs) => {
        const now = Date.now();
        tabs.forEach(tab => {
            const last = tabTimestamps[tab.id];
            if (last && (now - last) / 60000 >= settings.timeout) { // minutes
                discardTab(tab);
            }
        });
    });
    chrome.tabs.query({}, (tabs) => {
        const openTabIds = new Set(tabs.map(t => t.id));
        Object.keys(tabTimestamps).forEach(tabId => {
            if (!openTabIds.has(Number(tabId))) {
                if (settings.debug) console.log(`Cleaning up timestamp for closed tab ${tabId}`);
                delete tabTimestamps[tabId];
            }
        });
        for (const tabId of Array.from(skipList)) {
            if (!openTabIds.has(Number(tabId))) {
                skipList.delete(tabId);
                if (settings.debug) console.log(`Removed closed tab ${tabId} from skipList`);
            }
        }
    });
    chrome.storage.local.set({tabTimestamps});
    chrome.storage.local.set({skipList: Array.from(skipList)});
}

// Periodic alarm timer to update and discard tabs
chrome.alarms.create('CheckTabs', { periodInMinutes: ALARM_PERIOD_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'CheckTabs') {
        CheckTabsFromTimer();
    }
});


// Load local storage -- also called on worker reactivation
chrome.storage.local.get(['tabTimestamps', 'skipList'], (data) => {
    if (data.tabTimestamps) tabTimestamps = data.tabTimestamps;
    if (data.skipList) skipList = new Set(data.skipList);
    if (settings.debug) console.log('tabTimestamps and skipList loaded');
    // Run first check on reactivation
    CheckTabsFromTimer();
});


// Listen for settings changes from storage or popup/options
chrome.storage.onChanged.addListener(changes => {
    if (changes.debug) {
        settings.debug = changes.debug.newValue;
        if (settings.debug) console.log('debug updated:', settings.debug);
    }
    if (changes.timeout) {
        settings.timeout = changes.timeout.newValue;
        if (settings.debug) console.log('Timeout updated:', settings.timeout);
    }
    if (changes.whitelist) {
        settings.whitelist = changes.whitelist.newValue;
        if (settings.debug) console.log('Whitelist updated:', settings.whitelist);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'togglePin') {
        const tabId = message.tabId;
        if (skipList.has(tabId)) {
            skipList.delete(tabId);
        } else {
            skipList.add(tabId);
        }
        chrome.storage.local.set({skipList: Array.from(skipList)});
        sendResponse({ pinned: skipList.has(tabId) });
    }
    if (message.action === 'isPinned') {
        sendResponse({ pinned: skipList.has(message.tabId) });
    }
    if (message.action === 'updateSettings') {
        if (message.debug) settings.debug = message.debug;
        if (message.timeout) settings.timeout = message.timeout;
        if (message.whitelist) settings.whitelist = message.whitelist;
        if (settings.debug) console.log('Settings updated from popup/options:', settings);
        sendResponse({ success: true });
    }
    if (message.action === 'getTabData') {
        chrome.tabs.query({}, (tabs) => {
            const data = tabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                discarded: tab.discarded,
                audible: tab.audible,
                lastActive: tabTimestamps[tab.id] || null,
                isPinned: skipList.has(tab.id)
            }));
            sendResponse({ tabs: data, timeout: settings.timeout, whitelist: settings.whitelist });
        });
        return true; // keep channel open for async response
    }
});
