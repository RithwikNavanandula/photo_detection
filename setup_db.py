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

DB_PATH = 'users.db'

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

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
            name TEXT NOT NULL UNIQUE,
            code TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    print("Created table: branches")
    
    # Create users table (matches server.py init_db schema)
    cursor.execute('''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            branch_id INTEGER REFERENCES branches(id),
            active INTEGER DEFAULT 1
        )
    ''')
    print("Created table: users")
    
    # Create scans table
    cursor.execute('''
        CREATE TABLE scans (
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
            synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            branch_id INTEGER,
            FOREIGN KEY (branch_id) REFERENCES branches(id)
        )
    ''')
    print("Created table: scans")
    
    # Insert default branch
    cursor.execute('''
        INSERT INTO branches (name, code) VALUES ('Main Branch', 'MAIN')
    ''')
    branch_id = cursor.lastrowid
    print(f"Created default branch: Main Branch (ID: {branch_id})")
    
    # Insert default users (matches server.py defaults)
    users = [
        ('superadmin', 'super123', 'Super Admin', 'superadmin', None),
        ('admin', 'admin123', 'Administrator', 'admin', branch_id),
        ('user1', 'user123', 'User One', 'user', branch_id),
    ]
    
    for username, password, name, role, bid in users:
        cursor.execute('''
            INSERT INTO users (username, password, name, role, branch_id, active)
            VALUES (?, ?, ?, ?, ?, 1)
        ''', (username, hash_password(password), name, role, bid))
        print(f"Created user: {username} ({role})")
    
    conn.commit()
    conn.close()
    
    print("\n" + "="*50)
    print("DATABASE SETUP COMPLETE!")
    print("="*50)
    print(f"\nDatabase file: {DB_PATH}")
    print("\nDefault login credentials:")
    print("  superadmin / super123  (all branches)")
    print("  admin / admin123       (Main Branch)")
    print("  user1 / user123        (Main Branch)")
    print("\nNow reload your web app from the Web tab.")

if __name__ == '__main__':
    setup_database()
