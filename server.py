"""
Flask Backend for Label Scanner Authentication
Uses SQLite3 for user management
"""

from flask import Flask, request, jsonify, send_from_directory, session
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
import libsql_experimental as libsql

import hashlib
import os
import csv
import io
import base64
import uuid
import requests
import random
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from functools import wraps
from datetime import datetime, timedelta
from flask import Response
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not installed; env vars must be set in the system/WSGI config

# Turso Hrana streams expire after ~10s idle / can drop mid-batch.
_HRANA_STREAM_MARKERS = (
    'stream not found',
    'stream has expired',
    'stream expired',
    'hrana_closed',
    'hrana:',
)

def _is_hrana_stream_error(exc):
    msg = str(exc).lower()
    return any(marker in msg for marker in _HRANA_STREAM_MARKERS)

def _turso_connect():
    turso_url = os.getenv('TURSO_DB_URL', 'libsql://scanner-rishi-n.aws-ap-south-1.turso.io')
    turso_token = os.getenv('TURSO_AUTH_TOKEN', 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODYyMTE3NzAsImlkIjoiMDE5ZmUyODQtMWMwMS03ZGU3LThhY2ItOWE1NTUwZmRjZTljIiwia2lkIjoiUkNaOVdPR2hGbXNpNHhtMmd2NF9BM1BHUVhWZk5oN2RrV1h1RXF0MDJTcyIsInJpZCI6IjVmOGI2NTE4LTQzZjEtNGU0Ni1hYzRhLTgzNjhmZDM3YWVjOCJ9.TZ-8H3py5erYBV-lsnXIupKtU_vd_S05AkUdT80FBjLwJRiMvy4gc5a8kSEjkzR0FKxEJiAvSDLsV-fNmZljCg')
    return libsql.connect(turso_url, auth_token=turso_token)

class DictRow:
    def __init__(self, tuple_row, description):
        self._tuple = tuple_row
        self._dict = {col[0]: tuple_row[idx] for idx, col in enumerate(description)}
    def __getitem__(self, key):
        if isinstance(key, int):
            return self._tuple[key]
        return self._dict[key]
    def keys(self):
        return self._dict.keys()
    def get(self, key, default=None):
        return self._dict.get(key, default)
    def __getattr__(self, name):
        try:
            return self._dict[name]
        except KeyError:
            raise AttributeError(name)
    def __iter__(self):
        return iter(self._tuple)
    def __len__(self):
        return len(self._tuple)

class CursorWrapper:
    def __init__(self, cursor, connection=None):
        self._cursor = cursor
        self._connection = connection
    def __getattr__(self, attr):
        return getattr(self._cursor, attr)
    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None: return None
        return DictRow(row, self._cursor.description)
    def fetchall(self):
        rows = self._cursor.fetchall()
        if not rows: return []
        desc = self._cursor.description
        return [DictRow(row, desc) for row in rows]
    def fetchmany(self, size=None):
        rows = self._cursor.fetchmany(size) if size else self._cursor.fetchmany()
        if not rows: return []
        desc = self._cursor.description
        return [DictRow(row, desc) for row in rows]
    def execute(self, sql, parameters=()):
        if isinstance(parameters, list):
            parameters = tuple(parameters)
        try:
            result = self._cursor.execute(sql, parameters)
            return CursorWrapper(result, self._connection)
        except ValueError as e:
            # Drop the dead stream so the next attempt uses a fresh connection.
            # Do not retry here — mid-transaction retries can orphan uncommitted rows.
            if self._connection and _is_hrana_stream_error(e):
                self._connection.reconnect()
            raise

class ConnectionWrapper:
    def __init__(self, conn=None):
        self._conn = conn if conn is not None else _turso_connect()
    def reconnect(self):
        try:
            self._conn.close()
        except Exception:
            pass
        self._conn = _turso_connect()
    def __getattr__(self, attr):
        return getattr(self._conn, attr)
    def cursor(self):
        return CursorWrapper(self._conn.cursor(), self)
    def execute(self, sql, parameters=()):
        if isinstance(parameters, list):
            parameters = tuple(parameters)
        try:
            return CursorWrapper(self._conn.execute(sql, parameters), self)
        except ValueError as e:
            if _is_hrana_stream_error(e):
                self.reconnect()
                return CursorWrapper(self._conn.execute(sql, parameters), self)
            raise
    def commit(self):
        try:
            return self._conn.commit()
        except ValueError as e:
            if _is_hrana_stream_error(e):
                self.reconnect()
            raise
    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass

app = Flask(__name__, static_folder='.')
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'label-scanner-secret-key-2026')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=os.getenv('SESSION_COOKIE_SAMESITE', 'Lax'),
    SESSION_COOKIE_SECURE=os.getenv('SESSION_COOKIE_SECURE', '').lower() in ('1', 'true', 'yes'),
    PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.getenv('SESSION_DAYS', '7'))),
)
# Trust X-Forwarded-* when behind Render / Next reverse proxy
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
CORS(app, supports_credentials=True)

# --- Gmail OTP Config (loaded from .env) ---
GMAIL_SENDER = os.getenv('GMAIL_SENDER', '')
GMAIL_APP_PASSWORD = os.getenv('GMAIL_APP_PASSWORD', '')
OCR_SPACE_API_KEY = os.getenv('OCR_SPACE_API_KEY', '')

PERMISSION_CATALOG = [
    {'code': 'view_admin_dashboard', 'label': 'View Dashboard', 'group': 'dashboard', 'description': 'Open the main dashboard.'},
    {'code': 'view_analytics', 'label': 'View Analytics', 'group': 'dashboard', 'description': 'Open analytics and expiry charts.'},
    {'code': 'view_pivot', 'label': 'View Ledger Entries', 'group': 'dashboard', 'description': 'Open the ledger / pivot view.'},
    {'code': 'view_scanner', 'label': 'Use Scanner', 'group': 'scanner', 'description': 'Open the scanner page.'},
    {'code': 'sync_scans', 'label': 'Sync Scans', 'group': 'scanner', 'description': 'Sync uploaded scans.'},
    {'code': 'manage_scans', 'label': 'Manage Scans', 'group': 'scanner', 'description': 'Add, update, import, or delete scans.'},
    {'code': 'create_transfer', 'label': 'Create Transfers', 'group': 'transfers', 'description': 'Create transfer requests.'},
    {'code': 'receive_transfer', 'label': 'Mark Received', 'group': 'transfers', 'description': 'Mark a transfer as received.'},
    {'code': 'manage_transfers', 'label': 'Manage Transfer Status', 'group': 'transfers', 'description': 'Approve or update transfer status.'},
    {'code': 'export_data', 'label': 'Export Data', 'group': 'admin', 'description': 'Export CSV data.'},
]

DEFAULT_PERMISSION_CODES = [perm['code'] for perm in PERMISSION_CATALOG]
MANDATORY_PERMISSION_CODES = {'view_scanner', 'sync_scans'}

ADMIN_ENDPOINT_PERMISSIONS = {
    'admin_dashboard': 'view_admin_dashboard',
    'get_analytics': 'view_analytics',
    'get_expiry_forecast': 'view_analytics',
    'get_expiry_items': 'view_analytics',
    'sync_scans': 'sync_scans',
    'export_data': 'export_data',
    'update_scan': 'manage_scans',
    'add_scan': 'manage_scans',
    'import_csv': 'manage_scans',
    'delete_scan': 'manage_scans',
    'get_pivot_data': 'view_pivot',
    'update_transfer_status': 'manage_transfers',
}

# --- Authentication Decorators ---

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        if not _can_access_admin_endpoint(f.__name__):
            return jsonify({'success': False, 'error': 'Admin privileges required'}), 403
        return f(*args, **kwargs)
    return decorated_function

def superadmin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        if session.get('role') != 'superadmin':
            return jsonify({'success': False, 'error': 'Superadmin privileges required'}), 403
        return f(*args, **kwargs)
    return decorated_function

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.getenv('DB_PATH') or os.path.join(BASE_DIR, 'users.db')
_db_parent = os.path.dirname(os.path.abspath(DB_PATH))
if _db_parent:
    os.makedirs(_db_parent, exist_ok=True)

# Scan photos live next to the DB so Render's persistent disk keeps them
SCAN_PHOTOS_DIR = os.getenv('SCAN_PHOTOS_DIR') or os.path.join(
    _db_parent or BASE_DIR, 'scan_photos'
)
os.makedirs(SCAN_PHOTOS_DIR, exist_ok=True)
MAX_SCAN_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MB

def get_db():
    return ConnectionWrapper(_turso_connect())

def _ensure_permission_tables(cursor):
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            description TEXT,
            permission_group TEXT DEFAULT 'general',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
            granted_by INTEGER REFERENCES users(id),
            granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_id)
        )
    ''')

    for perm in PERMISSION_CATALOG:
        cursor.execute('''
            INSERT INTO permissions (code, label, description, permission_group)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET
                label=excluded.label,
                description=excluded.description,
                permission_group=excluded.permission_group
        ''', (perm['code'], perm['label'], perm['description'], perm['group']))

    if DEFAULT_PERMISSION_CODES:
        placeholders = ','.join(['?'] * len(DEFAULT_PERMISSION_CODES))
        cursor.execute(f'DELETE FROM user_permissions WHERE permission_id NOT IN (SELECT id FROM permissions WHERE code IN ({placeholders}))', DEFAULT_PERMISSION_CODES)
        cursor.execute(f'DELETE FROM permissions WHERE code NOT IN ({placeholders})', DEFAULT_PERMISSION_CODES)

def _permission_lookup(cursor):
    cursor.execute('SELECT id, code FROM permissions')
    return {row['code']: row['id'] for row in cursor.fetchall()}

def _grant_permissions(cursor, user_id, permission_codes, granted_by=None):
    if not permission_codes:
        return
    lookup = _permission_lookup(cursor)
    for code in permission_codes:
        permission_id = lookup.get(code)
        if permission_id:
            cursor.execute('''
                INSERT OR IGNORE INTO user_permissions (user_id, permission_id, granted_by)
                VALUES (?, ?, ?)
            ''', (user_id, permission_id, granted_by))

def _ensure_default_permissions(cursor):
    """Seed default permissions for users created before the permission system existed."""
    lookup = _permission_lookup(cursor)
    if not lookup:
        return

    cursor.execute("SELECT id, role FROM users WHERE role != 'superadmin'")
    users = cursor.fetchall()
    for user in users:
        cursor.execute('SELECT COUNT(*) AS count FROM user_permissions WHERE user_id = ?', (user['id'],))
        has_any = cursor.fetchone()['count'] > 0
        if not has_any:
            for code in DEFAULT_PERMISSION_CODES:
                permission_id = lookup.get(code)
                if permission_id:
                    cursor.execute('''
                        INSERT OR IGNORE INTO user_permissions (user_id, permission_id, granted_by)
                        VALUES (?, ?, NULL)
                    ''', (user['id'], permission_id))

        for code in MANDATORY_PERMISSION_CODES:
            permission_id = lookup.get(code)
            if permission_id:
                cursor.execute('''
                    INSERT OR IGNORE INTO user_permissions (user_id, permission_id, granted_by)
                    VALUES (?, ?, NULL)
                ''', (user['id'], permission_id))

def get_user_permissions(user_id):
    if not user_id:
        return set()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT p.code
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ?
    ''', (user_id,))
    perms = {row['code'] for row in cursor.fetchall()}
    conn.close()
    return perms

def _can_access_permission(permission_code):
    if session.get('role') == 'superadmin':
        return True
    if permission_code in MANDATORY_PERMISSION_CODES:
        return True
    if not session.get('user_id'):
        return False
    return permission_code in get_user_permissions(session.get('user_id'))

