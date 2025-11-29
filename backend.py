import threading
import os
import sys
import time
import hashlib
from flask import Flask, request, jsonify
from flask_cors import CORS
from pykeepass import PyKeePass
from urllib.parse import urlparse
from pystray import Icon, MenuItem, Menu
from werkzeug.serving import make_server
from PIL import Image
import uuid

cert_folder = os.path.join(os.path.dirname(__file__), "cert")
icon_folder = os.path.join(os.path.dirname(__file__), "icons")
crt_file = next((os.path.join(cert_folder, f) for f in os.listdir(cert_folder) if f.endswith(".crt")), None)
key_file = next((os.path.join(cert_folder, f) for f in os.listdir(cert_folder) if f.endswith(".key")), None)

app = Flask(__name__)
CORS(app)

KEEPASS_DB_PATH_MAIN = os.path.expanduser("Passwords.kdbx")
Main_DB_PATH = None
KEEPASS_PASSWORD = None
KEEPASS_KEYFILE = None
kp = None
db_lock = threading.Lock()

# File hash to detect changes
FILE_HASH = None
LAST_CHECK_TIME = 0
CHECK_INTERVAL = 1  # Check file every 1 second

SEARCH_CACHE = {}
CACHE_TTL = 10  # Cache for 10 seconds


def get_file_hash(filepath):
    """Get hash of the actual file to detect changes"""
    try:
        hasher = hashlib.md5()
        with open(filepath, 'rb') as f:
            # Read in chunks to handle large files efficiently
            for chunk in iter(lambda: f.read(8192), b''):
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception as e:
        print(f"[ERR] Failed to hash file: {e}")
        return None


def should_check_file():
    global LAST_CHECK_TIME
    now = time.time()
    if now - LAST_CHECK_TIME < CHECK_INTERVAL:
        return False
    LAST_CHECK_TIME = now
    return True


def file_has_changed():
    global FILE_HASH

    if Main_DB_PATH is None:
        return False

    if not should_check_file():
        return False

    current_hash = get_file_hash(Main_DB_PATH)

    if current_hash is None:
        return False

    if FILE_HASH is None:
        FILE_HASH = current_hash
        return False

    if current_hash != FILE_HASH:
        FILE_HASH = current_hash
        print(f"[DBG] File change detected!")
        return True

    return False


def reload_db():
    global kp, FILE_HASH

    if Main_DB_PATH is None or KEEPASS_PASSWORD is None:
        return None

    with db_lock:
        try:
            # Force reload from disk
            kp = PyKeePass(
                Main_DB_PATH,
                password=KEEPASS_PASSWORD,
                keyfile=KEEPASS_KEYFILE
            )
            FILE_HASH = get_file_hash(Main_DB_PATH)
            SEARCH_CACHE.clear()  # Clear cache on reload
            print(f"[DBG] Database reloaded at {time.strftime('%H:%M:%S')}")
            return kp
        except Exception as e:
            print(f"[ERR] Failed to reload database: {e}")
            return None


def get_db():
    if kp is None:
        return None

    # Check if file changed (rate-limited to once per second)
    if file_has_changed():
        return reload_db()

    return kp


@app.route('/unlock', methods=['POST'])
def unlock_database():
    global Main_DB_PATH, KEEPASS_PASSWORD, KEEPASS_KEYFILE, kp, FILE_HASH

    data = request.json
    db_path = os.path.expanduser(data.get('dbPath', KEEPASS_DB_PATH_MAIN))
    Main_DB_PATH = db_path
    password = data.get('password')
    keyfile = data.get('keyfile')

    if not os.path.exists(db_path):
        return jsonify({'success': False, 'error': f'Database file not found: {db_path}'}), 404

    try:
        with db_lock:
            kp = PyKeePass(db_path, password=password, keyfile=keyfile if keyfile else None)
            KEEPASS_PASSWORD = password
            KEEPASS_KEYFILE = keyfile if keyfile else None
            FILE_HASH = get_file_hash(db_path)
        return jsonify({'success': True, 'message': 'Database unlocked successfully', 'dbPath': db_path})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 401


