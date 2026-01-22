"""
Flask Backend for Label Scanner Authentication
Uses SQLite3 for user management
"""

from flask import Flask, request, jsonify, send_from_directory, session
from flask_cors import CORS
import sqlite3
import hashlib
import os
import csv
import io
import requests
from functools import wraps
from datetime import datetime
from flask import Response

app = Flask(__name__, static_folder='.')
app.secret_key = 'label-scanner-secret-key-2026'  # Fixed key for session persistence
CORS(app)

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
        if session.get('role') not in ['admin', 'superadmin']:
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
DB_PATH = os.path.join(BASE_DIR, 'users.db')

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

    # Create transfer_requests table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transfer_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER,
            batch_no TEXT,
            flavour TEXT,
            expiry_date TEXT,
            rack_no TEXT,
            shelf_no TEXT,
            requested_by INTEGER REFERENCES users(id),
            requested_by_name TEXT,
            status TEXT DEFAULT 'pending',
            notes TEXT,
            branch_id INTEGER REFERENCES branches(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        
        # Set session
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        session['branch_id'] = user['branch_id']
        session.permanent = True
        
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

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

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
    activity_query = f'''
        SELECT id, timestamp, batch_no as batch, rack_no as rack, shelf_no as shelf, movement, expiry_date 
        FROM scans{branch_where}
        {order_clause}
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
    
    # Add new scans with branch_id (avoiding duplicates)
    synced = 0
    for scan in scans:
        # Check if scan already exists (same product at same location with same movement)
        cursor.execute('''
            SELECT id FROM scans 
            WHERE batch_no = ? AND mfg_date = ? AND expiry_date = ? AND rack_no = ? AND shelf_no = ? AND movement = ?
        ''', (
            scan.get('batchNo', ''),
            scan.get('mfgDate', ''),
            scan.get('expiryDate', ''),
            scan.get('rackNo', ''),
            scan.get('shelfNo', ''),
            scan.get('movement', 'IN')
        ))
        
        if cursor.fetchone():
            continue # Skip duplicate

        # Validation for OUT scans: Check if stock exists
        if scan.get('movement') == 'OUT':
            cursor.execute('''
                SELECT movement FROM scans 
                WHERE batch_no = ? AND flavour = ? 
                AND mfg_date = ? AND expiry_date = ?
                AND rack_no = ? AND shelf_no = ?
            ''', (
                scan.get('batchNo', ''),
                scan.get('flavour', ''),
                scan.get('mfgDate', ''),
                scan.get('expiryDate', ''),
                scan.get('rackNo', ''),
                scan.get('shelfNo', '')
            ))
            
            stock_rows = cursor.fetchall()
            in_count = sum(1 for r in stock_rows if r['movement'] == 'IN')
            out_count = sum(1 for r in stock_rows if r['movement'] == 'OUT')
            
            if in_count <= out_count:
                conn.close()
                return jsonify({
                    'success': False, 
                    'error': f"Stock Error: No available stock found for Batch {scan.get('batchNo')} ({scan.get('flavour')}) at this location."
                }), 400

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
        
        # Check if this is an OUT scan matching a transfer request
        if scan.get('movement') == 'OUT':
            # Find matching submitted request
            cursor.execute('''
                SELECT id FROM transfer_requests 
                WHERE batch_no = ? AND flavour = ? AND rack_no = ? AND shelf_no = ? AND status = 'submitted'
            ''', (
                scan.get('batchNo', ''),
                scan.get('flavour', ''),
                scan.get('rackNo', ''),
                scan.get('shelfNo', '')
            ))
            
            req = cursor.fetchone()
            if req:
                # Mark as completed
                cursor.execute('UPDATE transfer_requests SET status = "completed", updated_at = CURRENT_TIMESTAMP WHERE id = ?', (req['id'],))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'synced': synced})

@app.route('/api/admin/sync', methods=['POST'])
@admin_required
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
@admin_required
def add_scan():
    """Add a new scan record manually"""
    data = request.get_json()
    
    conn = get_db()
    cursor = conn.cursor()
    
    from datetime import datetime
    timestamp = datetime.now().strftime('%d/%m/%Y, %I:%M:%S %p')
    
    cursor.execute('''
        INSERT INTO scans (timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement, synced_by, branch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
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
        cursor.execute('''
            INSERT INTO scans (timestamp, batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, movement, synced_by, branch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
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
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    
    # OCR.space API Key (Securely stored on server)
    API_KEY = 'K85403682988957'
    
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

@app.route('/branches')
def serve_branches():
    return send_from_directory('.', 'branches.html')

@app.route('/users')
def serve_users():
    return send_from_directory('.', 'users.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/pivot')
def serve_pivot():
    return send_from_directory('.', 'pivot.html')

@app.route('/api/admin/pivot', methods=['GET'])
@admin_required
def get_pivot_data():
    """Get flat scan data for pivot dashboard"""
    branch_id = request.args.get('branch_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Base query - match CSV export columns
    query = '''
        SELECT s.id, s.timestamp, s.batch_no, s.mfg_date, s.expiry_date, 
               s.flavour, s.rack_no, s.shelf_no, s.movement, s.branch_id, 
               s.synced_by, b.name as branch_name,
               tr.requested_by_name
        FROM scans s
        LEFT JOIN branches b ON s.branch_id = b.id
        LEFT JOIN transfer_requests tr ON 
            tr.batch_no = s.batch_no AND 
            tr.flavour = s.flavour AND 
            tr.rack_no = s.rack_no AND 
            tr.shelf_no = s.shelf_no AND
            s.movement = 'OUT'
    '''
    params = []
    
    if branch_id:
        query += ' WHERE s.branch_id = ?'
        params.append(branch_id)
        
    query += ' ORDER BY s.timestamp DESC'
    
    cursor.execute(query, params)
    scans = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'success': True, 'scans': scans})

# --- Transfer Request API ---

@app.route('/transfer')
def serve_transfer():
    return send_from_directory('.', 'transfer.html')

@app.route('/transfer-reports')
def serve_transfer_reports():
    return send_from_directory('.', 'transfer-reports.html')

@app.route('/api/transfer/flavors', methods=['GET'])
@login_required
def get_transfer_flavors():
    """Get list of available flavors"""
    branch_id = session.get('branch_id')
    # If admin/superadmin wants to see all, they can, but for transfer request usually it's within a branch
    # or requesting FROM a branch. Let's assume user requests items avaiable in THEIR branch (or globally?)
    # User said "request for a flavor". Usually you request something you don't have, or you request to move something.
    # Let's assume we list ALL flavors available in the system or current branch. 
    # Let's use current branch or all if params say so.
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Just get all distinct flavors for now
    cursor.execute("SELECT DISTINCT flavour FROM scans WHERE flavour IS NOT NULL AND flavour != '' ORDER BY flavour")
    flavors = [row['flavour'] for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'success': True, 'flavors': flavors})

@app.route('/api/transfer/nearest-expiry', methods=['GET'])
@login_required
def get_nearest_expiry():
    """Get nearest expiring batch for selected flavor"""
    flavor = request.args.get('flavor')
    branch_id = request.args.get('branch_id', type=int) # Optional, if we want to limit to specific branch
    
    if not flavor:
        return jsonify({'success': False, 'error': 'Flavor is required'})

    conn = get_db()
    cursor = conn.cursor()
    
    query = '''
        SELECT batch_no, expiry_date, mfg_date, rack_no, shelf_no, branch_id
        FROM scans 
        WHERE flavour = ? AND movement = 'IN' 
        AND expiry_date IS NOT NULL AND expiry_date != ''
    '''
    params = [flavor]
    
    if branch_id:
        query += ' AND branch_id = ?'
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
                    'batch_no': row['batch_no'],
                    'expiry_date': row['expiry_date'], # Keep original string
                    'expiry_dt': expiry_date, # For sorting
                    'mfg_date': row['mfg_date'],
                    'rack_no': row['rack_no'],
                    'shelf_no': row['shelf_no'],
                    'branch_id': row['branch_id']
                })
        except:
            continue
            
    if not items:
         return jsonify({'success': False, 'message': 'No valid expiry dates found'})

    # Sort by expiry date ASC
    items.sort(key=lambda x: x['expiry_dt'])
    
    # Pick the first one (nearest expiry)
    best_item = items[0]
    
    # Remove expiry_dt object before returning
    del best_item['expiry_dt']
    
    return jsonify({'success': True, 'item': best_item})

@app.route('/api/transfer/batches', methods=['GET'])
@login_required
def get_transfer_batches():
    """Get all batches for selected flavor, sorted by expiry"""
    flavor = request.args.get('flavor')
    branch_id = request.args.get('branch_id', type=int)
    
    if not flavor:
        return jsonify({'success': False, 'error': 'Flavor is required'})

    conn = get_db()
    cursor = conn.cursor()
    
    query = '''
        SELECT batch_no, expiry_date, mfg_date, rack_no, shelf_no, branch_id
        FROM scans 
        WHERE flavour = ? AND movement = 'IN' 
        AND expiry_date IS NOT NULL AND expiry_date != ''
    '''
    params = [flavor]
    
    if branch_id:
        query += ' AND branch_id = ?'
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
                'batch_no': row['batch_no'],
                'expiry_date': row['expiry_date'],
                'expiry_dt': expiry_date,
                'mfg_date': row['mfg_date'],
                'rack_no': row['rack_no'],
                'shelf_no': row['shelf_no'],
                'branch_id': row['branch_id']
            })
        except:
             continue
            
    # Sort by expiry date ASC
    items.sort(key=lambda x: x['expiry_dt'])
    
    # Cleanup helper key
    for item in items:
        del item['expiry_dt']
    
    return jsonify({'success': True, 'items': items})

@app.route('/api/transfer/request', methods=['POST'])
@login_required
def create_transfer_request():
    """Submit a new transfer request"""
    data = request.get_json()
    
    flavour = data.get('flavour')
    batch_no = data.get('batch_no')
    expiry_date = data.get('expiry_date')
    rack_no = data.get('rack_no')
    shelf_no = data.get('shelf_no')
    notes = data.get('notes', '')
    
    if not flavour or not batch_no:
        return jsonify({'success': False, 'error': 'Flavor and Batch No are required'})
        
    conn = get_db()
    cursor = conn.cursor()
    
    user_id = session.get('user_id')
    
    # Get user name
    cursor.execute('SELECT username FROM users WHERE id = ?', (user_id,))
    user_row = cursor.fetchone()
    username = user_row['username'] if user_row else 'Unknown'
    
    # Get user's branch
    cursor.execute('SELECT branch_id FROM users WHERE id = ?', (user_id,))
    branch_row = cursor.fetchone()
    branch_id = branch_row['branch_id'] if branch_row else None

    cursor.execute('''
        INSERT INTO transfer_requests 
        (flavour, batch_no, expiry_date, rack_no, shelf_no, requested_by, requested_by_name, notes, branch_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
    ''', (flavour, batch_no, expiry_date, rack_no, shelf_no, user_id, username, notes, branch_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Transfer request submitted successfully'})

@app.route('/api/transfer/requests', methods=['GET'])
@login_required
def get_transfer_requests():
    """Get all transfer requests"""
    # Filters
    status = request.args.get('status')
    
    query = 'SELECT * FROM transfer_requests'
    params = []
    
    where_clauses = []
    if status:
        where_clauses.append('status = ?')
        params.append(status)
        
    # If user is not admin, distinct logic? 
    # Plan says "when any other person opens the report should be able to show who requested it".
    # So assuming all users can see reports for transparency.
    
    if where_clauses:
        query += ' WHERE ' + ' AND '.join(where_clauses)
        
    query += ' ORDER BY created_at DESC'
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(query, params)
    requests = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({'success': True, 'requests': requests})

@app.route('/api/transfer/update-status', methods=['POST'])
@admin_required
def update_transfer_status():
    """Update status of a transfer request (Admin only)"""
    data = request.get_json()
    request_id = data.get('id')
    new_status = data.get('status')
    
    if not request_id or not new_status:
        return jsonify({'success': False, 'error': 'ID and status required'})
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('UPDATE transfer_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                   (new_status, request_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

if __name__ == '__main__':
    init_db()
    print('\n🚀 Label Scanner Server running at http://localhost:5000')
    print('   Login page: http://localhost:5000/')
    print('   Main app:   http://localhost:5000/app\n')
    app.run(host='0.0.0.0', port=5000, debug=True)