def _can_access_admin_endpoint(endpoint_name):
    required = ADMIN_ENDPOINT_PERMISSIONS.get(endpoint_name)
    if not required:
        return session.get('role') == 'superadmin'
    return _can_access_permission(required)

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def _table_has_column(cursor, table_name, column_name):
    cursor.execute(f"PRAGMA table_info({table_name})")
    return any(row['name'] == column_name for row in cursor.fetchall())

def _ensure_scan_photo_column(cursor):
    """Add photo_path to scans if missing (existing DBs)."""
    if not _table_has_column(cursor, 'scans', 'photo_path'):
        cursor.execute('ALTER TABLE scans ADD COLUMN photo_path TEXT')

def _decode_scan_image(image_data):
    """Accept a data URL or raw base64 string; return image bytes or None."""
    if not image_data or not isinstance(image_data, str):
        return None
    raw = image_data.strip()
    if not raw:
        return None
    if raw.startswith('data:'):
        try:
            raw = raw.split(',', 1)[1]
        except IndexError:
            return None
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception:
        return None
    if not data or len(data) > MAX_SCAN_PHOTO_BYTES:
        return None
    return data

def _save_scan_photo(image_data):
    """Persist scan photo to disk; return stored filename or None."""
    data = _decode_scan_image(image_data)
    if not data:
        return None
    os.makedirs(SCAN_PHOTOS_DIR, exist_ok=True)
    filename = f"scan_{uuid.uuid4().hex}_{int(time.time())}.jpg"
    path = os.path.join(SCAN_PHOTOS_DIR, filename)
    try:
        with open(path, 'wb') as f:
            f.write(data)
    except OSError as e:
        print(f'[Scan Photo Save Error]: {e}')
        return None
    return filename

def _scan_photo_abs(filename):
    if not filename:
        return None
    safe = os.path.basename(str(filename))
    full = os.path.join(SCAN_PHOTOS_DIR, safe)
    if os.path.isfile(full):
        return full
    return None

def _delete_scan_photo(filename):
    full = _scan_photo_abs(filename)
    if not full:
        return
    try:
        os.remove(full)
    except OSError:
        pass

def _get_or_create_stock_id(cursor, scan_data, branch_id):
    """Return a stock row ID for the supplied item identity, creating it if needed."""
    batch_no = scan_data.get('batch_no') or scan_data.get('batchNo', '')
    mfg_date = scan_data.get('mfg_date') or scan_data.get('mfgDate', '')
    expiry_date = scan_data.get('expiry_date') or scan_data.get('expiryDate', '')
    flavour = scan_data.get('flavour', '')
    rack_no = scan_data.get('rack_no') or scan_data.get('rackNo', '')
    shelf_no = scan_data.get('shelf_no') or scan_data.get('shelfNo', '')

    cursor.execute('''
        SELECT id FROM stock
        WHERE batch_no = ? AND mfg_date = ? AND expiry_date = ? AND flavour = ?
          AND rack_no = ? AND shelf_no = ? AND branch_id IS ?
    ''', (batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, branch_id))
    row = cursor.fetchone()
    if row:
        cursor.execute('''
            UPDATE stock
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (row['id'],))
        return row['id']

    cursor.execute('''
        INSERT INTO stock (
            batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, branch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, branch_id))
    return cursor.lastrowid

def _get_or_create_production_room_id(cursor, branch_id, room_name='Production Room'):
    """Return a production room id for a branch, creating a default room if needed."""
    cursor.execute('''
        SELECT id FROM production_rooms
        WHERE branch_id = ? AND name = ?
    ''', (branch_id, room_name))
    row = cursor.fetchone()
    if row:
        return row['id']

    cursor.execute('''
        INSERT INTO production_rooms (name, branch_id)
        VALUES (?, ?)
    ''', (room_name, branch_id))
    return cursor.lastrowid

def _record_production_stock(cursor, transfer_request_id, stock_ids, production_room_id):
    """Create one production-stock row per selected stock item."""
    if not stock_ids or not production_room_id:
        return False

    for stock_id in stock_ids:
        cursor.execute('''
            INSERT OR IGNORE INTO production_stock (
                transfer_request_id, stock_id, production_room_id
            ) VALUES (?, ?, ?)
        ''', (transfer_request_id, stock_id, production_room_id))
    return True

def _ensure_transfer_request_columns(cursor):
    """Add newer transfer request columns when upgrading older SQLite databases."""
    if not _table_has_column(cursor, 'transfer_requests', 'destination_type'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN destination_type TEXT DEFAULT 'production_room'"
        )
    if not _table_has_column(cursor, 'transfer_requests', 'destination_branch_id'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN destination_branch_id INTEGER REFERENCES branches(id)"
        )
    if not _table_has_column(cursor, 'transfer_requests', 'truck_id'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN truck_id INTEGER REFERENCES trucks(id)"
        )
    if not _table_has_column(cursor, 'transfer_requests', 'receipt_status'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN receipt_status TEXT DEFAULT 'pending'"
        )
    if not _table_has_column(cursor, 'transfer_requests', 'received_at'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN received_at DATETIME"
        )
    if not _table_has_column(cursor, 'transfer_requests', 'received_by'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN received_by INTEGER REFERENCES users(id)"
        )
    if not _table_has_column(cursor, 'transfer_requests', 'received_by_name'):
        cursor.execute(
            "ALTER TABLE transfer_requests ADD COLUMN received_by_name TEXT"
        )

def _ensure_truck_table(cursor):
    """Create the truck lookup table used by transfer requests."""
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trucks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            truck_no TEXT UNIQUE NOT NULL,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

def _ensure_inventory_tables(cursor):
    """Create inventory tables used by the sync endpoints if they do not exist."""
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_no TEXT,
            mfg_date TEXT,
            expiry_date TEXT,
            flavour TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            branch_id INTEGER REFERENCES branches(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, branch_id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER REFERENCES stock(id),
            timestamp TEXT,
            batch_no TEXT,
            mfg_date TEXT,
            expiry_date TEXT,
            flavour TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            movement TEXT DEFAULT 'IN',
            synced_by TEXT,
            branch_id INTEGER,
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            photo_path TEXT
        )
    ''')
    _ensure_scan_photo_column(cursor)

def _sync_scans_to_db(conn, scans, *, user='Unknown', branch_id=None, replace=False, validate_out=True):
    """Shared scan sync implementation for both user and admin endpoints.

    Commits after each scan so Turso Hrana streams stay active and partial
    progress survives a mid-batch stream drop. Duplicate checks make retries safe.
    """
    cursor = conn.cursor()
    _ensure_scan_photo_column(cursor)

    if replace:
        cursor.execute('SELECT photo_path FROM scans WHERE photo_path IS NOT NULL')
        for row in cursor.fetchall():
            _delete_scan_photo(row['photo_path'])
        cursor.execute('DELETE FROM scans')
        cursor.execute('DELETE FROM stock')
        conn.commit()

    synced = 0
    for scan in scans:
        # Fresh cursor each iteration in case a prior reconnect replaced the stream.
        cursor = conn.cursor()
        stock_id = _get_or_create_stock_id(cursor, scan, branch_id)
        movement = scan.get('movement', 'IN')
        timestamp = scan.get('timestamp', '')

        if not replace:
            # Skip duplicate sync submissions from the device.
            cursor.execute('''
                SELECT id FROM scans
                WHERE stock_id = ? AND movement = ? AND timestamp = ?
            ''', (stock_id, movement, timestamp))
            if cursor.fetchone():
                continue

            if validate_out and movement == 'OUT':
                cursor.execute('''
                    SELECT movement FROM scans
                    WHERE stock_id = ?
                ''', (stock_id,))
                stock_rows = cursor.fetchall()
                in_count = sum(1 for r in stock_rows if r['movement'] == 'IN')
                out_count = sum(1 for r in stock_rows if r['movement'] == 'OUT')

                if in_count <= out_count:
                    return {
                        'success': False,
                        'error': (
                            f"Stock Error: No available stock found for Batch {scan.get('batchNo')} "
                            f"({scan.get('flavour')}) at this location."
                        )
                    }

        photo_path = scan.get('processed_photo_path')
        if photo_path is None:
            # Back-compat if caller did not pre-process images.
            photo_path = _save_scan_photo(
                scan.get('imageData') or scan.get('photo') or scan.get('image')
            )

        cursor.execute('''
            INSERT INTO scans (
                stock_id, timestamp, batch_no, mfg_date, expiry_date,
                flavour, rack_no, shelf_no, movement, synced_by, branch_id, photo_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            stock_id,
            timestamp,
            scan.get('batchNo', ''),
            scan.get('mfgDate', ''),
            scan.get('expiryDate', ''),
            scan.get('flavour', ''),
            scan.get('rackNo', ''),
            scan.get('shelfNo', ''),
            movement,
            user,
            branch_id,
            photo_path
        ))
        conn.commit()
        synced += 1

    return {'success': True, 'synced': synced}

def _prepare_scan_photos(scans):
    """Decode/save photos before any DB work so Hrana streams are not idled."""
    for scan in scans:
        if scan.get('processed_photo_path') is not None:
            continue
        scan['processed_photo_path'] = _save_scan_photo(
            scan.get('imageData') or scan.get('photo') or scan.get('image')
        )

def _sync_scans_with_retry(scans, *, user='Unknown', branch_id=None, replace=False, validate_out=True, attempts=3):
    """Run scan sync with fresh Turso connections on Hrana stream failures."""
    last_error = None
    for attempt in range(attempts):
        conn = get_db()
        try:
            cursor = conn.cursor()
            _ensure_inventory_tables(cursor)
            conn.commit()
            result = _sync_scans_to_db(
                conn,
                scans,
                user=user,
                branch_id=branch_id,
                replace=replace,
                validate_out=validate_out,
            )
            return result
        except ValueError as e:
            last_error = e
            if _is_hrana_stream_error(e) and attempt < attempts - 1:
                print(f'[Turso] stream lost during sync (attempt {attempt + 1}/{attempts}): {e}')
                time.sleep(0.25 * (attempt + 1))
                continue
            raise
        finally:
            conn.close()
    if last_error:
        raise last_error
    return {'success': False, 'error': 'Sync failed'}


# --- SQLite-backed OTP helpers (survive server restarts) ---