@app.route('/lock', methods=['POST'])
def lock_database():
    global kp, KEEPASS_PASSWORD, KEEPASS_KEYFILE, FILE_HASH
    with db_lock:
        kp = None
        KEEPASS_PASSWORD = None
        KEEPASS_KEYFILE = None
        FILE_HASH = None
    SEARCH_CACHE.clear()
    return jsonify({'success': True})


@app.route('/status', methods=['GET'])
def status():
    return jsonify({'locked': kp is None})


@app.route('/search', methods=['POST'])
def search_entries():
    if kp is None:
        return jsonify({'error': 'Database locked'}), 401

    data = request.json
    url = data.get('url', '')
    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path

    # Check cache first
    cache_key = domain.lower()
    now = time.time()

    if cache_key in SEARCH_CACHE:
        cached_data, timestamp = SEARCH_CACHE[cache_key]
        if now - timestamp < CACHE_TTL:
            # Still check if file changed even with cache
            current_kp = get_db()
            if current_kp is None:
                return jsonify({'error': 'Database error'}), 500
            # If file changed, cache was already cleared, so this won't hit
            return jsonify({'success': True, 'entries': cached_data})

    # Get current DB (will reload if file changed)
    current_kp = get_db()
    if current_kp is None:
        return jsonify({'error': 'Database error'}), 500

    matching_entries = []
    domain_lower = domain.lower()

    # Search entries
    for entry in current_kp.entries:
        entry_url = entry.url or ''
        entry_title = entry.title or ''

        if domain_lower in entry_url.lower() or domain_lower in entry_title.lower():
            matching_entries.append({
                'uuid': str(entry.uuid),
                'title': entry.title,
                'username': entry.username,
                'url': entry.url,
                'notes': entry.notes
            })

    # Cache the results
    SEARCH_CACHE[cache_key] = (matching_entries, now)

    # Clean old cache entries
    if len(SEARCH_CACHE) > 100:
        oldest_keys = sorted(SEARCH_CACHE.keys(),
                             key=lambda k: SEARCH_CACHE[k][1])[:50]
        for k in oldest_keys:
            del SEARCH_CACHE[k]

    return jsonify({'success': True, 'entries': matching_entries})


@app.route('/get-credentials', methods=['POST'])
def get_credentials():
    if kp is None:
        return jsonify({'error': 'Database locked'}), 401

    # Get current DB (will reload if file changed)
    current_kp = get_db()
    if current_kp is None:
        return jsonify({'error': 'Database error'}), 500

    data = request.json
    entry_uuid = data.get('uuid')

    try:
        entry = current_kp.find_entries(uuid=uuid.UUID(entry_uuid), first=True)
        if entry:
            return jsonify({
                'success': True,
                'username': entry.username,
                'password': entry.password,
                'url': entry.url
            })
        else:
            return jsonify({'success': False, 'error': 'Entry not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/force-reload', methods=['POST'])
def force_reload():
    """Manual endpoint to force database reload"""
    if kp is None:
        return jsonify({'error': 'Database locked'}), 401

    result = reload_db()
    if result:
        return jsonify({'success': True, 'message': 'Database reloaded'})
    else:
        return jsonify({'success': False, 'error': 'Failed to reload'}), 500


class ServerThread(threading.Thread):
    def __init__(self, app):
        threading.Thread.__init__(self)
        self.srv = make_server('127.0.0.1', 5000, app, ssl_context=(crt_file, key_file))
        self.ctx = app.app_context()
        self.ctx.push()
        self.daemon = True

    def run(self):
        self.srv.serve_forever()

    def shutdown(self):
        self.srv.shutdown()


ICON = os.path.join(icon_folder, 'icon.ico')
ICON_PATH = ICON
if not os.path.exists(ICON_PATH):
    raise FileNotFoundError(f"{ICON_PATH} not found.")
icon_image = Image.open(ICON_PATH)

flask_thread = ServerThread(app)
flask_thread.start()
print("Server started")


def quit_app(icon, item):
    print("[*] Shutting down Flask server...")
    icon.stop()
    sys.exit(0)


tray_icon = Icon(
    "KeePassHTTP",
    icon_image,
    "KeePass HTTP Server",
    menu=Menu(MenuItem("Exit", quit_app))
)

tray_icon.run()
