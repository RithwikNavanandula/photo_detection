"""
Flask Backend for Label Scanner Authentication
Uses SQLite3 for user management
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import hashlib
import os
import csv
import io
from datetime import datetime
from flask import Response

app = Flask(__name__, static_folder='.')
CORS(app)

DB_PATH = 'users.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

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
    
    # Create users table with branch_id
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            branch_id INTEGER REFERENCES branches(id),
            active INTEGER DEFAULT 1
        )
    ''')
    
    # Create scans table with branch_id
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Migration: Add branch_id columns if they don't exist
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN branch_id INTEGER')
    except:
        pass
    try:
        cursor.execute('ALTER TABLE scans ADD COLUMN branch_id INTEGER')
    except:
        pass
    try:
        cursor.execute('ALTER TABLE scans ADD COLUMN synced_by TEXT')
    except:
        pass
    
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
        # Add default users with branch
        users = [
            ('superadmin', hash_password('super123'), 'Super Admin', 'superadmin', None),  # No branch - sees all
            ('admin', hash_password('admin123'), 'Administrator', 'admin', default_branch_id),
            ('user1', hash_password('user123'), 'User One', 'user', default_branch_id)
        ]
        cursor.executemany(
            'INSERT INTO users (username, password, name, role, branch_id) VALUES (?, ?, ?, ?, ?)',
            users
        )
        print('Default users created:')
        print('  superadmin / super123 (all branches)')
        print('  admin / admin123 (Main Branch)')
        print('  user1 / user123 (Main Branch)')
    
    # Upgrade existing admin to superadmin if no superadmin exists
    cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'superadmin'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("UPDATE users SET role = 'superadmin', branch_id = NULL WHERE username = 'admin'")
    
    conn.commit()
    conn.close()

# Initialize database on module load (needed for WSGI/PythonAnywhere)
init_db()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Query user with branch info
    cursor.execute('''
        SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name, b.code as branch_code
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        WHERE u.username = ? AND u.password = ?
    ''', (username, hash_password(password)))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        if user['active'] == 0:
            return jsonify({'success': False, 'error': 'Account pending admin approval'}), 401
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'name': user['name'],
                'role': user['role'],
                'branch_id': user['branch_id'],
                'branch_name': user['branch_name'] or 'All Branches',
                'branch_code': user['branch_code'] or 'ALL'
            }
        })
    else:
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401

@app.route('/api/register', methods=['POST'])
def register():
    """Register a new user"""
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'user')
    branch_id = data.get('branch_id')
    
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400
    
    if len(username) < 3:
        return jsonify({'success': False, 'error': 'Username must be at least 3 characters'}), 400
    
    if len(password) < 4:
        return jsonify({'success': False, 'error': 'Password must be at least 4 characters'}), 400
    
    if not branch_id:
        return jsonify({'success': False, 'error': 'Please select a branch'}), 400
    
    # Only allow 'user' or 'admin' roles for registration
    if role not in ['user', 'admin']:
        role = 'user'
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if username exists
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Username already taken'}), 400
    
    # Verify branch exists
    cursor.execute('SELECT id FROM branches WHERE id = ?', (branch_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'success': False, 'error': 'Invalid branch selected'}), 400
    
    # Create user as INACTIVE (pending admin approval)
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    cursor.execute('''
        INSERT INTO users (username, password, name, role, branch_id, active)
        VALUES (?, ?, ?, ?, ?, 0)
    ''', (username, password_hash, username.title(), role, branch_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Account created! Awaiting admin approval.'})

@app.route('/api/branches', methods=['GET'])
def list_branches():
    """List all branches for registration dropdown"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, code FROM branches ORDER BY name')
    branches = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'branches': branches})

@app.route('/api/admin/branches', methods=['GET', 'POST'])
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
            conn.commit()
            branch_id = cursor.lastrowid
            conn.close()
            return jsonify({'success': True, 'id': branch_id})
        except:
            conn.close()
            return jsonify({'success': False, 'error': 'Branch code already exists'}), 400
    
    # GET - list all with stats
    cursor.execute('''
        SELECT b.id, b.name, b.code, 
               (SELECT COUNT(*) FROM users WHERE branch_id = b.id) as user_count,
               (SELECT COUNT(*) FROM scans WHERE branch_id = b.id) as scan_count
        FROM branches b ORDER BY b.name
    ''')
    branches = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'branches': branches})

@app.route('/api/users', methods=['GET'])
def list_users():
    """Admin only: list all users with branch info"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id, u.username, u.name, u.role, u.active, u.branch_id, b.name as branch_name
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
    ''')
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'users': users})

@app.route('/api/admin/users/pending', methods=['GET'])
def pending_users():
    """Get pending (unverified) users"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, name, role FROM users WHERE active = 0')
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'users': users})

@app.route('/api/admin/users/approve', methods=['POST'])
def approve_user():
    """Approve a user account"""
    data = request.get_json()
    user_id = data.get('id')
    
    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET active = 1 WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/users/reject', methods=['POST'])
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