def _init_otp_table():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS otp_store (
            username TEXT PRIMARY KEY,
            otp TEXT NOT NULL,
            expires REAL NOT NULL,
            sent_at REAL NOT NULL,
            attempts INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

def otp_get(username):
    conn = get_db()
    row = conn.execute('SELECT * FROM otp_store WHERE username = ?', (username,)).fetchone()
    conn.close()
    return dict(row) if row else None

def otp_set(username, otp, expires, sent_at, attempts=0):
    conn = get_db()
    conn.execute('''
        INSERT INTO otp_store (username, otp, expires, sent_at, attempts)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
            otp=excluded.otp, expires=excluded.expires,
            sent_at=excluded.sent_at, attempts=excluded.attempts
    ''', (username, otp, expires, sent_at, attempts))
    conn.commit()
    conn.close()

def otp_increment_attempts(username):
    conn = get_db()
    conn.execute('UPDATE otp_store SET attempts = attempts + 1 WHERE username = ?', (username,))
    conn.commit()
    conn.close()

def otp_delete(username):
    conn = get_db()
    conn.execute('DELETE FROM otp_store WHERE username = ?', (username,))
    conn.commit()
    conn.close()

def init_db():
    """Initialize database with branches, users, and scans tables"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create branches table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS production_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            branch_id INTEGER REFERENCES branches(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(branch_id, name)
        )
    ''')
    
    # Create users table with branch_id and email
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            branch_id INTEGER REFERENCES branches(id),
            active INTEGER DEFAULT 1,
            email TEXT
        )
    ''')

    # Create stock table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_no TEXT,
            mfg_date TEXT,
            expiry_date TEXT,
            flavour TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            branch_id INTEGER REFERENCES branches(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, branch_id)
        )
    ''')
    
    # Create scans table with branch_id
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER REFERENCES stock(id),
            timestamp TEXT,
            batch_no TEXT,
            mfg_date TEXT,
            expiry_date TEXT,
            flavour TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            movement TEXT DEFAULT 'IN',
            synced_by TEXT,
            branch_id INTEGER REFERENCES branches(id),
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            photo_path TEXT
        )
    ''')
    _ensure_scan_photo_column(cursor)

    _ensure_truck_table(cursor)

    # Create transfer_requests table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transfer_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quantity INTEGER NOT NULL DEFAULT 1,
            requested_by INTEGER REFERENCES users(id),
            requested_by_name TEXT,
            source_branch_id INTEGER REFERENCES branches(id),
            destination_type TEXT DEFAULT 'production_room',
            destination_branch_id INTEGER REFERENCES branches(id),
            production_room_id INTEGER REFERENCES production_rooms(id),
            truck_id INTEGER REFERENCES trucks(id),
            status TEXT DEFAULT 'submitted',
            receipt_status TEXT DEFAULT 'pending',
            received_at DATETIME,
            received_by INTEGER REFERENCES users(id),
            received_by_name TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS production_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transfer_request_id INTEGER NOT NULL REFERENCES transfer_requests(id),
            stock_id INTEGER NOT NULL REFERENCES stock(id),
            production_room_id INTEGER NOT NULL REFERENCES production_rooms(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS IX_production_stock_room_created_at
        ON production_stock (production_room_id, created_at DESC)
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS IX_production_stock_transfer_request
        ON production_stock (transfer_request_id)
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS allowed_ips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL DEFAULT 'Unnamed Network',
            added_by TEXT DEFAULT 'system',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    _ensure_permission_tables(cursor)
    
    # Set temp emails for existing users who have none
    cursor.execute("SELECT id, username FROM users WHERE email IS NULL OR email = ''")
    users_no_email = cursor.fetchall()
    for u in users_no_email:
        temp_email = f"{u['username']}@temp.labelscan.local"
        cursor.execute("UPDATE users SET email = ? WHERE id = ?", (temp_email, u['id']))
    if users_no_email:
        print(f'Assigned temp emails to {len(users_no_email)} user(s) with no email.')
    
    # Create default branch if none exists
    cursor.execute('SELECT COUNT(*) FROM branches')
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO branches (name, code) VALUES ('Main Branch', 'MAIN')")
        print('Default branch created: Main Branch (MAIN)')
    
    # Get default branch ID
    cursor.execute("SELECT id FROM branches WHERE code = 'MAIN'")
    row = cursor.fetchone()
    default_branch_id = row[0] if row else 1
    
    # Check if users exist
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        users = [
            ('superadmin', hash_password('super123'), 'Super Admin', 'superadmin', None, 'superadmin@temp.labelscan.local'),
            ('user1', hash_password('user123'), 'User One', 'user', default_branch_id, 'user1@temp.labelscan.local')
        ]
        cursor.executemany(
            'INSERT INTO users (username, password, name, role, branch_id, email) VALUES (?, ?, ?, ?, ?, ?)',
            users
        )
        print('Default users created: superadmin / user1')
    
    # Upgrade any legacy admin accounts to superadmin.
    cursor.execute("UPDATE users SET role = 'superadmin', branch_id = NULL WHERE role = 'admin'")

    # Seed default permissions for existing non-superadmin users.
    _ensure_default_permissions(cursor)

    _ensure_transfer_request_columns(cursor)
    
    conn.commit()
    conn.close()

# Initialize database on module load (needed for WSGI/PythonAnywhere)
init_db()
_init_otp_table()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Query user with branch info (username match is case-insensitive)
    cursor.execute('''
        SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name, b.code as branch_code
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        WHERE LOWER(u.username) = LOWER(?) AND u.password = ?
    ''', (username, hash_password(password)))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        if user['active'] == 0:
            return jsonify({'success': False, 'error': 'Account pending superadmin approval'}), 401
        
        # Set session
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        session['branch_id'] = user['branch_id']
        session.permanent = True
        permissions = sorted(get_user_permissions(user['id']))
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'name': user['name'],
                'role': user['role'],
                'branch_id': user['branch_id'],
                'branch_name': user['branch_name'] or 'All Branches',
                'branch_code': user['branch_code'] or 'ALL',
                'permissions': permissions
            },
            'permissions': permissions
        })
    else:
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

# --- OTP / MFA Helpers ---

def send_otp_email(to_email, otp, username):
    """Send OTP via Gmail SMTP"""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Your Label Scanner Login OTP'
        msg['From'] = GMAIL_SENDER
        msg['To'] = to_email

        html = f"""
        <div style="font-family:sans-serif;max-width:480px;margin:auto;background:#1e1e2e;color:#fff;border-radius:12px;padding:32px;">
          <h2 style="color:#6c63ff;margin-bottom:8px;">📷 Label Scanner</h2>
          <p style="color:#a0a0b0;">Hi <strong>{username}</strong>, your one-time login code is:</p>
          <div style="font-size:2.5rem;font-weight:700;letter-spacing:8px;color:#6c63ff;text-align:center;margin:24px 0;background:rgba(108,99,255,0.1);border-radius:8px;padding:16px;">
            {otp}
          </div>
          <p style="color:#a0a0b0;font-size:0.85rem;">This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
        </div>
        """
        msg.attach(MIMEText(html, 'html'))

        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.ehlo()
            server.starttls()
            server.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_SENDER, to_email, msg.as_string())
        return True
    except Exception as e:
        print(f'[OTP Email Error]: {e}')
        return False


def resolve_user(identifier):
    """Look up a user by username OR email (case-insensitive). Returns the sqlite Row or None."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT username, name, role, email, active FROM users
        WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
        ''',
        (identifier, identifier)
    )
    user = cursor.fetchone()
    conn.close()
    return user

@app.route('/api/get-login-method', methods=['POST'])
def get_login_method():
    """Returns the allowed login methods and masked email for a username or email"""
    data = request.get_json()
    identifier = data.get('username', '').strip()
    if not identifier:
        return jsonify({'success': False, 'error': 'Username or email required'}), 400

    user = resolve_user(identifier)
    if not user:
        return jsonify({'success': False, 'error': 'No account found with that username or email'}), 404

    if user['active'] == 0:
        return jsonify({'success': False, 'error': 'Account pending superadmin approval'}), 401

    role = user['role']
    email = user['email'] or ''
    is_temp_email = email.endswith('@temp.labelscan.local')
    has_real_email = bool(email and '@' in email and not is_temp_email)

    # Mask email for display
    if has_real_email:
        local, domain = email.split('@', 1)
        masked = local[:2] + '***' + local[-2:] + '@' + domain if len(local) > 4 else '***@' + domain
    else:
        masked = None

    return jsonify({
        'success': True,
        'username': user['username'],  # resolved canonical username
        'role': role,
        'masked_email': masked,
        'allow_password': role == 'superadmin',
        'allow_otp': has_real_email
    })


@app.route('/api/send-otp', methods=['POST'])
def send_otp():
    """Generate and email a 6-digit OTP"""
    data = request.get_json()
    username = data.get('username', '').strip()
    if not username:
        return jsonify({'success': False, 'error': 'Username required'}), 400

    user = resolve_user(username)

    if not user:
        return jsonify({'success': False, 'error': 'No account found with that username or email'}), 404
    if user['active'] == 0:
        return jsonify({'success': False, 'error': 'Account pending superadmin approval'}), 401

    email = user['email'] or ''
    if not email or '@' not in email or email.endswith('@temp.labelscan.local'):
        return jsonify({'success': False, 'error': 'No email on file. Contact your superadmin.'}), 400

    # Use canonical username as OTP key (case-insensitive resolve above)
    canon = user['username']

    # Rate limit: 1 OTP per 60s (keyed by canonical username)
    existing = otp_get(canon)
    if existing and time.time() - existing.get('sent_at', 0) < 60:
        wait = int(60 - (time.time() - existing['sent_at']))
        return jsonify({'success': False, 'error': f'Please wait {wait}s before requesting another OTP'}), 429

    otp = str(random.randint(100000, 999999))
    now = time.time()
    otp_set(canon, otp, expires=now + 300, sent_at=now)

    sent = send_otp_email(email, otp, user['name'] or canon)
    if not sent:
        otp_delete(canon)
        return jsonify({
            'success': False,
            'error': 'Failed to send email. Try again later.',
            'allow_password_fallback': True,
            'username': canon,
        }), 500

    local, domain = email.split('@', 1)
    masked = local[:2] + '***' + local[-2:] + '@' + domain if len(local) > 4 else '***@' + domain
    return jsonify({'success': True, 'message': f'OTP sent to {masked}', 'username': canon})


@app.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    """Verify OTP and log in the user"""
    data = request.get_json()
    username = data.get('username', '').strip()
    otp_input = data.get('otp', '').strip()

    if not username or not otp_input:
        return jsonify({'success': False, 'error': 'Username and OTP required'}), 400

    resolved = resolve_user(username)
    if not resolved:
        return jsonify({'success': False, 'error': 'No account found with that username or email'}), 404
    canon = resolved['username']

    record = otp_get(canon)
    if not record:
        return jsonify({'success': False, 'error': 'No OTP found. Please request a new one.'}), 400

    if time.time() > record['expires']:
        otp_delete(canon)
        return jsonify({'success': False, 'error': 'OTP has expired. Please request a new one.'}), 400

    otp_increment_attempts(canon)
    record = otp_get(canon)  # re-fetch updated attempts
    if record['attempts'] > 5:
        otp_delete(canon)
        return jsonify({'success': False, 'error': 'Too many attempts. Please request a new OTP.'}), 400

    if otp_input != record['otp']:
        return jsonify({'success': False, 'error': f'Incorrect OTP. {5 - record["attempts"]} attempts left.'}), 401

    # OTP correct — clear store and log in
    otp_delete(canon)

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name, b.code as branch_code
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        WHERE LOWER(u.username) = LOWER(?) AND u.active = 1
    ''', (canon,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        return jsonify({'success': False, 'error': 'User not found or inactive'}), 401

    session['user_id'] = user['id']
    session['username'] = user['username']
    session['role'] = user['role']
    session['branch_id'] = user['branch_id']
    session.permanent = True
    permissions = sorted(get_user_permissions(user['id']))

    return jsonify({
        'success': True,
        'user': {
            'id': user['id'],
            'username': user['username'],
            'name': user['name'],
            'role': user['role'],
            'branch_id': user['branch_id'],
            'branch_name': user['branch_name'] or 'All Branches',
            'branch_code': user['branch_code'] or 'ALL',
            'permissions': permissions
        },
        'permissions': permissions
    })


@app.route('/api/admin/users/update-email', methods=['POST'])
@superadmin_required
def update_user_email():
    """Superadmin: update any user's email address"""
    data = request.get_json()
    user_id = data.get('id')
    new_email = data.get('email', '').strip().lower()

    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required'}), 400
    if not new_email or '@' not in new_email:
        return jsonify({'success': False, 'error': 'Valid email required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET email = ? WHERE id = ?', (new_email, user_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/admin/permissions', methods=['GET'])
@superadmin_required
def list_permissions():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, code, label, description, permission_group FROM permissions ORDER BY permission_group, label')
    permissions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'success': True, 'permissions': permissions})

@app.route('/api/admin/authorizations', methods=['GET'])
@superadmin_required
def list_authorizations():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name, b.code as branch_code
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        ORDER BY u.role DESC, u.name
    ''')
    users = [dict(row) for row in cursor.fetchall()]

    cursor.execute('SELECT id, code, label, description, permission_group FROM permissions ORDER BY permission_group, label')
    permissions = [dict(row) for row in cursor.fetchall()]

    cursor.execute('''
        SELECT up.user_id, p.code
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
    ''')
    assignments = {}
    for row in cursor.fetchall():
        assignments.setdefault(row['user_id'], []).append(row['code'])

    for user in users:
        user['permissions'] = assignments.get(user['id'], [])

    conn.close()
    return jsonify({'success': True, 'users': users, 'permissions': permissions})

@app.route('/api/admin/users/<int:user_id>/permissions', methods=['GET', 'PUT'])
@superadmin_required
def manage_user_permissions(user_id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT id, username, role FROM users WHERE id = ?', (user_id,))
    target = cursor.fetchone()
    if not target:
        conn.close()
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if request.method == 'GET':
        cursor.execute('''
            SELECT p.code
            FROM user_permissions up
            JOIN permissions p ON p.id = up.permission_id
            WHERE up.user_id = ?
            ORDER BY p.permission_group, p.label
        ''', (user_id,))
        permissions = [row['code'] for row in cursor.fetchall()]
        conn.close()
        return jsonify({'success': True, 'user_id': user_id, 'permissions': permissions})

    if target['role'] == 'superadmin':
        conn.close()
        return jsonify({'success': False, 'error': 'Superadmin permissions are implicit'}), 400

    data = request.get_json() or {}
    requested = data.get('permissions', [])
    if not isinstance(requested, list):
        conn.close()
        return jsonify({'success': False, 'error': 'permissions must be a list'}), 400

    normalized = []
    seen = set()
    for code in requested:
        code = str(code).strip()
        if code and code not in seen:
            normalized.append(code)
            seen.add(code)

    for code in MANDATORY_PERMISSION_CODES:
        if code not in seen:
            normalized.append(code)
            seen.add(code)

    cursor.execute('SELECT id, code FROM permissions')
    permission_rows = cursor.fetchall()
    permission_lookup = {row['code']: row['id'] for row in permission_rows}

    invalid = [code for code in normalized if code not in permission_lookup]
    if invalid:
        conn.close()
        return jsonify({'success': False, 'error': f'Invalid permissions: {", ".join(invalid)}'}), 400

    cursor.execute('DELETE FROM user_permissions WHERE user_id = ?', (user_id,))
    for code in normalized:
        cursor.execute('''
            INSERT INTO user_permissions (user_id, permission_id, granted_by)
            VALUES (?, ?, ?)
        ''', (user_id, permission_lookup[code], session.get('user_id')))

    conn.commit()
    conn.close()
    return jsonify({'success': True, 'permissions': normalized})

@app.route('/api/check-auth', methods=['GET'])
def check_auth():
    """Lightweight auth status endpoint for frontend guards."""
    if 'user_id' not in session:
        return jsonify({'authenticated': False})

    return jsonify({
        'authenticated': True,
        'user_id': session.get('user_id'),
        'username': session.get('username'),
        'role': session.get('role'),
        'branch_id': session.get('branch_id'),
        'permissions': sorted(get_user_permissions(session.get('user_id')))
    })

@app.route('/api/register', methods=['POST'])
def register():
    """Register a new user"""
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    email = data.get('email', '').strip().lower()
    name = (data.get('name') or '').strip() or username.title()
    branch_id = data.get('branch_id')
    
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400
    
    if not email or '@' not in email:
        return jsonify({'success': False, 'error': 'A valid email address is required'}), 400
    
    if len(username) < 3:
        return jsonify({'success': False, 'error': 'Username must be at least 3 characters'}), 400
    
    if len(password) < 4:
        return jsonify({'success': False, 'error': 'Password must be at least 4 characters'}), 400
    
    if not branch_id:
        return jsonify({'success': False, 'error': 'Please select a branch'}), 400
    
    role = 'user'
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', (username,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Username already taken'}), 400
    
    cursor.execute('SELECT id FROM branches WHERE id = ?', (branch_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Invalid branch selected'}), 400
    
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    cursor.execute('''
        INSERT INTO users (username, password, name, role, branch_id, email, active)
        VALUES (?, ?, ?, ?, ?, ?, 0)
    ''', (username, password_hash, name, role, branch_id, email))
    _grant_permissions(cursor, cursor.lastrowid, DEFAULT_PERMISSION_CODES)
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Account created! Awaiting superadmin approval.'})

@app.route('/api/branches', methods=['GET'])
def list_branches():
    """List all branches for registration dropdown"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, code FROM branches ORDER BY name')
    branches = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'branches': branches})

@app.route('/api/production-rooms', methods=['GET'])
@login_required
def list_production_rooms():
    """List production rooms, optionally filtered by branch."""
    branch_id = request.args.get('branch_id', type=int)

    conn = get_db()
    cursor = conn.cursor()

    query = '''
        SELECT pr.id, pr.name, pr.branch_id, b.name as branch_name, b.code as branch_code
        FROM production_rooms pr
        LEFT JOIN branches b ON pr.branch_id = b.id
    '''
    params = []
    if branch_id:
        query += ' WHERE pr.branch_id = ?'
        params.append(branch_id)
    query += ' ORDER BY b.name, pr.name'

    cursor.execute(query, params)
    rooms = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({'success': True, 'rooms': rooms})

@app.route('/api/admin/branches', methods=['GET', 'POST'])
@superadmin_required
def manage_branches():
    """Superadmin: Get all branches or create new branch"""
    conn = get_db()
    cursor = conn.cursor()
    
    if request.method == 'POST':
        data = request.get_json()
        name = data.get('name', '').strip()
        code = data.get('code', '').strip().upper()
        
        if not name or not code:
            return jsonify({'success': False, 'error': 'Name and code required'}), 400
        
        try:
            cursor.execute('INSERT INTO branches (name, code) VALUES (?, ?)', (name, code))
            branch_id = cursor.lastrowid
            _get_or_create_production_room_id(cursor, branch_id)
            conn.commit()
            conn.close()
            return jsonify({'success': True, 'id': branch_id})
        except:
            conn.close()
            return jsonify({'success': False, 'error': 'Branch code already exists'}), 400
    
    # GET - list all with stats
    cursor.execute('''
        SELECT b.id, b.name, b.code, 
               (SELECT COUNT(*) FROM users WHERE branch_id = b.id) as user_count,
               (SELECT COUNT(*) FROM scans WHERE branch_id = b.id) as scan_count,
               (SELECT COUNT(*) FROM production_rooms WHERE branch_id = b.id) as production_house_count
        FROM branches b ORDER BY b.name
    ''')
    branches = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'branches': branches})

@app.route('/api/admin/branches/<int:branch_id>', methods=['DELETE'])
@superadmin_required
def delete_branch(branch_id):
    """Superadmin: Delete a branch if it has no dependent records."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT id, name, code FROM branches WHERE id = ?', (branch_id,))
    branch = cursor.fetchone()
    if not branch:
        conn.close()
        return jsonify({'success': False, 'error': 'Branch not found'}), 404

    dependency_checks = [
        ('users', 'SELECT COUNT(*) AS count FROM users WHERE branch_id = ?', (branch_id,), 'users'),
        ('scans', 'SELECT COUNT(*) AS count FROM scans WHERE branch_id = ?', (branch_id,), 'scans'),
        ('stock', 'SELECT COUNT(*) AS count FROM stock WHERE branch_id = ?', (branch_id,), 'stock records'),
        ('production_rooms', 'SELECT COUNT(*) AS count FROM production_rooms WHERE branch_id = ?', (branch_id,), 'production houses'),
        (
            'transfer_requests_source',
            'SELECT COUNT(*) AS count FROM transfer_requests WHERE source_branch_id = ? OR destination_branch_id = ?',
            (branch_id, branch_id),
            'transfer requests',
        ),
    ]

    for _, query, params, label in dependency_checks:
        cursor.execute(query, params)
        count = cursor.fetchone()['count']
        if count:
            conn.close()
            return jsonify({
                'success': False,
                'error': f'Cannot delete branch while it still has {count} linked {label}'
            }), 400

    cursor.execute('DELETE FROM branches WHERE id = ?', (branch_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/admin/production-houses', methods=['GET', 'POST'])
@superadmin_required
def manage_production_houses():
    """Superadmin: List or create production houses."""
    conn = get_db()
    cursor = conn.cursor()

    if request.method == 'POST':
        data = request.get_json()
        name = data.get('name', '').strip()
        branch_id = data.get('branch_id')

        if not name or not branch_id:
            conn.close()
            return jsonify({'success': False, 'error': 'Name and branch are required'}), 400

        try:
            branch_id = int(branch_id)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({'success': False, 'error': 'Invalid branch selected'}), 400

        cursor.execute('SELECT id FROM branches WHERE id = ?', (branch_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Branch not found'}), 404

        try:
            cursor.execute(
                'INSERT INTO production_rooms (name, branch_id) VALUES (?, ?)',
                (name, branch_id)
            )
            conn.commit()
            room_id = cursor.lastrowid
            conn.close()
            return jsonify({'success': True, 'id': room_id})
        except Exception as e:
            if 'UNIQUE constraint failed' in str(e) or 'IntegrityError' in str(type(e)):
                conn.close()
                return jsonify({'success': False, 'error': 'Production house already exists for this branch'}), 400
            raise

    cursor.execute('''
        SELECT pr.id, pr.name, pr.branch_id, b.name as branch_name, b.code as branch_code,
               (SELECT COUNT(*) FROM transfer_requests WHERE production_room_id = pr.id) as transfer_count,
               (SELECT COUNT(*) FROM production_stock WHERE production_room_id = pr.id) as production_stock_count
        FROM production_rooms pr
        LEFT JOIN branches b ON pr.branch_id = b.id
        ORDER BY b.name, pr.name
    ''')
    rooms = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'production_houses': rooms})

@app.route('/api/admin/production-houses/<int:room_id>', methods=['DELETE'])
@superadmin_required
def delete_production_house(room_id):
    """Superadmin: Delete a production house if it has no dependencies."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT id, name, branch_id FROM production_rooms WHERE id = ?', (room_id,))
    room = cursor.fetchone()
    if not room:
        conn.close()
        return jsonify({'success': False, 'error': 'Production house not found'}), 404

    cursor.execute('SELECT COUNT(*) AS count FROM transfer_requests WHERE production_room_id = ?', (room_id,))
    if cursor.fetchone()['count']:
        conn.close()
        return jsonify({'success': False, 'error': 'Cannot delete a production house that is used by transfer requests'}), 400

    cursor.execute('SELECT COUNT(*) AS count FROM production_stock WHERE production_room_id = ?', (room_id,))
    if cursor.fetchone()['count']:
        conn.close()
        return jsonify({'success': False, 'error': 'Cannot delete a production house that still has production stock records'}), 400

    cursor.execute('DELETE FROM production_rooms WHERE id = ?', (room_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/users', methods=['GET'])
@admin_required
def list_users():
    """Admin only: list users with branch info (filtered by branch for admins)"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Superadmin sees all users, admin sees only their branch
    if session.get('role') == 'superadmin':
        cursor.execute('''
            SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
        ''')
    else:
        branch_id = session.get('branch_id')
        cursor.execute('''
            SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.branch_id = ?
        ''', (branch_id,))
    
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'users': users})

@app.route('/api/admin/users/pending', methods=['GET'])
@admin_required
def pending_users():
    """Get pending (unverified) users"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, name, role FROM users WHERE active = 0')
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'users': users})

@app.route('/api/admin/users/approve', methods=['POST'])
@admin_required
def approve_user():
    """Approve a user account"""
    data = request.get_json()
    user_id = data.get('id')
    
    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET active = 1 WHERE id = ?', (user_id,))
    _grant_permissions(cursor, user_id, DEFAULT_PERMISSION_CODES)
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/users/reject', methods=['POST'])
@admin_required
def reject_user():
    """Reject and delete a user account"""
    data = request.get_json()
    user_id = data.get('id')
    
    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ? AND active = 0', (user_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/users/change-password', methods=['POST'])
@admin_required
def change_user_password():
    """Change a user's password (admins can only change passwords for users in their branch)"""
    data = request.get_json()
    user_id = data.get('id')
    new_password = data.get('password')
    
    if not user_id or not new_password:
        return jsonify({'success': False, 'error': 'User ID and password required'}), 400
    
    if len(new_password) < 4:
        return jsonify({'success': False, 'error': 'Password must be at least 4 characters'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if admin has permission to change this user's password
    if session.get('role') != 'superadmin':
        cursor.execute('SELECT branch_id FROM users WHERE id = ?', (user_id,))
        target_user = cursor.fetchone()
        if not target_user or target_user['branch_id'] != session.get('branch_id'):
            conn.close()
            return jsonify({'success': False, 'error': 'You can only change passwords for users in your branch'}), 403
    
    cursor.execute('UPDATE users SET password = ? WHERE id = ?', (hash_password(new_password), user_id))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/dashboard', methods=['GET'])
@admin_required
def admin_dashboard():
    """Get dashboard data for admin (filtered by branch)"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    branch_where = ''
    branch_params = ()
    if branch_id:
        branch_where = ' WHERE branch_id = ?'
        branch_params = (branch_id,)
    
    # Create scans table if not exists (for synced data)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER REFERENCES stock(id),
            timestamp TEXT,
            batch_no TEXT,
            mfg_date TEXT,
            expiry_date TEXT,
            flavour TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            movement TEXT DEFAULT 'IN',
            branch_id INTEGER,
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    
    # Get stats (filtered by branch)
    cursor.execute(f'SELECT COUNT(*) FROM scans{branch_where}', branch_params)
    total = cursor.fetchone()[0]
    
    cursor.execute(f"SELECT COUNT(*) FROM scans{branch_where}{' AND' if branch_where else ' WHERE'} movement = 'IN'", branch_params)
    total_in = cursor.fetchone()[0]
    
    cursor.execute(f"SELECT COUNT(*) FROM scans{branch_where}{' AND' if branch_where else ' WHERE'} movement = 'OUT'", branch_params)
    total_out = cursor.fetchone()[0]
    
    # Current stock = IN - OUT (minimum 0)
    current_stock = max(0, total_in - total_out)
    
    # Get rack summary with net stock (filtered by branch)
    rack_query = f'''
        SELECT 
            CASE WHEN rack_no IS NULL OR rack_no = '' THEN 'Unassigned' ELSE rack_no END as name, 
            SUM(CASE WHEN movement = 'IN' THEN 1 ELSE 0 END) as in_count,
            SUM(CASE WHEN movement = 'OUT' THEN 1 ELSE 0 END) as out_count,
            SUM(CASE WHEN movement = 'IN' THEN 1 ELSE -1 END) as count
        FROM scans{branch_where}
        GROUP BY CASE WHEN rack_no IS NULL OR rack_no = '' THEN 'Unassigned' ELSE rack_no END
        ORDER BY name
    '''
    cursor.execute(rack_query, branch_params)
    rack_data = {row['name']: dict(row) for row in cursor.fetchall()}
    
    # Define all racks (1-10)
    all_rack_names = ['Rack 1', 'Rack 2', 'Rack 3', 'Rack 4', 'Rack 5', 
                      'Rack 6', 'Rack 7', 'Rack 8', 'Rack 9', 'Rack 10']
    
    # Build racks list with defaults for empty racks
    racks = []
    for rack_name in all_rack_names:
        if rack_name in rack_data:
            rack = rack_data[rack_name]
            rack['count'] = max(0, rack['count'])  # Ensure not negative
            racks.append(rack)
        else:
            racks.append({'name': rack_name, 'count': 0, 'in_count': 0, 'out_count': 0})
    
    # Get detailed items per rack (filtered by branch)
    items_query = f'''
        SELECT 
            id,
            CASE WHEN rack_no IS NULL OR rack_no = '' THEN 'Unassigned' ELSE rack_no END as rack,
            CASE WHEN shelf_no IS NULL OR shelf_no = '' THEN 'No Shelf' ELSE shelf_no END as shelf,
            batch_no, mfg_date, expiry_date, flavour, movement, timestamp
        FROM scans{branch_where}
        ORDER BY rack, shelf, id DESC
    '''
    cursor.execute(items_query, branch_params)
    
    # Group items by rack -> shelf
    rack_items = {}
    for row in cursor.fetchall():
        rack_name = row['rack']
        shelf_name = row['shelf']
        
        if rack_name not in rack_items:
            rack_items[rack_name] = {}
        if shelf_name not in rack_items[rack_name]:
            rack_items[rack_name][shelf_name] = []
        
        rack_items[rack_name][shelf_name].append({
            'id': row['id'],
            'batch': row['batch_no'],
            'mfg': row['mfg_date'],
            'expiry': row['expiry_date'],
            'flavour': row['flavour'],
            'movement': row['movement'],
            'timestamp': row['timestamp']
        })
    
    # Add default shelves A-E for each rack
    default_shelves = ['Shelf A', 'Shelf B', 'Shelf C', 'Shelf D', 'Shelf E']
    for rack_name in all_rack_names:
        if rack_name not in rack_items:
            rack_items[rack_name] = {}
        for shelf in default_shelves:
            if shelf not in rack_items[rack_name]:
                rack_items[rack_name][shelf] = []
    
    # Sort logic for recent activity
    sort_type = request.args.get('sort', 'newest')
    
    order_clause = 'ORDER BY id DESC'
    if sort_type == 'oldest':
        order_clause = 'ORDER BY id ASC'
    elif sort_type == 'expiry-asc':
        order_clause = "ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC"
    elif sort_type == 'expiry-desc':
        # Simple DESC for text dates might not be perfect for DD/MM/YYYY but typically works for standard ISO strings.
        # However, our date format is inconsistent (DD/MM/YYYY vs YYYY-MM-DD vs random). 
        # Standard implementation for now:
        order_clause = "ORDER BY expiry_date DESC"

    # Get recent activity (last 15, filtered by branch)
    _ensure_scan_photo_column(cursor)
    activity_query = f'''
        SELECT id, timestamp, batch_no as batch, rack_no as rack, shelf_no as shelf,
               movement, expiry_date, flavour, photo_path
        FROM scans{branch_where}
        {order_clause}
        LIMIT 15
    '''
    cursor.execute(activity_query, branch_params)
    activity = []
    for row in cursor.fetchall():
        item = dict(row)
        item['has_photo'] = bool(item.pop('photo_path', None))
        activity.append(item)
    
    conn.close()
    
    return jsonify({
        'stats': {
            'total': total,
            'in': total_in,
            'out': total_out,
            'current': current_stock
        },
        'racks': racks,
        'rack_items': rack_items,
        'activity': activity
    })

@app.route('/api/admin/analytics')
@admin_required
def get_analytics():
    """Get analytics data for charts (filtered by branch)"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Build WHERE clause for branch filtering
    branch_where = ''
    branch_params = ()
    if branch_id:
        branch_where = ' WHERE branch_id = ?'
        branch_params = (branch_id,)
    
    # Basic stats
    cursor.execute(f'SELECT COUNT(*) as total FROM scans{branch_where}', branch_params)
    total = cursor.fetchone()['total']
    
    cursor.execute(f"SELECT COUNT(*) as count FROM scans{branch_where}{' AND' if branch_where else ' WHERE'} movement = 'IN'", branch_params)
    total_in = cursor.fetchone()['count']
    
    cursor.execute(f"SELECT COUNT(*) as count FROM scans{branch_where}{' AND' if branch_where else ' WHERE'} movement = 'OUT'", branch_params)
    total_out = cursor.fetchone()['count']
    
    current_stock = max(0, total_in - total_out)
    
    # Rack distribution
    rack_query = f'''
        SELECT 
            CASE WHEN rack_no IS NULL OR rack_no = '' THEN 'Unassigned' ELSE rack_no END as name,
            SUM(CASE WHEN movement = 'IN' THEN 1 ELSE -1 END) as count
        FROM scans{branch_where}
        GROUP BY CASE WHEN rack_no IS NULL OR rack_no = '' THEN 'Unassigned' ELSE rack_no END
        ORDER BY name
    '''
    cursor.execute(rack_query, branch_params)
    racks_raw = cursor.fetchall()
    racks = [{'name': r['name'], 'count': max(0, r['count'])} for r in racks_raw]
    
    # Count active racks (with items)
    active_racks = len([r for r in racks if r['count'] > 0])
    
    # Daily activity (last 7 days)
    daily_query = f'''
        SELECT 
            DATE(synced_at) as date,
            SUM(CASE WHEN movement = 'IN' THEN 1 ELSE 0 END) as in_count,
            SUM(CASE WHEN movement = 'OUT' THEN 1 ELSE 0 END) as out_count
        FROM scans{branch_where}{' AND' if branch_where else ' WHERE'} synced_at >= DATE('now', '-7 days')
        GROUP BY DATE(synced_at)
        ORDER BY date ASC
    '''
    cursor.execute(daily_query, branch_params)
    daily_raw = cursor.fetchall()
    
    # Format daily data
    daily = [{'date': row['date'] or 'Today', 'in_count': row['in_count'], 'out_count': row['out_count']} for row in daily_raw]
    
    # If no daily data, create placeholder
    if not daily:
        daily = [{'date': 'Today', 'in_count': total_in, 'out_count': total_out}]
    
    conn.close()
    
    return jsonify({
        'stats': {
            'total': total,
            'in': total_in,
            'out': total_out,
            'current': current_stock,
            'active_racks': active_racks
        },
        'racks': racks,
        'daily': daily
    })

@app.route('/api/admin/expiry-forecast')
@admin_required
def get_expiry_forecast():
    """Get expiry forecast data - items expiring by flavor across 10 weeks"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime, timedelta
    
    today = datetime.now().date()
    
    # Get all flavors and their items with expiry dates
    branch_filter = ''
    params = []
    if branch_id:
        branch_filter = ' AND branch_id = ?'
        params.append(branch_id)
    
    # Query to get all items with expiry dates
    cursor.execute(f'''
        SELECT flavour, expiry_date, 
               SUM(CASE WHEN movement = 'IN' THEN 1 ELSE -1 END) as qty
        FROM scans
        WHERE expiry_date IS NOT NULL AND expiry_date != '' {branch_filter}
        GROUP BY flavour, expiry_date
        HAVING qty > 0
    ''', params)
    
    items = cursor.fetchall()
    conn.close()
    
    # Parse expiry dates and group by week and flavor
    flavors = set()
    week_data = {i: {} for i in range(1, 21)}  # Weeks 1-20
    
    for item in items:
        flavor = item['flavour'] or 'Unknown'
        expiry_str = item['expiry_date']
        qty = item['qty']
        
        flavors.add(flavor)
        
        # Parse date (try multiple formats including 2-digit year)
        expiry_date = None
        for fmt in ['%d/%m/%y', '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y', '%m/%d/%y']:
            try:
                expiry_date = datetime.strptime(expiry_str, fmt).date()
                break
            except:
                continue
        
        if not expiry_date:
            continue
        
        # Calculate weeks from today
        days_until_expiry = (expiry_date - today).days
        if days_until_expiry < 0:
            continue  # Already expired
        
        week_num = (days_until_expiry // 7) + 1
        if week_num > 20:
            continue  # Beyond 20 weeks
        
        # Add to week data
        if flavor not in week_data[week_num]:
            week_data[week_num][flavor] = 0
        week_data[week_num][flavor] += qty
    
    # Format response
    flavor_list = sorted(list(flavors))
    
    # Build datasets for each flavor
    datasets = []
    colors = ['#6c63ff', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16']
    
    for idx, flavor in enumerate(flavor_list):
        data = []
        for week in range(1, 21):
            data.append(week_data[week].get(flavor, 0))
        
        datasets.append({
            'label': flavor,
            'data': data,
            'backgroundColor': colors[idx % len(colors)]
        })
    
    # Calculate expiry stats
    expiring_week = sum(sum(week_data[1].values()) if week_data[1] else 0 for _ in [1])
    expiring_2weeks = sum(sum(week_data[w].values()) for w in range(1, 3) if week_data[w])
    expiring_month = sum(sum(week_data[w].values()) for w in range(1, 5) if week_data[w])  # ~4 weeks = 30 days
    
    return jsonify({
        'success': True,
        'labels': [f'Week {i}' for i in range(1, 21)],
        'datasets': datasets,
        'expiry_stats': {
            'this_week': expiring_week,
            'two_weeks': expiring_2weeks,
            'thirty_days': expiring_month
        }
    })

@app.route('/api/admin/expiry-items')
@admin_required
def get_expiry_items():
    """Get detailed items expiring in a specific week"""
    week = request.args.get('week', type=int)
    flavor = request.args.get('flavor', '')
    branch_id = request.args.get('branch_id', type=int)
    
    if not week:
        return jsonify({'success': False, 'error': 'Week is required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime, timedelta
    
    today = datetime.now().date()
    
    # Calculate date range for the week
    week_start = today + timedelta(days=(week - 1) * 7)
    week_end = today + timedelta(days=week * 7)
    
    # Get all items with expiry dates
    branch_filter = ''
    params = []
    if branch_id:
        branch_filter = ' AND branch_id = ?'
        params.append(branch_id)
    
    cursor.execute(f'''
        SELECT batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no
        FROM scans
        WHERE expiry_date IS NOT NULL AND expiry_date != '' {branch_filter}
        AND movement = 'IN'
        ORDER BY expiry_date
    ''', params)
    
    items_raw = cursor.fetchall()
    conn.close()
    
    # Filter by week and optionally by flavor
    items = []
    for item in items_raw:
        expiry_str = item['expiry_date']
        
        # Parse date
        expiry_date = None
        for fmt in ['%d/%m/%y', '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y', '%m/%d/%y']:
            try:
                expiry_date = datetime.strptime(expiry_str, fmt).date()
                break
            except:
                continue
        
        if not expiry_date:
            continue
        
        # Check if in the requested week
        days_until_expiry = (expiry_date - today).days
        if days_until_expiry < 0:
            continue
        
        item_week = (days_until_expiry // 7) + 1
        if item_week != week:
            continue
        
        # Filter by flavor if specified
        if flavor and item['flavour'] != flavor:
            continue
        
        items.append({
            'batch_no': item['batch_no'] or '-',
            'mfg_date': item['mfg_date'] or '-',
            'expiry_date': item['expiry_date'] or '-',
            'flavour': item['flavour'] or '-',
            'rack_no': item['rack_no'] or '-',
            'shelf_no': item['shelf_no'] or '-'
        })
    
    return jsonify({
        'success': True,
        'items': items,
        'week': week,
        'flavor': flavor
    })

@app.route('/api/sync', methods=['POST'])
@login_required
def sync_user_scans():
    """Sync user scan data to central database (adds, doesn't replace)"""
    if not _can_access_permission('sync_scans'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    data = request.get_json()
    scans = data.get('scans', [])
    user = data.get('user', 'Unknown')
    branch_id = data.get('branch_id')  # Get branch from request
    
    # If branch_id is None (e.g. Super Admin), default to 1 (Main Branch)
    if not branch_id:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM branches ORDER BY id LIMIT 1')
        row = cursor.fetchone()
        conn.close()
        branch_id = row[0] if row else 1
    
    if not scans:
        return jsonify({'success': False, 'error': 'No scans provided'}), 400

    # Process images before opening DB connection to prevent stream timeouts
    _prepare_scan_photos(scans)

    result = _sync_scans_with_retry(
        scans,
        user=user,
        branch_id=branch_id,
        replace=False,
        validate_out=True,
    )
    if not result['success']:
        return jsonify(result), 400

    return jsonify(result)

@app.route('/api/admin/sync', methods=['POST'])
@admin_required
def sync_scans():
    """Sync scan data from frontend IndexedDB"""
    data = request.get_json()
    scans = data.get('scans', [])

    # Process images before opening DB connection to prevent stream timeouts
    _prepare_scan_photos(scans)

    result = _sync_scans_with_retry(
        scans,
        user=data.get('user', 'Unknown'),
        branch_id=None,
        replace=True,
        validate_out=False,
    )

    return jsonify(result)

@app.route('/api/admin/export', methods=['GET'])
@admin_required
def export_data():
    """Export inventory data to CSV"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    query = '''
        SELECT s.*, b.name as branch_name 
        FROM scans s
        LEFT JOIN branches b ON s.branch_id = b.id
    '''
    params = []
    
    if branch_id:
        query += ' WHERE s.branch_id = ?'
        params.append(branch_id)
        
    query += ' ORDER BY s.timestamp DESC'
    
    cursor.execute(query, params)
    scans = cursor.fetchall()
    conn.close()
    
    # Generate CSV
    def generate():
        data = io.StringIO()
        w = csv.writer(data)
        
        # Header
        w.writerow(('Timestamp', 'Branch', 'Batch No', 'Mfg Date', 'Expiry Date', 'Flavour', 'Rack', 'Shelf', 'Movement', 'Synced By'))
        yield data.getvalue()
        data.seek(0)
        data.truncate(0)
        
        # Rows
        for s in scans:
            w.writerow((
                s['timestamp'],
                s['branch_name'] or 'Unknown',
                s['batch_no'],
                s['mfg_date'],
                s['expiry_date'],
                s['flavour'],
                s['rack_no'],
                s['shelf_no'],
                s['movement'],
                s['synced_by']
            ))
            yield data.getvalue()
            data.seek(0)
            data.truncate(0)

    # Return as streaming response
    response = Response(generate(), mimetype='text/csv')
    filename = f"inventory_report_{datetime.now().strftime('%Y%m%d')}.csv"
    response.headers.set('Content-Disposition', 'attachment', filename=filename)
    return response

@app.route('/api/admin/scan/update', methods=['POST'])
@admin_required
def update_scan():
    """Update a scan record"""
    data = request.get_json()
    scan_id = data.get('id')
    
    if not scan_id:
        return jsonify({'success': False, 'error': 'Scan ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT branch_id FROM scans WHERE id = ?
    ''', (
        scan_id,
    ))
    current = cursor.fetchone()
    branch_id = current['branch_id'] if current else None

    stock_id = _get_or_create_stock_id(cursor, data, branch_id)

    cursor.execute('''
        UPDATE scans 
        SET stock_id = ?, batch_no = ?, mfg_date = ?, expiry_date = ?, flavour = ?, rack_no = ?, shelf_no = ?, movement = ?
        WHERE id = ?
    ''', (
        stock_id,
        data.get('batch_no', ''),
        data.get('mfg_date', ''),
        data.get('expiry_date', ''),
        data.get('flavour', ''),
        data.get('rack_no', ''),
        data.get('shelf_no', ''),
        data.get('movement', 'IN'),
        scan_id
    ))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/scan/add', methods=['POST'])
@admin_required
def add_scan():
    """Add a new scan record manually"""
    data = request.get_json()
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime
    timestamp = datetime.now().strftime('%d/%m/%Y, %I:%M:%S %p')
    
    cursor.execute('''
        INSERT INTO scans (stock_id, timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement, synced_by, branch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        _get_or_create_stock_id(cursor, data, data.get('branch_id')),
        timestamp,
        data.get('batch_no', ''),
        data.get('mfg_date', ''),
        data.get('expiry_date', ''),
        data.get('flavour', ''),
        data.get('rack_no', ''),
        data.get('shelf_no', ''),
        data.get('movement', 'IN'),
        data.get('synced_by', 'Admin'),
        data.get('branch_id')
    ))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/csv/import', methods=['POST'])
@admin_required
def import_csv():
    """Import multiple scans from CSV data"""
    data = request.get_json()
    scans = data.get('scans', [])
    branch_id = data.get('branch_id')
    synced_by = data.get('synced_by', 'CSV Import')
    
    if not scans:
        return jsonify({'success': False, 'error': 'No scans provided'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime
    timestamp = datetime.now().strftime('%d/%m/%Y, %I:%M:%S %p')
    
    imported = 0
    for scan in scans:
        stock_id = _get_or_create_stock_id(cursor, scan, branch_id)
        cursor.execute('''
            INSERT INTO scans (stock_id, timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement, synced_by, branch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            stock_id,
            timestamp,
            scan.get('batch_no', ''),
            scan.get('mfg_date', ''),
            scan.get('expiry_date', ''),
            scan.get('flavour', ''),
            scan.get('rack_no', ''),
            scan.get('shelf_no', ''),
            scan.get('movement', 'IN'),
            synced_by,
            branch_id
        ))
        imported += 1
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'imported': imported})

