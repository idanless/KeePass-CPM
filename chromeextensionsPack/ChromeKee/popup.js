document.addEventListener('DOMContentLoaded', async () => {
  const statusDiv = document.getElementById('status');
  const setupInstructions = document.getElementById('setupInstructions');
  const unlockForm = document.getElementById('unlockForm');
  const lockedControls = document.getElementById('lockedControls');
  const dbPathInput = document.getElementById('dbPath');
  const passwordInput = document.getElementById('password');
  const keyfileInput = document.getElementById('keyfile');
  const unlockBtn = document.getElementById('unlockBtn');
  const lockBtn = document.getElementById('lockBtn');
  const messageDiv = document.getElementById('message');
  const checkConnectionBtn = document.getElementById('checkConnection');
  const connectionStatus = document.getElementById('connectionStatus');

  // ---------- Load saved DB path safely ----------
  await new Promise((resolve) => {
    chrome.storage.local.get(['dbPath'], (data) => {
      if (dbPathInput) {
        dbPathInput.value = (data && typeof data.dbPath === 'string') ? data.dbPath : '';
      }
      resolve();
    });
  });

  // ---------- Save DB path on change ----------
  if (dbPathInput) {
    dbPathInput.addEventListener('change', () => {
      chrome.storage.local.set({ dbPath: dbPathInput.value.trim() });
    });
  }

  // ---------- Check backend connection ----------
  async function checkBackendConnection() {
    connectionStatus.textContent = '🔄 Checking connection...';
    connectionStatus.className = 'connection-status checking';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'checkStatus' });

      if (response && response.backendReachable !== false) {
        connectionStatus.textContent = '✅ Backend connected successfully!';
        connectionStatus.className = 'connection-status success';
        setupInstructions.style.display = 'none';
        updateUI(response.isUnlocked);

        setTimeout(() => {
          connectionStatus.style.display = 'none';
        }, 3000);
      } else {
        throw new Error('Backend not reachable');
      }
    } catch (error) {
      connectionStatus.textContent = '❌ Backend not running. Please start the Python backend.';
      connectionStatus.className = 'connection-status error';
      setupInstructions.style.display = 'block';
      unlockForm.style.display = 'none';
      lockedControls.style.display = 'none';
      statusDiv.textContent = '⚠️ Backend Not Connected';
      statusDiv.className = 'status disconnected';
    }
  }

  // ---------- Update UI ----------
  function updateUI(isUnlocked) {
    if (isUnlocked) {
      statusDiv.textContent = '🔓 Database Unlocked';
      statusDiv.className = 'status unlocked';
      setupInstructions.style.display = 'none';
      unlockForm.style.display = 'none';
      lockedControls.style.display = 'block';
    } else {
      statusDiv.textContent = '🔒 Database Locked';
      statusDiv.className = 'status locked';
      setupInstructions.style.display = 'none';
      unlockForm.style.display = 'block';
      lockedControls.style.display = 'none';
    }
  }

  // ---------- Disable Enter key globally in popup (MULTIPLE METHODS) ----------
  console.log('Setting up Enter key blockers...');

  // Method 1: Capture phase at document level
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      console.log('🛑 ENTER BLOCKED (Method 1 - keydown capture)', e.target.tagName, e.target.id);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);

  // Method 2: Keypress at document level
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      console.log('🛑 ENTER BLOCKED (Method 2 - keypress)', e.target.tagName, e.target.id);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);

  // Method 3: On each input field directly
  [dbPathInput, passwordInput, keyfileInput].forEach((input, index) => {
    if (input) {
      ['keydown', 'keypress', 'keyup'].forEach(eventType => {
        input.addEventListener(eventType, (e) => {
          if (e.key === 'Enter' || e.keyCode === 13) {
            console.log(`🛑 ENTER BLOCKED (Method 3 - ${eventType} on input ${index})`, input.id);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
          }
        });
      });
    }
  });

  console.log('✅ Enter key blockers set up');

  // ---------- Unlock database ----------
  unlockBtn.addEventListener('click', async (e) => {
    console.log('UNLOCK BUTTON CLICKED!', e.type, e.isTrusted);

    const dbPath = dbPathInput.value.trim();
    const password = passwordInput.value;
    const keyfile = keyfileInput.value.trim() || null;

    if (!dbPath) {
      showMessage('❌ Please enter database path', 'error');
      return;
    }

    if (!password) {
      showMessage('❌ Please enter master password', 'error');
      return;
    }

    unlockBtn.textContent = '🔄 Unlocking...';
    unlockBtn.disabled = true;
    messageDiv.style.display = 'none';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'unlock',
        dbPath,
        password,
        keyfile
      });

      unlockBtn.textContent = '🔓 Unlock Database';
      unlockBtn.disabled = false;

      if (result && result.success) {
        showMessage('✅ Database unlocked successfully!', 'success');
        passwordInput.value = ''; // Clear password for security

        // Save DB path
        chrome.storage.local.set({ dbPath });

        setTimeout(() => updateUI(true), 500);
      } else {
        showMessage('❌ Failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      unlockBtn.textContent = '🔓 Unlock Database';
      unlockBtn.disabled = false;
      showMessage('❌ Error: ' + error.message, 'error');
    }
  });

  // ---------- Lock database ----------
  lockBtn.addEventListener('click', async () => {
    lockBtn.textContent = '🔄 Locking...';
    lockBtn.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({ action: 'lock' });
      lockBtn.textContent = '🔒 Lock Database';
      lockBtn.disabled = false;

      if (result && result.success) {
        showMessage('✅ Database locked successfully', 'success');
        setTimeout(() => updateUI(false), 500);
      } else {
        showMessage('❌ Failed to lock database', 'error');
      }
    } catch (error) {
      lockBtn.textContent = '🔒 Lock Database';
      lockBtn.disabled = false;
      showMessage('❌ Error: ' + error.message, 'error');
    }
  });

  // ---------- Show messages ----------
  function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';

    if (type === 'success') {
      setTimeout(() => {
        messageDiv.style.display = 'none';
      }, 5000);
    }
  }

  // ---------- Initial backend check ----------
  await checkBackendConnection();

  // ---------- Check connection button ----------
  checkConnectionBtn.addEventListener('click', async () => {
    await checkBackendConnection();
  });
});