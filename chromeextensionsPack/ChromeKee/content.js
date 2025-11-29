// 🔒 Block noisy alerts from other extensions (KeePassXC-Browser etc.)
(function () {
  const originalAlert = window.alert;
  window.alert = function (msg) {
    if (typeof msg === 'string' &&
        (msg.includes('Database is locked') ||
         msg.includes('Unlock it from the extension popup'))) {
      console.warn('[🛡️ Blocked external alert]', msg);
      return; // silently suppress
    }
    return originalAlert.apply(this, arguments);
  };
})();

console.log('KeePass Auto-Fill: Content script loaded');

// 🔐 Click authorization (mouse/touch only)
let isClickAuthorized = false;

function authorizeClick() {
  isClickAuthorized = true;
  setTimeout(() => isClickAuthorized = false, 150); // short window
}

// 📢 Show user-friendly notification
function showUserMessage(message, type = 'error') {
  // Remove any existing notification
  const existing = document.getElementById('keepass-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.id = 'keepass-notification';

  const colors = {
    error: { bg: '#FFEBEE', border: '#C62828', text: '#C62828' },
    success: { bg: '#E8F5E9', border: '#2E7D32', text: '#2E7D32' },
    info: { bg: '#E3F2FD', border: '#2196F3', text: '#1565C0' }
  };

  const color = colors[type] || colors.error;

  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999999;
    background: ${color.bg};
    border: 2px solid ${color.border};
    color: ${color.text};
    padding: 15px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    max-width: 350px;
    animation: slideIn 0.3s ease-out;
  `;

  notification.textContent = message;

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    notification.style.transition = 'opacity 0.3s, transform 0.3s';
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(400px)';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

function detectLoginFields() {
  const usernameField =
    document.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="login"], input[name*="email"]');
  const passwordField = document.querySelector('input[type="password"]');
  return { usernameField, passwordField };
}

// Create the UX-refined KeePass button — mouse/touch only
function createKeyButton() {
  const button = document.createElement('button');
  button.textContent = '🔑';
  button.title = 'Fill KeePass credentials';

  button.style.cssText = `
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    z-index: 10000;
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.15s, opacity 0.15s, transform 0.15s;
    opacity: 0.85;
    box-shadow: 0 2px 4px rgba(0,0,0,0.25);
  `;

  // ✅ Authorize only on real mouse/touch
  button.addEventListener('mousedown', (e) => {
    if (e.button === 0) authorizeClick(); // left mouse only
  });
  button.addEventListener('touchstart', (e) => {
    authorizeClick();
  }, { passive: true });

  button.addEventListener('mouseenter', () => {
    button.style.opacity = '1';
    button.style.background = '#45A049';
    button.style.transform = 'translateY(-50%) scale(1.05)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.opacity = '0.85';
    button.style.background = '#4CAF50';
    button.style.transform = 'translateY(-50%) scale(1)';
  });

  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();

    // 🔐 Enforce mouse/touch only
    if (!isClickAuthorized) {
      console.warn('[KeePass] Click ignored: Not initiated by mouse/touch');
      return;
    }

    await fillCredentials();
  });

  return button;
}

function addAutoFillButton() {
  const { usernameField, passwordField } = detectLoginFields();
  if (!passwordField) return;

  if (passwordField.dataset.keepassButton) return;
  passwordField.dataset.keepassButton = 'true';

  const parent = passwordField.parentElement;
  if (!parent) return;

  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  const existingPadding = parseInt(getComputedStyle(passwordField).paddingRight) || 0;
  passwordField.style.paddingRight = (existingPadding + 32) + 'px';

  const button = createKeyButton();
  parent.appendChild(button);
}

async function fillCredentials() {
  const { usernameField, passwordField } = detectLoginFields();
  if (!passwordField) {
    console.warn('[KeePass] No password field found');
    showUserMessage('❌ No password field detected on this page', 'error');
    return;
  }

  const currentUrl = window.location.href;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'searchEntries',
      url: currentUrl
    });

    if (!response?.success) {
      console.warn('[KeePass] Database locked or backend unreachable');
      showUserMessage('🔒 Database is locked. Please unlock it from the extension popup.', 'error');
      return;
    }

    const entries = response.entries;
    if (entries.length === 0) {
      console.info('[KeePass] No matching entries for:', currentUrl);
      showUserMessage('ℹ️ No matching login entries found for this site', 'info');
      return;
    }

    let selectedEntry;
    if (entries.length === 1) {
      selectedEntry = entries[0];
    } else {
      const titles = entries.map((e, i) => `${i + 1}. ${e.title} (${e.username})`).join('\n');
      const choice = prompt(`Multiple logins detected:\n\n${titles}\n\nEnter number:`);
      if (!choice) return;
      const index = parseInt(choice) - 1;
      if (index < 0 || index >= entries.length) {
        showUserMessage('❌ Invalid selection', 'error');
        return;
      }
      selectedEntry = entries[index];
    }

    const cred = await chrome.runtime.sendMessage({
      action: 'getCredentials',
      uuid: selectedEntry.uuid
    });

    if (!cred?.success) {
      console.error('[KeePass] Failed to retrieve credentials');
      showUserMessage('❌ Failed to retrieve credentials', 'error');
      return;
    }

    // ✅ Fill credentials
    if (usernameField && cred.username) {
      usernameField.value = cred.username;
      usernameField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (passwordField && cred.password) {
      passwordField.value = cred.password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));

      // Success glow
      passwordField.style.transition = 'background 0.3s';
      passwordField.style.backgroundColor = '#E8F5E9';
      setTimeout(() => passwordField.style.backgroundColor = '', 600);
    }

    console.log('[KeePass] ✅ Credentials filled successfully');
    showUserMessage('✅ Credentials filled successfully!', 'success');
  } catch (err) {
    console.error('[KeePass] Fill error:', err);
    showUserMessage('❌ An error occurred. Please try again.', 'error');
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addAutoFillButton);
} else {
  addAutoFillButton();
}

// Observe dynamic forms
const observer = new MutationObserver(addAutoFillButton);
observer.observe(document.body, { childList: true, subtree: true });