@app.route('/api/ocr', methods=['POST'])
@login_required
def proxy_ocr():
    """Proxy OCR requests to hide API Key"""
    if not _can_access_permission('view_scanner'):
        return jsonify({'error': 'Access denied'}), 403
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    
    API_KEY = OCR_SPACE_API_KEY or os.getenv('OCR_API_KEY', '')
    if not API_KEY:
        return jsonify({'error': 'OCR is not configured (set OCR_SPACE_API_KEY)'}), 503
    
    try:
        payload = {
            'apikey': API_KEY,
            'language': 'eng',
            'OCREngine': '2',
            'scale': 'true',
            'isTable': 'false',
            'detectOrientation': 'true'
        }
        
        files = {
            'file': (file.filename, file.read(), file.content_type)
        }
        
        response = requests.post(
            'https://api.ocr.space/parse/image',
            files=files,
            data=payload,
            timeout=30
        )
        
        return jsonify(response.json())
    except Exception as e:
        print(f"OCR Proxy Error: {e}")
        return jsonify({'error': 'OCR Service Failed'}), 500

@app.route('/api/admin/scan/delete', methods=['POST'])
@admin_required
def delete_scan():
    """Delete a scan record"""
    data = request.get_json()
    scan_id = data.get('id')
    
    if not scan_id:
        return jsonify({'success': False, 'error': 'Scan ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    _ensure_scan_photo_column(cursor)
    cursor.execute('SELECT photo_path FROM scans WHERE id = ?', (scan_id,))
    row = cursor.fetchone()
    if row and row['photo_path']:
        _delete_scan_photo(row['photo_path'])
    cursor.execute('DELETE FROM scans WHERE id = ?', (scan_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/scans/<int:scan_id>/photo', methods=['GET'])
@login_required
def get_scan_photo(scan_id):
    """Serve the saved photo for a scan (if present)."""
    conn = get_db()
    cursor = conn.cursor()
    _ensure_scan_photo_column(cursor)
    cursor.execute('SELECT photo_path, branch_id FROM scans WHERE id = ?', (scan_id,))
    row = cursor.fetchone()
    conn.close()

    if not row or not row['photo_path']:
        return jsonify({'success': False, 'error': 'Photo not found'}), 404

    role = session.get('role')
    if role != 'superadmin':
        user_branch = session.get('branch_id')
        if user_branch is not None and row['branch_id'] is not None and int(row['branch_id']) != int(user_branch):
            return jsonify({'success': False, 'error': 'Access denied'}), 403

    abs_path = _scan_photo_abs(row['photo_path'])
    if not abs_path:
        return jsonify({'success': False, 'error': 'Photo file missing'}), 404

    return send_from_directory(
        SCAN_PHOTOS_DIR,
        os.path.basename(abs_path),
        mimetype='image/jpeg',
        max_age=86400,
    )

@app.route('/api/admin/pivot', methods=['GET'])
@admin_required
def get_pivot_data():
    """Get flat scan data for pivot dashboard"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    _ensure_scan_photo_column(cursor)
    
    # Base query - match CSV export columns
    query = '''
        SELECT s.id, s.timestamp, s.batch_no, s.mfg_date, s.expiry_date, 
               s.flavour, s.rack_no, s.shelf_no, s.movement, s.branch_id, 
               s.synced_by, s.photo_path, b.name as branch_name,
               tr.requested_by_name,
               tr.source_branch_id, tr.production_room_id,
               sb.name as source_branch_name,
               pr.name as production_room_name
        FROM scans s
        LEFT JOIN branches b ON s.branch_id = b.id
        LEFT JOIN production_stock ps ON ps.stock_id = s.stock_id
        LEFT JOIN transfer_requests tr ON tr.id = ps.transfer_request_id
        LEFT JOIN branches sb ON tr.source_branch_id = sb.id
        LEFT JOIN production_rooms pr ON tr.production_room_id = pr.id
    '''
    params = []
    
    if branch_id:
        query += ' WHERE s.branch_id = ?'
        params.append(branch_id)
        
    query += ' ORDER BY s.timestamp DESC'
    
    cursor.execute(query, params)
    scans = []
    for row in cursor.fetchall():
        item = dict(row)
        item['has_photo'] = bool(item.pop('photo_path', None))
        scans.append(item)
    conn.close()
    
    return jsonify({'success': True, 'scans': scans})

# --- Transfer Request API ---

@app.route('/api/transfer/flavors', methods=['GET'])
@login_required
def get_transfer_flavors():
    """Get list of available flavors"""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    branch_id = request.args.get('branch_id', type=int) or session.get('branch_id')
    
    conn = get_db()
    cursor = conn.cursor()

    query = "SELECT DISTINCT flavour FROM stock WHERE flavour IS NOT NULL AND flavour != ''"
    params = []
    if branch_id:
        query += " AND branch_id = ?"
        params.append(branch_id)
    query += " ORDER BY flavour"

    cursor.execute(query, params)
    flavors = [row['flavour'] for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'success': True, 'flavors': flavors})

@app.route('/api/transfer/nearest-expiry', methods=['GET'])
@login_required
def get_nearest_expiry():
    """Get nearest expiring batch for selected flavor"""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    flavor = request.args.get('flavor')
    branch_id = request.args.get('branch_id', type=int) # Optional, if we want to limit to specific branch
    
    if not flavor:
        return jsonify({'success': False, 'error': 'Flavor is required'})

    conn = get_db()
    cursor = conn.cursor()
    quantity = request.args.get('quantity', type=int)
    
    query = '''
        SELECT st.id as stock_id, st.batch_no, st.expiry_date, st.mfg_date, st.rack_no, st.shelf_no, st.branch_id,
               b.name as branch_name,
               (SELECT MIN(s.id) FROM scans s WHERE s.stock_id = st.id AND s.movement = 'IN') as scan_id
        FROM stock st
        LEFT JOIN branches b ON st.branch_id = b.id
        WHERE st.flavour = ?
          AND st.expiry_date IS NOT NULL AND st.expiry_date != ''
          AND EXISTS (SELECT 1 FROM scans s WHERE s.stock_id = st.id AND s.movement = 'IN')
          AND (
                (SELECT COUNT(*) FROM scans s WHERE s.stock_id = st.id AND s.movement = 'IN') >
                (SELECT COUNT(*) FROM scans s WHERE s.stock_id = st.id AND s.movement = 'OUT')
              )
    '''
    params = [flavor]
    
    if branch_id:
        query += ' AND st.branch_id = ?'
        params.append(branch_id)
        
    # We want the nearest (earliest) expiry date that is presumably 'future' or 'recent'
    # Actually just ORDER BY expiry_date ASC gives us the oldest/nearest expiry
    # We might want to filter out expired items? Maybe not, maybe we want to move them to dispose.
    # User just said "nearest expiry date batch".
    # Note: Using simple string comparison for dates YYYY-MM-DD works, but if format is DD-MM-YYYY it might fail.
    # Our data seems to be DD/MM/YYYY or similar. We should try to parse or just trust the DB sort if consistent.
    # The previous code had complex date parsing. 
    # For now, let's fetch all IN items for this flavor, parse dates in python, sort, and pick first.
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return jsonify({'success': False, 'message': 'No stock found for this flavor'})

    items = []
    from datetime import datetime
    today = datetime.now().date()
    
    for row in rows:
        expiry_str = row['expiry_date']
        try:
            # Try parsing multiple formats
            expiry_date = None
            for fmt in ['%d/%m/%y', '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y', '%m/%d/%y']:
                try:
                    expiry_date = datetime.strptime(expiry_str, fmt).date()
                    break
                except:
                    continue
            
            if expiry_date:
                items.append({
                    'scan_id': row['scan_id'],
                    'stock_id': row['stock_id'],
                    'batch_no': row['batch_no'],
                    'expiry_date': row['expiry_date'],  # Keep original string
                    'expiry_dt': expiry_date,  # For sorting
                    'mfg_date': row['mfg_date'],
                    'rack_no': row['rack_no'],
                    'shelf_no': row['shelf_no'],
                    'branch_id': row['branch_id'],
                    'branch_name': row['branch_name']
                })
        except:
            continue
            
    if not items:
         return jsonify({'success': False, 'message': 'No valid expiry dates found'})

    # Sort by expiry date ASC
    items.sort(key=lambda x: x['expiry_dt'])

    if quantity and quantity > 0:
        items = items[:quantity]
    
    # Pick the first one (nearest expiry)
    best_item = items[0]
    
    # Remove expiry_dt object before returning
    del best_item['expiry_dt']
    
    return jsonify({'success': True, 'item': best_item, 'requested_quantity': quantity or 1, 'selected_count': len(items)})

@app.route('/api/transfer/batches', methods=['GET'])
@login_required
def get_transfer_batches():
    """Get all batches for selected flavor, sorted by expiry"""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    flavor = request.args.get('flavor')
    branch_id = request.args.get('branch_id', type=int)
    quantity = request.args.get('quantity', type=int)
    
    if not flavor:
        return jsonify({'success': False, 'error': 'Flavor is required'})

    conn = get_db()
    cursor = conn.cursor()
    
    query = '''
        SELECT st.id as stock_id, st.batch_no, st.expiry_date, st.mfg_date, st.rack_no, st.shelf_no, st.branch_id,
               b.name as branch_name,
               (SELECT MIN(s.id) FROM scans s WHERE s.stock_id = st.id AND s.movement = 'IN') as scan_id
        FROM stock st
        LEFT JOIN branches b ON st.branch_id = b.id
        WHERE st.flavour = ?
          AND st.expiry_date IS NOT NULL AND st.expiry_date != ''
          AND EXISTS (SELECT 1 FROM scans s WHERE s.stock_id = st.id AND s.movement = 'IN')
          AND (
                (SELECT COUNT(*) FROM scans s WHERE s.stock_id = st.id AND s.movement = 'IN') >
                (SELECT COUNT(*) FROM scans s WHERE s.stock_id = st.id AND s.movement = 'OUT')
              )
    '''
    params = [flavor]
    
    if branch_id:
        query += ' AND st.branch_id = ?'
        params.append(branch_id)
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return jsonify({'success': False, 'items': []})

    items = []
    from datetime import datetime
    
    for row in rows:
        expiry_str = row['expiry_date']
        try:
            # Try parsing multiple formats
            expiry_date = None
            for fmt in ['%d/%m/%y', '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y', '%m/%d/%y']:
                try:
                    expiry_date = datetime.strptime(expiry_str, fmt).date()
                    break
                except:
                    continue
            
            # If date parse failed, use a far future or past date? Or just exclude?
            # Let's include it but sort it last if unknown
            if not expiry_date:
                 expiry_date = datetime.max.date()

            items.append({
                'scan_id': row['scan_id'],
                'stock_id': row['stock_id'],
                'batch_no': row['batch_no'],
                'expiry_date': row['expiry_date'],
                'expiry_dt': expiry_date,
                'mfg_date': row['mfg_date'],
                'rack_no': row['rack_no'],
                'shelf_no': row['shelf_no'],
                'branch_id': row['branch_id'],
                'branch_name': row['branch_name']
            })
        except:
             continue
            
    # Sort by expiry date ASC
    items.sort(key=lambda x: x['expiry_dt'])

    if quantity and quantity > 0:
        items = items[:quantity]
    
    # Cleanup helper key
    for item in items:
        del item['expiry_dt']
    
    return jsonify({'success': True, 'items': items, 'requested_quantity': quantity or 1, 'selected_count': len(items)})

@app.route('/api/transfer/request', methods=['POST'])
@login_required
def create_transfer_request():
    """Submit a new transfer request"""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    data = request.get_json()
    
    quantity = int(data.get('quantity', 1))
    stock_ids = data.get('stock_ids', [])
    source_branch_id = data.get('source_branch_id')
    destination_type = data.get('destination_type', 'production_room')
    destination_branch_id = data.get('destination_branch_id')
    production_room_id = data.get('production_room_id')
    truck_id = data.get('truck_id')
    notes = data.get('notes', '')
    
    if quantity < 1:
        return jsonify({'success': False, 'error': 'quantity is required'}), 400
    if not isinstance(stock_ids, list) or not stock_ids:
        return jsonify({'success': False, 'error': 'stock_ids and source_branch_id are required'}), 400
    if not source_branch_id:
        return jsonify({'success': False, 'error': 'source_branch_id is required'}), 400
    try:
        source_branch_id = int(source_branch_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'source_branch_id must be a valid branch ID'}), 400
    if quantity != len(stock_ids):
        return jsonify({'success': False, 'error': 'quantity must match the number of selected stock items'}), 400
    if destination_type not in ('production_room', 'branch'):
        return jsonify({'success': False, 'error': 'Invalid destination type'}), 400
        
    conn = get_db()
    cursor = conn.cursor()

    if truck_id not in (None, '', 'null'):
        try:
            truck_id = int(truck_id)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({'success': False, 'error': 'truck_id must be a valid truck ID'}), 400
        cursor.execute('SELECT id FROM trucks WHERE id = ?', (truck_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Invalid truck selected'}), 400
    else:
        truck_id = None

    placeholders = ','.join(['?'] * len(stock_ids))
    cursor.execute(f'''
        SELECT id, branch_id FROM stock
        WHERE id IN ({placeholders})
    ''', stock_ids)
    selected_stocks = cursor.fetchall()
    if len(selected_stocks) != len(stock_ids):
        conn.close()
        return jsonify({'success': False, 'error': 'One or more stock items are invalid'}), 400

    if any(int(row['branch_id']) != source_branch_id for row in selected_stocks):
        conn.close()
        return jsonify({'success': False, 'error': 'Selected stock items must belong to the same branch'}), 400

    if destination_type == 'production_room':
        if not production_room_id:
            conn.close()
            return jsonify({'success': False, 'error': 'production_room_id is required'}), 400

        cursor.execute('''
            SELECT pr.id, pr.branch_id, pr.name, b.name as branch_name
            FROM production_rooms pr
            LEFT JOIN branches b ON pr.branch_id = b.id
            WHERE pr.id = ?
        ''', (production_room_id,))
        room = cursor.fetchone()
        if not room:
            conn.close()
            return jsonify({'success': False, 'error': 'Invalid production room selected'}), 400

        if source_branch_id != int(room['branch_id']):
            conn.close()
            return jsonify({'success': False, 'error': 'Production room must belong to the same branch as the stock'}), 400

        destination_branch_id = int(room['branch_id'])
    else:
        if not destination_branch_id:
            conn.close()
            return jsonify({'success': False, 'error': 'destination_branch_id is required'}), 400
        try:
            destination_branch_id = int(destination_branch_id)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({'success': False, 'error': 'destination_branch_id must be a valid branch ID'}), 400
        if destination_branch_id == source_branch_id:
            conn.close()
            return jsonify({'success': False, 'error': 'Destination branch must be different from the source branch'}), 400

        cursor.execute('SELECT id FROM branches WHERE id = ?', (destination_branch_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Invalid destination branch selected'}), 400

        production_room_id = _get_or_create_production_room_id(cursor, destination_branch_id)
    
    user_id = session.get('user_id')
    
    # Get user name
    cursor.execute('SELECT username FROM users WHERE id = ?', (user_id,))
    user_row = cursor.fetchone()
    username = user_row['username'] if user_row else 'Unknown'

    cursor.execute('''
        INSERT INTO transfer_requests 
        (quantity, requested_by, requested_by_name, source_branch_id, destination_type, destination_branch_id, production_room_id, truck_id, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
    ''', (quantity, user_id, username, source_branch_id, destination_type, destination_branch_id, production_room_id, truck_id, notes))
    transfer_request_id = cursor.lastrowid

    _record_production_stock(cursor, transfer_request_id, stock_ids, production_room_id)
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Transfer request submitted successfully'})

@app.route('/api/trucks', methods=['GET'])
@login_required
def get_trucks():
    """Get the truck lookup list for optional transfer assignment."""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, truck_no, note, created_at
        FROM trucks
        ORDER BY truck_no ASC, id ASC
    ''')
    trucks = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'success': True, 'trucks': trucks})

@app.route('/api/trucks', methods=['POST'])
@login_required
def add_truck():
    """Add a truck to the lookup table."""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json() or {}
    truck_no = str(data.get('truck_no', '')).strip()
    note = str(data.get('note', '')).strip()

    if not truck_no:
        return jsonify({'success': False, 'error': 'Truck number is required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM trucks WHERE LOWER(truck_no) = LOWER(?)', (truck_no,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Truck number already exists'}), 400

    cursor.execute('INSERT INTO trucks (truck_no, note) VALUES (?, ?)', (truck_no, note or None))
    truck_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'truck': {
            'id': truck_id,
            'truck_no': truck_no,
            'note': note,
        }
    })

@app.route('/api/trucks/<int:truck_id>', methods=['PUT', 'DELETE'])
@login_required
def manage_truck(truck_id):
    """Update or delete a truck entry."""
    if not _can_access_permission('create_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, truck_no FROM trucks WHERE id = ?', (truck_id,))
    truck = cursor.fetchone()
    if not truck:
        conn.close()
        return jsonify({'success': False, 'error': 'Truck not found'}), 404

    if request.method == 'DELETE':
        cursor.execute('SELECT COUNT(*) AS count FROM transfer_requests WHERE truck_id = ?', (truck_id,))
        if cursor.fetchone()['count']:
            conn.close()
            return jsonify({'success': False, 'error': 'This truck is used in transfer requests and cannot be deleted'}), 400

        cursor.execute('DELETE FROM trucks WHERE id = ?', (truck_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    data = request.get_json() or {}
    truck_no = str(data.get('truck_no', '')).strip()
    note = str(data.get('note', '')).strip()

    if not truck_no:
        conn.close()
        return jsonify({'success': False, 'error': 'Truck number is required'}), 400

    cursor.execute('SELECT id FROM trucks WHERE LOWER(truck_no) = LOWER(?) AND id != ?', (truck_no, truck_id))
    if cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Truck number already exists'}), 400

    cursor.execute('UPDATE trucks SET truck_no = ?, note = ? WHERE id = ?', (truck_no, note or None, truck_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'truck': {'id': truck_id, 'truck_no': truck_no, 'note': note}})

@app.route('/api/transfer/requests', methods=['GET'])
@login_required
def get_transfer_requests():
    """Get all transfer requests (branch-filtered for non-superadmin users)"""
    if not _can_access_permission('manage_transfers'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    
    status = request.args.get('status')
    role = session.get('role')
    current_branch_id = session.get('branch_id')
    
    query = '''
        SELECT tr.id, tr.quantity, tr.requested_by, tr.requested_by_name,
               tr.source_branch_id, sb.name as source_branch_name,
               tr.destination_type, tr.destination_branch_id, db.name as destination_branch_name,
               tr.production_room_id, pr.name as production_room_name,
               pr.branch_id as production_room_branch_id,
               pb.name as production_branch_name,
               tr.truck_id, tk.truck_no, tk.note as truck_note,
               tr.status, tr.notes, tr.created_at, tr.updated_at,
               COUNT(ps.id) as production_stock_count
        FROM transfer_requests tr
        LEFT JOIN branches sb ON tr.source_branch_id = sb.id
        LEFT JOIN branches db ON tr.destination_branch_id = db.id
        LEFT JOIN production_rooms pr ON tr.production_room_id = pr.id
        LEFT JOIN branches pb ON pr.branch_id = pb.id
        LEFT JOIN trucks tk ON tr.truck_id = tk.id
        LEFT JOIN production_stock ps ON ps.transfer_request_id = tr.id
    '''
    params = []
    where_clauses = []
    
    # Non-superadmin users only see transfers from their branch
    if role != 'superadmin':
        where_clauses.append('(tr.source_branch_id = ? OR tr.destination_branch_id = ? OR pb.id = ?)')
        params.extend([current_branch_id, current_branch_id, current_branch_id])
    
    if status:
        if status == 'pending':
            where_clauses.append("tr.status IN ('submitted', 'pending')")
        else:
            where_clauses.append('tr.status = ?')
            params.append(status)
    
    if where_clauses:
        query += ' WHERE ' + ' AND '.join(where_clauses)
    query += ' GROUP BY tr.id ORDER BY tr.created_at DESC'
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(query, params)
    requests = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'success': True, 'requests': requests})

@app.route('/api/transfer/receipts', methods=['GET'])
@login_required
def get_transfer_receipts():
    """List incoming branch transfers for the current branch or a selected branch."""
    if not _can_access_permission('receive_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    status = request.args.get('status')
    branch_id = request.args.get('branch_id', type=int)
    role = session.get('role')
    current_branch_id = session.get('branch_id')

    if branch_id is None and role != 'superadmin':
        branch_id = current_branch_id

    if role != 'superadmin' and branch_id != current_branch_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    conn = get_db()
    cursor = conn.cursor()

    query = '''
        SELECT tr.id, tr.quantity, tr.requested_by, tr.requested_by_name,
               tr.source_branch_id, sb.name as source_branch_name, sb.code as source_branch_code,
               tr.destination_branch_id, db.name as destination_branch_name, db.code as destination_branch_code,
               tr.truck_id, tk.truck_no, tk.note as truck_note,
               tr.status, tr.receipt_status, tr.received_at, tr.received_by_name, tr.notes, tr.created_at, tr.updated_at,
               COUNT(ps.id) as production_stock_count
        FROM transfer_requests tr
        LEFT JOIN branches sb ON tr.source_branch_id = sb.id
        LEFT JOIN branches db ON tr.destination_branch_id = db.id
        LEFT JOIN trucks tk ON tr.truck_id = tk.id
        LEFT JOIN production_stock ps ON ps.transfer_request_id = tr.id
        WHERE tr.destination_type = 'branch'
    '''
    params = []
    if branch_id:
        query += ' AND tr.destination_branch_id = ?'
        params.append(branch_id)
    if status:
        query += ' AND tr.status = ?'
        params.append(status)

    query += ' GROUP BY tr.id ORDER BY tr.created_at DESC'

    cursor.execute(query, params)
    receipts = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({'success': True, 'receipts': receipts})

@app.route('/api/transfer/receipts/<int:request_id>', methods=['GET'])
@login_required
def get_transfer_receipt_detail(request_id):
    """Get the full detail for a single transfer receipt."""
    if not _can_access_permission('receive_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    role = session.get('role')
    current_branch_id = session.get('branch_id')

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT tr.id, tr.quantity, tr.requested_by, tr.requested_by_name,
               tr.source_branch_id, sb.name as source_branch_name, sb.code as source_branch_code,
               tr.destination_type, tr.destination_branch_id, db.name as destination_branch_name, db.code as destination_branch_code,
               tr.production_room_id, pr.name as production_room_name,
               tr.truck_id, tk.truck_no, tk.note as truck_note,
               tr.status, tr.receipt_status, tr.received_at, tr.received_by_name, tr.notes, tr.created_at, tr.updated_at
        FROM transfer_requests tr
        LEFT JOIN branches sb ON tr.source_branch_id = sb.id
        LEFT JOIN branches db ON tr.destination_branch_id = db.id
        LEFT JOIN production_rooms pr ON tr.production_room_id = pr.id
        LEFT JOIN trucks tk ON tr.truck_id = tk.id
        WHERE tr.id = ?
    ''', (request_id,))
    receipt = cursor.fetchone()

    if not receipt:
        conn.close()
        return jsonify({'success': False, 'error': 'Transfer receipt not found'}), 404

    receipt = dict(receipt)
    if role != 'superadmin' and receipt.get('destination_branch_id') != current_branch_id:
        conn.close()
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    cursor.execute('''
        SELECT ps.id as production_stock_id, ps.created_at as selected_at,
               s.id as stock_id, s.batch_no, s.mfg_date, s.expiry_date, s.flavour,
               s.rack_no, s.shelf_no, s.branch_id, b.name as branch_name, b.code as branch_code
        FROM production_stock ps
        LEFT JOIN stock s ON ps.stock_id = s.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE ps.transfer_request_id = ?
        ORDER BY ps.created_at ASC, ps.id ASC
    ''', (request_id,))
    stock_items = [dict(row) for row in cursor.fetchall()]
    conn.close()

    receipt['stock_items'] = stock_items
    receipt['stock_count'] = len(stock_items)
    return jsonify({'success': True, 'receipt': receipt})

@app.route('/api/transfer/receipts/<int:request_id>/mark-received', methods=['POST'])
@login_required
def mark_transfer_received(request_id):
    """Mark a branch transfer as received by the current user."""
    if not _can_access_permission('receive_transfer'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    role = session.get('role')
    current_branch_id = session.get('branch_id')
    user_id = session.get('user_id')
    username = session.get('username') or 'Unknown'

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, destination_type, destination_branch_id, receipt_status
        FROM transfer_requests
        WHERE id = ?
    ''', (request_id,))
    transfer = cursor.fetchone()
    if not transfer:
        conn.close()
        return jsonify({'success': False, 'error': 'Transfer receipt not found'}), 404

    if transfer['destination_type'] != 'branch':
        conn.close()
        return jsonify({'success': False, 'error': 'Only branch transfers can be marked as received'}), 400

    if role != 'superadmin' and transfer['destination_branch_id'] != current_branch_id:
        conn.close()
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    if (transfer['receipt_status'] or 'pending').lower() == 'received':
        conn.close()
        return jsonify({'success': False, 'error': 'This receipt has already been marked as received'}), 400

    cursor.execute('''
        UPDATE transfer_requests
        SET receipt_status = 'received',
            received_at = CURRENT_TIMESTAMP,
            received_by = ?,
            received_by_name = ?,
            status = 'completed',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ''', (user_id, username, request_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/transfer/update-status', methods=['POST'])
@admin_required
def update_transfer_status():
    """Update status of a transfer request (Admin only)"""
    if not _can_access_permission('manage_transfers'):
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    data = request.get_json()
    request_id = data.get('id')
    new_status = data.get('status')
    
    if not request_id or not new_status:
        return jsonify({'success': False, 'error': 'ID and status required'})
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM transfer_requests WHERE id = ?', (request_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Transfer request not found'}), 404

    cursor.execute('UPDATE transfer_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                   (new_status, request_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

if __name__ == '__main__':
    init_db()
    print('\nLabel Scanner API running at http://localhost:5000')
    print('  UI: cd web && npm run dev (proxies /api to this server)\n')
    app.run(host='0.0.0.0', port=5000, debug=True)
