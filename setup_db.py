#!/usr/bin/env python3
"""
Database Setup Script for Label Scanner
Run this on PythonAnywhere to create a fresh database.

Usage:
    cd ~/photo_detection
    python3 setup_db.py
"""

import sqlite3
import hashlib
import os

DB_PATH = os.getenv('DB_PATH', 'users.db')

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

PERMISSION_CATALOG = [
    ('view_admin_dashboard', 'View Dashboard', 'Open the main dashboard.', 'dashboard'),
    ('view_analytics', 'View Analytics', 'Open analytics and expiry charts.', 'dashboard'),
    ('view_pivot', 'View Ledger Entries', 'Open the ledger / pivot view.', 'dashboard'),
    ('view_scanner', 'Use Scanner', 'Open the scanner page.', 'scanner'),
    ('sync_scans', 'Sync Scans', 'Sync uploaded scans.', 'scanner'),
    ('manage_scans', 'Manage Scans', 'Add, update, import, or delete scans.', 'scanner'),
    ('create_transfer', 'Create Transfers', 'Create transfer requests.', 'transfers'),
    ('receive_transfer', 'Mark Received', 'Mark a transfer as received.', 'transfers'),
    ('manage_transfers', 'Manage Transfer Status', 'Approve or update transfer status.', 'transfers'),
    ('export_data', 'Export Data', 'Export CSV data.', 'admin'),
]

DEFAULT_PERMISSION_CODES = [code for code, *_ in PERMISSION_CATALOG]
MANDATORY_PERMISSION_CODES = {'view_scanner', 'sync_scans'}

def ensure_permission_tables(cursor):
    cursor.execute('''
        CREATE TABLE permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            description TEXT,
            permission_group TEXT DEFAULT 'general',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
            granted_by INTEGER REFERENCES users(id),
            granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_id)
        )
    ''')
    for code, label, description, group in PERMISSION_CATALOG:
        cursor.execute('''
            INSERT INTO permissions (code, label, description, permission_group)
            VALUES (?, ?, ?, ?)
        ''', (code, label, description, group))

def grant_default_permissions(cursor, user_id):
    cursor.execute('SELECT id, code FROM permissions')
    lookup = {row[1]: row[0] for row in cursor.fetchall()}
    for code in DEFAULT_PERMISSION_CODES:
        permission_id = lookup.get(code)
        if permission_id:
            cursor.execute('''
                INSERT OR IGNORE INTO user_permissions (user_id, permission_id, granted_by)
                VALUES (?, ?, NULL)
            ''', (user_id, permission_id))

def setup_database():
    # Delete old database if exists
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Deleted old database: {DB_PATH}")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create branches table
    cursor.execute('''
        CREATE TABLE branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    print("Created table: branches")

    # Create production rooms table
    cursor.execute('''
        CREATE TABLE production_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            branch_id INTEGER REFERENCES branches(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(branch_id, name)
        )
    ''')
    print("Created table: production_rooms")
    
    # Create users table (matches server.py init_db schema)
    cursor.execute('''
        CREATE TABLE users (
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
    print("Created table: users")

    # Create permissions tables
    ensure_permission_tables(cursor)
    print("Created tables: permissions, user_permissions")

    # Create stock table
    cursor.execute('''
        CREATE TABLE stock (
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
    print("Created table: stock")
    
    # Create scans table
    cursor.execute('''
        CREATE TABLE scans (
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
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    print("Created table: scans")

    # Create OTP store table (persistent MFA codes)
    cursor.execute('''
        CREATE TABLE otp_store (
            username TEXT PRIMARY KEY,
            otp TEXT NOT NULL,
            expires REAL NOT NULL,
            sent_at REAL NOT NULL,
            attempts INTEGER DEFAULT 0
        )
    ''')
    print("Created table: otp_store")

    # Create transfer requests table
    cursor.execute('''
        CREATE TABLE transfer_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quantity INTEGER NOT NULL DEFAULT 1,
            requested_by INTEGER REFERENCES users(id),
            requested_by_name TEXT,
            source_branch_id INTEGER REFERENCES branches(id),
            destination_type TEXT DEFAULT 'production_room',
            destination_branch_id INTEGER REFERENCES branches(id),
            production_room_id INTEGER REFERENCES production_rooms(id),
            status TEXT DEFAULT 'submitted',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    print("Created table: transfer_requests")

    # Create production stock table
    cursor.execute('''
        CREATE TABLE production_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transfer_request_id INTEGER NOT NULL REFERENCES transfer_requests(id),
            stock_id INTEGER NOT NULL REFERENCES stock(id),
            production_room_id INTEGER NOT NULL REFERENCES production_rooms(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE INDEX IX_production_stock_room_created_at
        ON production_stock (production_room_id, created_at DESC)
    ''')
    cursor.execute('''
        CREATE INDEX IX_production_stock_transfer_request
        ON production_stock (transfer_request_id)
    ''')
    print("Created table: production_stock")

    # Create allowed IPs table
    cursor.execute('''
        CREATE TABLE allowed_ips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL DEFAULT 'Unnamed Network',
            added_by TEXT DEFAULT 'system',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    print("Created table: allowed_ips")
    
    # Insert default branch
    cursor.execute('''
        INSERT INTO branches (name, code) VALUES ('Main Branch', 'MAIN')
    ''')
    branch_id = cursor.lastrowid
    print(f"Created default branch: Main Branch (ID: {branch_id})")
    cursor.execute('''
        INSERT INTO production_rooms (name, branch_id) VALUES ('Production Room', ?)
    ''', (branch_id,))
    print("Created default production room: Production Room")
    
    # Insert default users (matches server.py defaults)
    users = [
        ('superadmin', 'super123', 'Super Admin', 'superadmin', None),
        ('user1', 'user123', 'User One', 'user', branch_id),
    ]
    
    for username, password, name, role, bid in users:
        email = f"{username}@temp.labelscan.local"
        cursor.execute('''
            INSERT INTO users (username, password, name, role, branch_id, active, email)
            VALUES (?, ?, ?, ?, ?, 1, ?)
        ''', (username, hash_password(password), name, role, bid, email))
        print(f"Created user: {username} ({role})")

        if role != 'superadmin':
            grant_default_permissions(cursor, cursor.lastrowid)
    
    conn.commit()
    conn.close()
    
    print("\n" + "="*50)
    print("DATABASE SETUP COMPLETE!")
    print("="*50)
    print(f"\nDatabase file: {DB_PATH}")
    print("\nDefault login credentials:")
    print("  superadmin / super123  (all branches)")
    print("  user1 / user123        (Main Branch)")
    print("\nNow reload your web app from the Web tab.")

if __name__ == '__main__':
    setup_database()
