# SQLite to SQL Server 2019 Migration Document

## Purpose

This document defines the exact migration scope for moving this project from SQLite to SQL Server 2019.

This is written for the current codebase in `/home/rishi/scanner/photo_detection` as of August 5, 2026.

## Decision

The correct migration strategy for this repository is:

- keep the existing Flask + raw SQL architecture
- replace `sqlite3` with `pyodbc`
- create a fresh SQL Server 2019 schema
- do not migrate existing SQLite data
- do not introduce SQLAlchemy in the same step

This is a medium-sized migration.

## Assumptions

- Existing SQLite data is not important.
- A SQL Server 2019 instance already exists or will be available.
- The backend will continue to be the Flask app in [server.py](/home/rishi/scanner/photo_detection/server.py).
- The HTML/JS frontend does not need structural DB changes.
- Only the backend DB layer and DB-related helper scripts need changes.

## Current Database Shape

### Database-related files

- [server.py](/home/rishi/scanner/photo_detection/server.py)
- [setup_db.py](/home/rishi/scanner/photo_detection/setup_db.py)
- [db_test.py](/home/rishi/scanner/photo_detection/db_test.py)
- [requirements.txt](/home/rishi/scanner/photo_detection/requirements.txt)

### Current tables

- `branches`
- `users`
- `stock`
- `production_rooms`
- `scans`
- `otp_store`
- `allowed_ips`
- `transfer_requests`
- `production_stock`

### Current backend architecture

