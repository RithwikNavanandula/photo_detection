import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'test_db.sqlite')

print(f"Creating DB at: {DB_PATH}")

if os.path.exists(DB_PATH):
    print("DB already exists. Deleting...")
    os.remove(DB_PATH)

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
cursor.execute("INSERT INTO test (value) VALUES ('Persistence Check')")
conn.commit()
conn.close()

if os.path.exists(DB_PATH):
    print("DB created successfully.")
    print(f"Size: {os.path.getsize(DB_PATH)} bytes")
else:
    print("FAILED to create DB file.")
