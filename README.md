<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>KeePass-CPM</title>
</head>
<body>
  <h1>KeePass-CPM</h1>
  <p>Chrome extension that auto-fills passwords from your local KeePass database. Everything runs on your machine — no cloud, no tracking.</p>

  <hr />

  <h2>What it does</h2>
  <p>Works like any password manager, except your passwords stay in your KeePass file on your computer:</p>
  <ol>
    <li>Visit a login page</li>
    <li>Extension shows a 🔑 button next to the password field</li>
    <li>Click it, pick your account</li>
    <li>Username and password filled automatically</li>
  </ol>
  <p>A local Python server reads your KeePass database and talks to the extension over HTTPS.</p>

  <hr />

  <h2>Screenshots (example UI)</h2>
  <p><!-- Screenshot 1 — login form / extension popup --></p>
  <img src="screenshots/login_or_popup.png" alt="Login form with KeePass-CPM button" style="max-width:100%;"/>

  <p><!-- Screenshot 2 — account selection or multiple-account list --></p>
  <img src="screenshots/select_or_list.png" alt="Credential selection popup" style="max-width:100%;"/>

  <hr />

  <h2>Quick Setup (with built-in CA)</h2>
  <ol>
    <li><strong>Clone the repo</strong><br/>
      <code>git clone https://github.com/idanless/KeePass-CPM.git</code>
    </li>
    <li><strong>Load extension</strong><br/>
      Open <code>chrome://extensions</code>, enable “Developer mode”, click “Load unpacked”, select the <code>extension/</code> directory.</li>
    <li><strong>Trust the provided CA certificate</strong><br/>
      <ul>
        <li><strong>Windows:</strong> double-click <code>backend/ca-cert.pfx</code> → install to “Trusted Root Certification Authorities” (requires admin).</li>
        <li><strong>macOS:</strong> import the cert to System keychain via Keychain Access, set to “Always Trust”.</li>
        <li><strong>Linux (Debian/Ubuntu):</strong><br/>
          <code>sudo cp backend/ca-cert.pem /usr/local/share/ca-certificates/keepass-cpm.crt<br/>
          sudo update-ca-certificates</code>
        </li>
      </ul>
    </li>
    <li><strong>Start the backend</strong><br/>
      <code>cd backend<br/>
      pip install -r requirements.txt<br/>
      python backend.py</code></li>
    <li><strong>Unlock your KeePass DB</strong><br/>
      In the extension popup enter your database path (e.g. <code>/home/user/passwords.kdbx</code>), master password (or optional keyfile) → click “Unlock Database”.</li>
  </ol>

  <hr />

  <h2>How it works</h2>
  <pre>
Chrome → Extension → Flask Backend → KeePass Database
        (detects login)    (searches        (your .kdbx file)
                          for matching URLs)
  </pre>
  <p>Flow:</p>
  <ol>
    <li>You visit a login page (e.g. <code>https://github.com/login</code>)</li>
    <li>Extension detects the password field + domain (e.g. <code>github.com</code>)</li>
    <li>Extension sends HTTPS request to <code>https://localhost:5000/search</code></li>
    <li>Backend opens your KeePass database, searches for entries where URL (or title) matches domain</li>
    <li>Extension shows list of matching entries</li>
    <li>You pick entry → extension requests credentials via <code>/get-credentials</code></li>
    <li>Backend returns username & password → extension auto-fills form</li>
  </ol>
  <p>Security highlights:</p>
  <ul>
    <li>Extension ↔ Backend: HTTPS (localhost)</li>
    <li>Database: AES-256 (KeePass encryption)</li>
    <li>Database decrypted only in memory; never stored unencrypted</li>
    <li>No analytics, no cloud sync, no external connections — everything stays local</li>
  </ul>

  <hr />

  <h2>For developers & testers</h2>
  <p>If you prefer customizing or re-generating certificates instead of using bundled CA, you can still use <code>create_certs.sh</code> and follow original instructions. The “Quick Setup” workflow above is for users who want a plug-and-play install.</p>

  <hr />

  <h2>Requirements</h2>
  <ul>
    <li>Python 3.7+</li>
    <li>Chrome (or any Chromium-based browser)</li>
    <li>Your KeePass database file (.kdbx)</li>
    <li>OpenSSL (if regenerating certificates; optional for users using provided CA)</li>
  </ul>

  <hr />

  <h2>License</h2>
  <p>MIT .</p>
</body>
</html>