- raw SQL only
- no ORM
- no SQLAlchemy
- no Alembic
- one central DB connection helper in [server.py](/home/rishi/scanner/photo_detection/server.py#L67)
- DB logic is spread throughout route handlers in [server.py](/home/rishi/scanner/photo_detection/server.py)

### Current SQLite dependency points

#### In [server.py](/home/rishi/scanner/photo_detection/server.py)

- `import sqlite3` at line 8
- `sqlite3.connect(...)` at line 70
- `sqlite3.Row` at line 71
- SQLite `CREATE TABLE IF NOT EXISTS` usage at lines 82, 130, 140, 154, 172, 196, 750, 1181, 1295
- SQLite `AUTOINCREMENT` usage at lines 131, 141, 155, 173, 751, 1182, 1296
- SQLite `CURRENT_TIMESTAMP` defaults at lines 134, 166, 185, 186, 761, 1193, 1305
- SQLite upsert with `ON CONFLICT` at line 104
- incremental `ALTER TABLE ... ADD COLUMN` migration pattern at lines 192 to 195
- `cursor.lastrowid` at line 610
- SQLite date function `DATE('now', '-7 days')` at line 937
- `CURRENT_TIMESTAMP` in update queries at lines 1276 and 1905

#### In [setup_db.py](/home/rishi/scanner/photo_detection/setup_db.py)

- `import sqlite3` at line 11
- `sqlite3.connect(...)` at line 26
- SQLite table creation syntax at lines 30 to 76
- `cursor.lastrowid` at line 90

#### In [db_test.py](/home/rishi/scanner/photo_detection/db_test.py)

- `import sqlite3` at line 2
- `sqlite3.connect(...)` at line 13

### Current SQLite schema

This reflects the current intended schema in [server.py](/home/rishi/scanner/photo_detection/server.py#L128) and [setup_db.py](/home/rishi/scanner/photo_detection/setup_db.py#L30).

```sql
CREATE TABLE branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    branch_id INTEGER REFERENCES branches(id),
    active INTEGER DEFAULT 1,
    email TEXT
);

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
);

CREATE TABLE production_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    branch_id INTEGER REFERENCES branches(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(branch_id, name)
);

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
);

CREATE TABLE otp_store (
    username TEXT PRIMARY KEY,
    otp TEXT NOT NULL,
    expires REAL NOT NULL,
    sent_at REAL NOT NULL,
    attempts INTEGER DEFAULT 0
);

CREATE TABLE allowed_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT 'Unnamed Network',
    added_by TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transfer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quantity INTEGER NOT NULL DEFAULT 1,
    requested_by INTEGER REFERENCES users(id),
    requested_by_name TEXT,
    source_branch_id INTEGER REFERENCES branches(id),
    production_room_id INTEGER REFERENCES production_rooms(id),
    status TEXT DEFAULT 'submitted',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_request_id INTEGER NOT NULL REFERENCES transfer_requests(id),
    stock_id INTEGER NOT NULL REFERENCES stock(id),
    production_room_id INTEGER NOT NULL REFERENCES production_rooms(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Target SQL Server 2019 Schema

The target schema below is compatibility-first. It intentionally keeps existing application-facing text date columns as text, because the current backend and frontend already treat `timestamp`, `mfg_date`, and `expiry_date` as string fields.

### Design choices

- Keep `timestamp`, `mfg_date`, and `expiry_date` as `NVARCHAR`
- Keep `otp_store.expires` and `otp_store.sent_at` numeric
- Convert booleans like `users.active` to `BIT`
- Use `IDENTITY(1,1)` for numeric primary keys
- Use `DATETIME2(0)` for server-side audit timestamps
- Add indexes that match current query patterns

### Target SQL Server DDL

```sql
IF OBJECT_ID('dbo.transfer_requests', 'U') IS NOT NULL DROP TABLE dbo.transfer_requests;
IF OBJECT_ID('dbo.production_stock', 'U') IS NOT NULL DROP TABLE dbo.production_stock;
IF OBJECT_ID('dbo.otp_store', 'U') IS NOT NULL DROP TABLE dbo.otp_store;
IF OBJECT_ID('dbo.stock', 'U') IS NOT NULL DROP TABLE dbo.stock;
IF OBJECT_ID('dbo.production_rooms', 'U') IS NOT NULL DROP TABLE dbo.production_rooms;
IF OBJECT_ID('dbo.scans', 'U') IS NOT NULL DROP TABLE dbo.scans;
IF OBJECT_ID('dbo.users', 'U') IS NOT NULL DROP TABLE dbo.users;
IF OBJECT_ID('dbo.branches', 'U') IS NOT NULL DROP TABLE dbo.branches;

CREATE TABLE dbo.branches (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name NVARCHAR(150) NOT NULL,
    code NVARCHAR(50) NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_branches_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_branches_code UNIQUE (code)
);

CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    username NVARCHAR(100) NOT NULL,
    password CHAR(64) NOT NULL,
    name NVARCHAR(150) NOT NULL,
    role NVARCHAR(20) NOT NULL CONSTRAINT DF_users_role DEFAULT 'user',
    branch_id INT NULL,
    active BIT NOT NULL CONSTRAINT DF_users_active DEFAULT 1,
    email NVARCHAR(255) NULL,
    CONSTRAINT UQ_users_username UNIQUE (username),
    CONSTRAINT FK_users_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id)
);

CREATE TABLE dbo.stock (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    batch_no NVARCHAR(100) NULL,
    mfg_date NVARCHAR(50) NULL,
    expiry_date NVARCHAR(50) NULL,
    flavour NVARCHAR(100) NULL,
    rack_no NVARCHAR(50) NULL,
    shelf_no NVARCHAR(50) NULL,
    branch_id INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_stock_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_stock_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_stock_identity UNIQUE (batch_no, mfg_date, expiry_date, flavour, rack_no, shelf_no, branch_id),
    CONSTRAINT FK_stock_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id)
);

CREATE TABLE dbo.production_rooms (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name NVARCHAR(150) NOT NULL,
    branch_id INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_production_rooms_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_production_rooms UNIQUE (branch_id, name),
    CONSTRAINT FK_production_rooms_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id)
);

