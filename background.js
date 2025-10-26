const ALARM_PERIOD_MINUTES = 1; // Alarm period in minutes

let TTLs = {};
let settings = { timeout: 30, whitelist: [], debug : false }; // default timeout in minutes
let skipList = new Set();

// Load settings
chrome.storage.sync.get(['timeout', 'whitelist', 'debug'], (data) => {
    if (data.timeout) settings.timeout = data.timeout;
    if (data.whitelist) settings.whitelist = data.whitelist;
    if (data.debug) settings.debug = data.debug;
    if (settings.debug) console.log('Settings loaded:', settings);
});

chrome.storage.local.get(['TTLs', 'skipList'], (data) => {
    if (data.TTLs) TTLs = data.TTLs;
    if (data.skipList) skipList = new Set(data.skipList);
    if (settings.debug) console.log('TTLs and skipList loaded');
});

// --- Initialize tab TTLs on startup or extension reload ---
chrome.runtime.onStartup.addListener(initializeTTLs);
chrome.runtime.onInstalled.addListener(initializeTTLs);

function initializeTTLs() {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            TTLs[tab.id] = settings.timeout;
        });
        if (settings.debug) console.log(`Initialized TTLs for ${tabs.length} open tabs`);
    });
}

// Update TTL
function updateTabTTL(tabId) {
    TTLs[tabId] = settings.timeout;
    if (settings.debug) console.log(`TTL updated to ${TTLs[tabId]} for tab ${tabId}`);
}

// Check whitelist
function isWhitelisted(url) {
    return settings.whitelist.some(part => url.includes(part));
}

// Filter
function isDiscardable(tab) {
    if (skipList.has(tab.id)) {
        if (settings.debug) console.log(`Skipped ignored ${tab.id}`);
        return false;
    }
    if (tab.active) {
        if (settings.debug) console.log(`Skipped active ${tab.id}`);
        return false;
    }
    if (tab.pinned) {
        if (settings.debug) console.log(`Skipped pinned ${tab.id}`);
        return false;
    }
    if (isWhitelisted(tab.url)) {
        if (settings.debug) console.log(`Skipped whitelisted ${tab.id}`);
        return false;
    }
    if (tab.discarded) {
        if (settings.debug) console.log(`Skipped already discarded ${tab.id}`);
        return false;
    }
    if (tab.audible) {
        if (settings.debug) console.log(`Skipped audible ${tab.id}`);
        return false;
    }
    return true;
}

function discardTab(tab) {
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
chrome.tabs.onActivated.addListener(activeInfo => {
    updateTabTTL(activeInfo.tabId);
    chrome.tabs.get(activeInfo.tabId, tab => {
        if (chrome.runtime.lastError) {
            if (settings.debug) console.log(`Could not set icon for tab ${tab.id}: ${chrome.runtime.lastError.message}`);
            return;
        }
        setToolbarIcon(tab);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    updateTabTTL(tabId);
    if (tab.active && changeInfo.status === 'complete') {
        if (chrome.runtime.lastError) {
            if (settings.debug) console.log(`Could not set icon for tab ${tab.id}: ${chrome.runtime.lastError.message}`);
            return;
        }
        setToolbarIcon(tab);
    }
});

// Periodic discard and cleanup alarms
chrome.alarms.create('CheckTabs', { periodInMinutes: ALARM_PERIOD_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'CheckTabs') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                if (settings.debug) console.log(`Strange, no active tabs to update TTL`);
            } else {
                updateTabTTL(tabs[0].id);
            }
        });
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (isDiscardable(tab)) {
                    TTLs[tab.id] = (TTLs[tab.id] || 0) - 1
                    if (settings.debug) console.log(`TTL updated to ${TTLs[tab.id]} for tab ${tab.id}`);
                    if (TTLs[tab.id] <= 0) { // minutes
                        discardTab(tab);
                    }
                }
            });
        });
        chrome.tabs.query({}, (tabs) => {
            const openTabIds = new Set(tabs.map(t => t.id));
            Object.keys(TTLs).forEach(tabId => {
                if (!openTabIds.has(Number(tabId))) {
                    if (settings.debug) console.log(`Cleaning up TTL for closed tab ${tabId}`);
                    delete TTLs[tabId];
                }
            });
            for (const tabId of Array.from(skipList)) {
                if (!openTabIds.has(Number(tabId))) {
                    skipList.delete(tabId);
                    if (settings.debug) console.log(`Removed closed tab ${tabId} from skipList`);
                }
            }
        });
        chrome.storage.local.set({TTLs});
    }
});

chrome.tabs.onCreated.addListener(tab => updateTabTTL(tab.id));
chrome.tabs.onRemoved.addListener(tabId => {
    skipList.delete(tabId);
    delete TTLs[tabId];
    if (settings.debug) console.log(`Tab removed: ${tabId}`);
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
                TTL: TTLs[tab.id] || null,
                isPinned: skipList.has(tab.id)
            }));
            sendResponse({ tabs: data, timeout: settings.timeout, whitelist: settings.whitelist });
        });
        return true; // keep channel open for async response
    }
});