@app.route('/api/admin/dashboard', methods=['GET'])
def admin_dashboard():
    """Get dashboard data for admin (filtered by branch)"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Build WHERE clause for branch filtering
    branch_where = ''
    branch_params = ()
    if branch_id:
        branch_where = ' WHERE branch_id = ?'
        branch_params = (branch_id,)
    
    # Create scans table if not exists (for synced data)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    
    # Define all racks (1-10 plus Unassigned)
    all_rack_names = ['Rack 1', 'Rack 2', 'Rack 3', 'Rack 4', 'Rack 5', 
                      'Rack 6', 'Rack 7', 'Rack 8', 'Rack 9', 'Rack 10', 'Unassigned']
    
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
    
    # Get recent activity (last 15, filtered by branch)
    activity_query = f'''
        SELECT id, timestamp, batch_no as batch, rack_no as rack, shelf_no as shelf, movement 
        FROM scans{branch_where}
        ORDER BY id DESC 
        LIMIT 15
    '''
    cursor.execute(activity_query, branch_params)
    activity = [dict(row) for row in cursor.fetchall()]
    
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

@app.route('/api/sync', methods=['POST'])
def sync_user_scans():
    """Sync user scan data to central database (adds, doesn't replace)"""
    data = request.get_json()
    scans = data.get('scans', [])
    user = data.get('user', 'Unknown')
    branch_id = data.get('branch_id')  # Get branch from request
    
    if not scans:
        return jsonify({'success': False, 'error': 'No scans provided'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Add new scans with branch_id
    synced = 0
    for scan in scans:
        cursor.execute('''
            INSERT INTO scans (timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement, synced_by, branch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            scan.get('timestamp', ''),
            scan.get('batchNo', ''),
            scan.get('mfgDate', ''),
            scan.get('expiryDate', ''),
            scan.get('flavour', ''),
            scan.get('rackNo', ''),
            scan.get('shelfNo', ''),
            scan.get('movement', 'IN'),
            user,
            branch_id
        ))
        synced += 1
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'synced': synced})

@app.route('/api/admin/sync', methods=['POST'])
def sync_scans():
    """Sync scan data from frontend IndexedDB"""
    data = request.get_json()
    scans = data.get('scans', [])
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            batch_no TEXT,
            mfg_date TEXT,
            expiry_date TEXT,
            flavour TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            movement TEXT DEFAULT 'IN',
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Clear existing and insert new
    cursor.execute('DELETE FROM scans')
    
    for scan in scans:
        cursor.execute('''
            INSERT INTO scans (timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            scan.get('timestamp', ''),
            scan.get('batchNo', ''),
            scan.get('mfgDate', ''),
            scan.get('expiryDate', ''),
            scan.get('flavour', ''),
            scan.get('rackNo', ''),
            scan.get('shelfNo', ''),
            scan.get('movement', 'IN')
        ))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'synced': len(scans)})

@app.route('/api/admin/export', methods=['GET'])
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
def update_scan():
    """Update a scan record"""
    data = request.get_json()
    scan_id = data.get('id')
    
    if not scan_id:
        return jsonify({'success': False, 'error': 'Scan ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        UPDATE scans 
        SET batch_no = ?, rack_no = ?, shelf_no = ?, movement = ?
        WHERE id = ?
    ''', (
        data.get('batch_no', ''),
        data.get('rack_no', ''),
        data.get('shelf_no', ''),
        data.get('movement', 'IN'),
        scan_id
    ))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/scan/add', methods=['POST'])
def add_scan():
    """Add a new scan record manually"""
    data = request.get_json()
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime
    timestamp = datetime.now().strftime('%d/%m/%Y, %I:%M:%S %p')
    
    cursor.execute('''
        INSERT INTO scans (timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        timestamp,
        data.get('batch_no', ''),
        data.get('mfg_date', ''),
        data.get('expiry_date', ''),
        data.get('flavour', ''),
        data.get('rack_no', ''),
        data.get('shelf_no', ''),
        data.get('movement', 'IN')
    ))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/admin/csv/import', methods=['POST'])
def import_csv():
    """Import multiple scans from CSV data"""
    data = request.get_json()
    scans = data.get('scans', [])
    
    if not scans:
        return jsonify({'success': False, 'error': 'No scans provided'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime
    timestamp = datetime.now().strftime('%d/%m/%Y, %I:%M:%S %p')
    
    imported = 0
    for scan in scans:
        cursor.execute('''
            INSERT INTO scans (timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            timestamp,
            scan.get('batch_no', ''),
            scan.get('mfg_date', ''),
            scan.get('expiry_date', ''),
            scan.get('flavour', ''),
            scan.get('rack_no', ''),
            scan.get('shelf_no', ''),
            scan.get('movement', 'IN')
        ))
        imported += 1
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'imported': imported})

@app.route('/api/admin/scan/delete', methods=['POST'])
def delete_scan():
    """Delete a scan record"""
    data = request.get_json()
    scan_id = data.get('id')
    
    if not scan_id:
        return jsonify({'success': False, 'error': 'Scan ID required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM scans WHERE id = ?', (scan_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/admin')
def serve_admin():
    return send_from_directory('.', 'admin.html')

# Serve static files
@app.route('/')
def serve_index():
    return send_from_directory('.', 'login.html')

@app.route('/app')
def serve_app():
    return send_from_directory('.', 'index.html')

@app.route('/analytics')
def serve_analytics():
    return send_from_directory('.', 'analytics.html')

@app.route('/users')
def serve_users():
    return send_from_directory('.', 'users.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    init_db()
    print('\n🚀 Label Scanner Server running at http://localhost:5000')
    print('   Login page: http://localhost:5000/')
    print('   Main app:   http://localhost:5000/app\n')
    app.run(host='0.0.0.0', port=5000, debug=True)