CREATE TABLE dbo.scans (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    stock_id INT NULL,
    [timestamp] NVARCHAR(50) NULL,
    batch_no NVARCHAR(100) NULL,
    mfg_date NVARCHAR(50) NULL,
    expiry_date NVARCHAR(50) NULL,
    flavour NVARCHAR(100) NULL,
    rack_no NVARCHAR(50) NULL,
    shelf_no NVARCHAR(50) NULL,
    movement NVARCHAR(10) NOT NULL CONSTRAINT DF_scans_movement DEFAULT 'IN',
    synced_by NVARCHAR(100) NULL,
    branch_id INT NULL,
    synced_at DATETIME2(0) NOT NULL CONSTRAINT DF_scans_synced_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_scans_stock FOREIGN KEY (stock_id) REFERENCES dbo.stock(id),
    CONSTRAINT FK_scans_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id)
);

CREATE TABLE dbo.otp_store (
    username NVARCHAR(100) NOT NULL PRIMARY KEY,
    otp CHAR(6) NOT NULL,
    expires DECIMAL(18,6) NOT NULL,
    sent_at DECIMAL(18,6) NOT NULL,
    attempts INT NOT NULL CONSTRAINT DF_otp_store_attempts DEFAULT 0
);

CREATE TABLE dbo.transfer_requests (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    scan_id INT NULL,
    requested_by INT NULL,
    requested_by_name NVARCHAR(150) NULL,
    source_branch_id INT NULL,
    production_room_id INT NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_transfer_requests_status DEFAULT 'submitted',
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_transfer_requests_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_transfer_requests_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_transfer_requests_user FOREIGN KEY (requested_by) REFERENCES dbo.users(id),
    CONSTRAINT FK_transfer_requests_source_branch FOREIGN KEY (source_branch_id) REFERENCES dbo.branches(id),
    CONSTRAINT FK_transfer_requests_production_room FOREIGN KEY (production_room_id) REFERENCES dbo.production_rooms(id)
);

CREATE TABLE dbo.production_stock (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    transfer_request_id INT NOT NULL,
    stock_id INT NOT NULL,
    production_room_id INT NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_production_stock_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_production_stock_transfer_request UNIQUE (transfer_request_id),
    CONSTRAINT FK_production_stock_request FOREIGN KEY (transfer_request_id) REFERENCES dbo.transfer_requests(id),
    CONSTRAINT FK_production_stock_stock FOREIGN KEY (stock_id) REFERENCES dbo.stock(id),
    CONSTRAINT FK_production_stock_room FOREIGN KEY (production_room_id) REFERENCES dbo.production_rooms(id)
);

CREATE INDEX IX_users_branch_id ON dbo.users(branch_id);

CREATE INDEX IX_stock_branch_id ON dbo.stock(branch_id);
CREATE INDEX IX_stock_flavour ON dbo.stock(flavour);
CREATE INDEX IX_stock_batch_no ON dbo.stock(batch_no);

CREATE INDEX IX_production_rooms_branch_id ON dbo.production_rooms(branch_id);

CREATE INDEX IX_scans_branch_id ON dbo.scans(branch_id);
CREATE INDEX IX_scans_stock_id ON dbo.scans(stock_id);
CREATE INDEX IX_scans_flavour ON dbo.scans(flavour);
CREATE INDEX IX_scans_batch_no ON dbo.scans(batch_no);
CREATE INDEX IX_scans_movement ON dbo.scans(movement);
CREATE INDEX IX_scans_synced_at ON dbo.scans(synced_at);

CREATE INDEX IX_transfer_requests_status ON dbo.transfer_requests(status);
CREATE INDEX IX_transfer_requests_source_branch_id ON dbo.transfer_requests(source_branch_id);
CREATE INDEX IX_transfer_requests_production_room_id ON dbo.transfer_requests(production_room_id);
CREATE INDEX IX_transfer_requests_requested_by ON dbo.transfer_requests(requested_by);

CREATE INDEX IX_production_stock_room_created_at ON dbo.production_stock(production_room_id, created_at DESC);
CREATE INDEX IX_production_stock_transfer_request ON dbo.production_stock(transfer_request_id);
```

## Side-by-side schema mapping

| SQLite | SQL Server 2019 |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT IDENTITY(1,1) PRIMARY KEY` |
| `TEXT` | `NVARCHAR(...)` or `NVARCHAR(MAX)` |
| `INTEGER DEFAULT 1` for booleans | `BIT NOT NULL DEFAULT 1` |
| `DATETIME DEFAULT CURRENT_TIMESTAMP` | `DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()` |
| `REAL` | `DECIMAL(18,6)` |
| `REFERENCES table(id)` | `FOREIGN KEY (...) REFERENCES dbo.table(id)` |

