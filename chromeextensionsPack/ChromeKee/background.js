// background.js - Handles communication with Flask backend

const API_URL = 'https://localhost:5000';
let isUnlocked = false;
let backendReachable = false;

// ---------- Update the badge ----------
function updateBadge() {
  const color = isUnlocked ? '#4CAF50' : '#f44336';
  const text = isUnlocked ? '✓' : '✗';

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });

  chrome.tabs.query({}, (tabs) => {
    for (let tab of tabs) {
      chrome.action.setBadgeText({ tabId: tab.id, text });
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color });
    }
  });
}

// ---------- Check database status ----------
function checkStatus() {
  fetch(`${API_URL}/status`)
    .then(response => response.json())
    .then(data => {
      backendReachable = true;
      isUnlocked = !data.locked;
      updateBadge();
    })
    .catch(error => {
      console.error('Backend not reachable:', error);
      backendReachable = false;
      isUnlocked = false;
      updateBadge();
    });
}

// ---------- Event listeners ----------
chrome.runtime.onStartup.addListener(checkStatus);
chrome.runtime.onInstalled.addListener(checkStatus);

// ---------- Safe message handling ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) {
    sendResponse({ success: false, error: 'Invalid message' });
    return;
  }

  switch (request.action) {
    case 'searchEntries':
      searchEntries(request.url).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'getCredentials':
      getCredentials(request.uuid).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'unlock':
      unlockDatabase(request.dbPath, request.password, request.keyfile).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'lock':
      lockDatabase().then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'checkStatus':
      sendResponse({ isUnlocked, backendReachable });
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// ---------- Unlock database ----------
function unlockDatabase(dbPath, password, keyfile) {
  return new Promise((resolve) => {
    if (!dbPath) {
      // Load saved dbPath if not provided
      chrome.storage.local.get(['dbPath'], (data) => {
        const pathToUse = data.dbPath;
        if (!pathToUse || !password) {
          resolve({ success: false, error: 'Database path and password are required' });
        } else {
          resolve(unlockDatabase(pathToUse, password, keyfile));
        }
      });
      return;
    }

    const safeKeyfile = keyfile || null;

    fetch(`${API_URL}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbPath, password, keyfile: safeKeyfile })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        isUnlocked = true;
        backendReachable = true;
        updateBadge();

        // Save dbPath
        chrome.storage.local.set({ dbPath });

        // Notify all tabs
        chrome.tabs.query({}, (tabs) => {
          for (let tab of tabs) {
            chrome.tabs.sendMessage(tab.id, { action: 'databaseUnlocked' }, () => {
              if (chrome.runtime.lastError) console.log('Tab', tab.id, 'has no content script');
            });
          }
        });
      }
      resolve(data);
    })
    .catch(error => {
      console.error('Unlock error:', error);
      backendReachable = false;
      resolve({ success: false, error: 'Cannot connect to backend. Make sure Python backend is running.' });
    });
  });
}

// ---------- Lock database ----------
function lockDatabase() {
  return fetch(`${API_URL}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  .then(response => response.json())
  .then(data => {
    isUnlocked = false;
    updateBadge();

    // Notify all tabs
    chrome.tabs.query({}, (tabs) => {
      for (let tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { action: 'databaseLocked' }, () => {
          if (chrome.runtime.lastError) console.log('Tab', tab.id, 'has no content script');
        });
      }
    });

    return data;
  })
  .catch(error => {
    console.error('Lock error:', error);
    backendReachable = false;
    return { success: false, error: error.message };
  });
}

// ---------- Search entries ----------
function searchEntries(url) {
  return fetch(`${API_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  .then(response => response.ok ? response.json() : { success: false, error: 'Database locked or backend error', entries: [] })
  .catch(error => {
    console.error('Search error:', error);
    backendReachable = false;
    return { success: false, error: error.message, entries: [] };
  });
}

// ---------- Get credentials ----------
function getCredentials(uuid) {
  return fetch(`${API_URL}/get-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid })
  })
  .then(response => response.ok ? response.json() : { success: false, error: 'Failed to get credentials' })
  .catch(error => {
    console.error('Get credentials error:', error);
    backendReachable = false;
    return { success: false, error: error.message };
  });
}

// ---------- Initial check ----------
checkStatus();