## Required code changes

## 1. [requirements.txt](/home/rishi/scanner/photo_detection/requirements.txt)

### Current state

Only Flask-related packages are listed.

### Required changes

- add `pyodbc`

### Result

The file should include:

```txt
pyodbc==<approved-version>
```

Exact version can be pinned after confirming the runtime environment.

## 2. [server.py](/home/rishi/scanner/photo_detection/server.py)

This is the main migration file.

### 2.1 Imports

#### Current

```python
import sqlite3
```

#### Required

- remove `sqlite3`
- add `pyodbc`

### 2.2 Connection helper

#### Current

At [server.py](/home/rishi/scanner/photo_detection/server.py#L67):

```python
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'users.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
```

#### Required

- remove `DB_PATH`
- replace with SQL Server connection settings from environment variables
- add a `pyodbc.connect(...)` based connection
- add row conversion helpers because `sqlite3.Row` is no longer available

### 2.3 Environment variables

The backend should read values like:

```text
DB_SERVER=
DB_DATABASE=
DB_USERNAME=
DB_PASSWORD=
DB_DRIVER=
DB_TRUST_SERVER_CERTIFICATE=
DB_ENCRYPT=
DB_AUTH_MODE=
```

Recommended interpretation:

- `DB_AUTH_MODE=sql`
- `DB_AUTH_MODE=windows`

### 2.4 Row access compatibility

#### Current dependency

The code uses:

- `row['field']`
- `dict(row)`

That is supported by `sqlite3.Row`, but not directly by `pyodbc`.

#### Required

Add central helpers such as:

- `fetchone_dict(cursor)`
- `fetchall_dicts(cursor)`

These should convert `cursor.description` plus tuple-style rows into dictionaries.

This should be done centrally to avoid rewriting all route handlers.

### 2.5 Schema creation logic

#### Current dependency

`init_db()` in [server.py](/home/rishi/scanner/photo_detection/server.py#L123) creates SQLite tables and also runs SQLite-specific fallback migrations.

#### Required

- replace all SQLite DDL with SQL Server DDL
- remove incremental `ALTER TABLE ... ADD COLUMN` fallback logic
- use full clean-schema creation logic instead
- if idempotency is needed, use `IF OBJECT_ID(...) IS NULL`

### 2.6 OTP upsert

#### Current dependency

At [server.py](/home/rishi/scanner/photo_detection/server.py#L99):

```sql
INSERT INTO otp_store (...)
VALUES (...)
ON CONFLICT(username) DO UPDATE SET ...
```

#### Required

Replace with SQL Server-safe logic:

```sql
UPDATE dbo.otp_store
SET otp = ?, expires = ?, sent_at = ?, attempts = ?
WHERE username = ?;

IF @@ROWCOUNT = 0
BEGIN
    INSERT INTO dbo.otp_store (username, otp, expires, sent_at, attempts)
    VALUES (?, ?, ?, ?, ?);
END
```

This is preferred over `MERGE` for this low-contention OTP table.

### 2.7 Inserted identity retrieval

#### Current dependency

`cursor.lastrowid` is used at:

- [server.py](/home/rishi/scanner/photo_detection/server.py#L610)
- [setup_db.py](/home/rishi/scanner/photo_detection/setup_db.py#L90)

#### Required

Replace with one of these patterns:

- `OUTPUT INSERTED.id`
- `SELECT SCOPE_IDENTITY()`

Recommended standard:

- use `OUTPUT INSERTED.id` on insert statements where the inserted ID is needed immediately

### 2.8 SQLite date math

#### Current dependency

At [server.py](/home/rishi/scanner/photo_detection/server.py#L937):

```sql
synced_at >= DATE('now', '-7 days')
```

#### Required

Replace with:

```sql
synced_at >= DATEADD(day, -7, GETDATE())
```

If UTC semantics are desired later, switch to `SYSUTCDATETIME()`.

### 2.9 `CURRENT_TIMESTAMP` updates

#### Current dependency

Update queries use SQLite style at:

- [server.py](/home/rishi/scanner/photo_detection/server.py#L1276)
- [server.py](/home/rishi/scanner/photo_detection/server.py#L1905)

#### Required

Replace with SQL Server-safe:

```sql
updated_at = SYSDATETIME()
```

or

```sql
updated_at = GETDATE()
```

### 2.10 Repeated `CREATE TABLE IF NOT EXISTS scans`

#### Current dependency

Additional inline schema guards exist at:

- [server.py](/home/rishi/scanner/photo_detection/server.py#L749)
- [server.py](/home/rishi/scanner/photo_detection/server.py#L1180)
- [server.py](/home/rishi/scanner/photo_detection/server.py#L1294)

#### Required

- remove or rewrite these guards
- the preferred approach is to let `init_db()` fully own schema creation
- route handlers should not create tables at runtime

### 2.11 Transaction behavior

#### Current dependency

The app currently commits explicitly after writes, which is good. That behavior should be preserved.

#### Required

- continue explicit `conn.commit()` after write operations
- use `autocommit=False` unless a specific case requires otherwise
- close connections explicitly

### 2.12 Default seed data

#### Current dependency

`init_db()` seeds:

- default branch `MAIN`
- users `superadmin`, `admin`, `user1`

See [server.py](/home/rishi/scanner/photo_detection/server.py#L219).

#### Required

- preserve this behavior
- make it work against a fresh SQL Server schema

## 3. [setup_db.py](/home/rishi/scanner/photo_detection/setup_db.py)

### Current role

Creates a fresh SQLite DB file and seeds default records.

### Required changes

- remove file deletion logic for `users.db`
- replace with SQL Server connection logic
- either:
  - convert it into a SQL Server bootstrap script, or
  - remove it entirely and let `init_db()` in [server.py](/home/rishi/scanner/photo_detection/server.py) own DB initialization

### Recommended outcome

Use one initialization source only.

Recommended:

- keep initialization in [server.py](/home/rishi/scanner/photo_detection/server.py)
- either delete [setup_db.py](/home/rishi/scanner/photo_detection/setup_db.py) later or convert it into an optional admin bootstrap tool

## 4. [db_test.py](/home/rishi/scanner/photo_detection/db_test.py)

### Current role

Simple SQLite file creation test.

### Required changes

Replace with a SQL Server connection smoke test:

- connect to SQL Server
- run `SELECT 1`
- optionally create and drop a trivial temp test table

### Recommended purpose

Use this file to validate:

- network reachability
- ODBC driver availability
- credentials
- encryption / trust settings

## SQL Server connection details required from environment

The code migration can proceed with placeholders, but production use requires:

- SQL Server host
- SQL Server instance name if not default
- authentication mode
- database name
- username and password if SQL auth is used
- ODBC driver version
- encryption preference
- trust server certificate preference
- confirmation whether Flask runs on the same machine or a different one

## Recommended connection string strategy

### SQL authentication example

```python
conn = pyodbc.connect(
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=SERVER_NAME;"
    "DATABASE=LabelScanner;"
    "UID=flask_user;"
    "PWD=StrongPassword123!;"
    "Encrypt=no;"
    "TrustServerCertificate=yes;"
)
```

### Windows authentication example

```python
conn = pyodbc.connect(
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=SERVER_NAME;"
    "DATABASE=LabelScanner;"
    "Trusted_Connection=yes;"
    "Encrypt=no;"
    "TrustServerCertificate=yes;"
)
```

## Query compatibility notes

### Safe to keep mostly unchanged

- `?` placeholders in parameterized SQL
- `CASE WHEN`
- `LEFT JOIN`
- `GROUP BY`
- string comparisons
- most aggregation logic

### Must be rewritten

- `sqlite3.Row`
- `ON CONFLICT`
- `AUTOINCREMENT`
- `CURRENT_TIMESTAMP` defaults and update expressions
- `DATE('now', '-7 days')`
- `CREATE TABLE IF NOT EXISTS`
- `cursor.lastrowid`
- runtime schema creation inside request handlers

## Route groups affected

All DB-backed routes in [server.py](/home/rishi/scanner/photo_detection/server.py) are affected.

### Authentication

- `/api/login`
- `/api/logout`
- `/api/get-login-method`
- `/api/send-otp`
- `/api/verify-otp`
- `/api/check-auth`

### User and branch management

- `/api/register`
- `/api/branches`
- `/api/admin/branches`
- `/api/users`
- `/api/admin/users/pending`
- `/api/admin/users/approve`
- `/api/admin/users/reject`
- `/api/admin/users/change-password`
- `/api/admin/users/update-email`

### Scans and sync

- `/api/sync`
- `/api/admin/sync`
- `/api/admin/scan/add`
- `/api/admin/scan/update`
- `/api/admin/scan/delete`
- `/api/admin/csv/import`

### Dashboard, analytics, export

- `/api/admin/dashboard`
- `/api/admin/analytics`
- `/api/admin/expiry-forecast`
- `/api/admin/expiry-items`
- `/api/admin/export`
- `/api/admin/pivot`

### Transfer flows

- `/api/transfer/flavors`
- `/api/transfer/nearest-expiry`
- `/api/transfer/batches`
- `/api/transfer/request`
- `/api/transfer/requests`
- `/api/transfer/update-status`

## Exact implementation plan

### Phase 1: Environment and connection

1. Add `pyodbc` to [requirements.txt](/home/rishi/scanner/photo_detection/requirements.txt)
2. Replace SQLite import and connection code in [server.py](/home/rishi/scanner/photo_detection/server.py)
3. Add env-driven SQL Server config
4. Add row conversion helpers
5. Convert [db_test.py](/home/rishi/scanner/photo_detection/db_test.py) into a SQL Server smoke test

### Phase 2: Schema

1. Replace `init_db()` schema DDL with SQL Server DDL
2. Remove SQLite incremental migration hacks
3. Keep seed data creation
4. Remove runtime table-creation logic from request handlers

### Phase 3: Query rewrites

1. Rewrite OTP upsert
2. Rewrite analytics date query
3. Rewrite `lastrowid` usages
4. Rewrite `CURRENT_TIMESTAMP` update queries

### Phase 4: Validation

1. Test connection
2. Test auth and OTP
3. Test user creation and approval
4. Test scan sync and manual scan creation
5. Test dashboard and analytics
6. Test transfer flow
7. Test export route

## Test checklist

### Connectivity

- SQL Server can be reached from the app runtime
- ODBC driver is installed
- credentials are valid
- selected DB exists

### Auth

- login works
- logout works
- pending user restriction still works
- OTP insert/update/delete works

### Data creation

- branch creation works
- user registration works
- seeded users are created on fresh DB
- scan inserts work

### Dashboard and reporting

- admin dashboard loads
- analytics loads
- 7-day activity query works
- pivot data loads
- CSV export works

### Transfer flow

- flavor list loads
- batch lookup works
- transfer request insert works
- status update works
- auto-complete on matching OUT scans still works

## Non-goals for this migration

- introducing SQLAlchemy
- redesigning the backend architecture
- normalizing the string date columns into proper relational date fields
- preserving old SQLite data
- changing frontend API contracts

## Risks

### Medium-risk items

- row access compatibility after removing `sqlite3.Row`
- insert ID retrieval after replacing `lastrowid`
- correctness of OTP upsert rewrite
- behavior differences in date filtering
- hidden assumptions in runtime schema creation logic

### Low-risk items

- replacing DDL syntax
- replacing package dependency
- preserving seed data logic

## Final conclusion

For this repository, the precise and correct migration path is:

- migrate from SQLite to SQL Server 2019 using `pyodbc`
- keep the current raw SQL structure
- create a fresh SQL Server schema
- rewrite only the SQL Server incompatibilities
- validate route-by-route

This document should be treated as the implementation baseline for the migration.
