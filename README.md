# AI Accounting & Auditing Portal

A full-stack AI demo portal for accounting and auditing use cases, featuring a streaming chatbot, CSV data visualisation, receipt scanner, and transaction budget classifier.

**Stack:** FastAPI · Next.js 16 · React 19 · Tailwind CSS · Recharts · Gemini 2.0 Flash · ChromaDB · SQLite · Docker

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Environment Configuration](#environment-configuration)
4. [Backend Setup](#backend-setup)
   - [Local Development](#backend--local-development)
   - [Creating the Admin Superuser](#creating-the-admin-superuser)
   - [Adding Additional Users](#adding-additional-users)
5. [Frontend Setup](#frontend-setup)
   - [Local Development](#frontend--local-development)
6. [Running with Docker Compose](#running-with-docker-compose)
7. [API Reference](#api-reference)
8. [Data Files](#data-files)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 20 LTS+ | [nodejs.org](https://nodejs.org/) |
| Docker Desktop | Latest | Required for `docker compose` only |
| Tesseract OCR | 5.x | Required for scanned PDF receipts — [UB Mannheim installer for Windows](https://github.com/UB-Mannheim/tesseract/wiki) |

API keys required:

- **Gemini API key** — [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Resend API key** (optional, for email delivery) — [resend.com](https://resend.com)

---

## Project Structure

```
AI Demo/
├── .env.example           # Template — copy to .env before first run
├── docker-compose.yml
├── ARCHITECTURE_PLAN.md
│
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI entry point, lifespan, CORS
│   │   ├── db.py          # SQLite schema + admin user seed
│   │   ├── api/           # Route modules (auth, chat, data_viz, receipts, transactions, jobs)
│   │   ├── core/          # Config, security (JWT/bcrypt), queue (semaphore), Gemini client
│   │   ├── rag/           # ChromaDB bootstrap (budget rules) + CSV pipeline
│   │   └── services/      # PDF extractor, email sender
│   ├── data/
│   │   ├── sample.csv     # 20-row demo accounting dataset
│   │   └── budget_rules.txt  # 14 budget lines used by the classifier
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env               # Local secrets — NOT committed
│
└── frontend/
    ├── src/
    │   ├── app/            # Next.js App Router pages
    │   │   ├── page.tsx           # Dashboard
    │   │   ├── login/page.tsx     # Login
    │   │   ├── chat/page.tsx      # Streaming chatbot
    │   │   ├── data-viz/page.tsx  # CSV data visualisation
    │   │   ├── receipts/page.tsx  # Receipt scanner
    │   │   └── transactions/page.tsx  # Transaction classifier
    │   └── middleware.ts   # JWT cookie verification
    ├── package.json
    └── Dockerfile
```

---

## Environment Configuration

### 1. Create the root `.env` file

```bash
# From the project root
copy .env.example .env
```

Then open `.env` and fill in the required values:

```env
# ── Required ────────────────────────────────────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key_here
JWT_SECRET=your_jwt_secret_here        # See generation command below

# ── Optional (email delivery) ─────────────────────────────────────────────
RESEND_API_KEY=your_resend_api_key_here

# ── Admin seed account (used only on very first startup) ──────────────────
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme123             # Change this before production!

# ── These are fine as-is for local dev ────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000
MAX_CONCURRENT_REQUESTS=3
CSV_DATA_PATH=./data/sample.csv
BUDGET_DOC_PATH=./data/budget_rules.txt
```

Generate a strong JWT secret:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

### 2. Copy `.env` into the backend folder

The backend reads its own `.env` file (the root `.env` is also used by Docker Compose):

```powershell
copy .env backend\.env
```

---

## Backend Setup

### Backend — Local Development

```powershell
cd "c:\Users\YourName\MyWork\AI Demo\backend"

# Create a virtual environment
python -m venv .venv

# Activate it
.\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Start the development server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`  
Health check: `http://localhost:8000/health`

> **Note:** On first startup the server creates `ai_demo.db`, seeds the admin user, and bootstraps the ChromaDB vector index from `budget_rules.txt`. This requires a valid `GEMINI_API_KEY`. If the key is missing, the RAG bootstrap is skipped with a warning and all other endpoints still work.

---

### Creating the Admin Superuser

The admin account is seeded **automatically on first startup** using the `ADMIN_USERNAME` and `ADMIN_PASSWORD` values from `.env`.

**Default credentials (change before any production use):**

```
Username: admin
Password: changeme123
```

#### To change the admin password before first run

Edit `backend/.env`:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=MyStr0ng!P@ssword
```

Then start the server — the account will be created with the new password.

#### To reset the admin password on an existing database

```powershell
# From the backend folder with .venv activated
cd "AI Demo\backend"
.\.venv\Scripts\Activate.ps1

python - <<'EOF'
import asyncio, aiosqlite
from app.core.security import hash_password

NEW_PASSWORD = "MyNewP@ssword123"  # change this

async def reset():
    async with aiosqlite.connect("./ai_demo.db") as db:
        hashed = hash_password(NEW_PASSWORD)
        await db.execute("UPDATE users SET password = ? WHERE username = 'admin'", (hashed,))
        await db.commit()
        print("Password updated.")

asyncio.run(reset())
EOF
```

---

### Adding Additional Users

There is no sign-up UI — all accounts are created programmatically via the SQLite database:

```powershell
cd "AI Demo\backend"
.\.venv\Scripts\Activate.ps1

python - <<'EOF'
import asyncio, aiosqlite
from app.core.security import hash_password

NEW_USER = "alice"
NEW_PASS = "Secur3P@ss!"

async def create_user():
    async with aiosqlite.connect("./ai_demo.db") as db:
        hashed = hash_password(NEW_PASS)
        await db.execute(
            "INSERT INTO users (username, password) VALUES (?, ?)",
            (NEW_USER, hashed),
        )
        await db.commit()
        print(f"User '{NEW_USER}' created.")

asyncio.run(create_user())
EOF
```

#### Listing all users

```powershell
python - <<'EOF'
import asyncio, aiosqlite

async def list_users():
    async with aiosqlite.connect("./ai_demo.db") as db:
        async with db.execute("SELECT id, username, created_at FROM users") as cur:
            rows = await cur.fetchall()
    for row in rows:
        print(row)

asyncio.run(list_users())
EOF
```

#### Deleting a user

```powershell
python - <<'EOF'
import asyncio, aiosqlite

USERNAME = "alice"  # change this

async def delete_user():
    async with aiosqlite.connect("./ai_demo.db") as db:
        await db.execute("DELETE FROM users WHERE username = ?", (USERNAME,))
        await db.commit()
        print(f"User '{USERNAME}' deleted.")

asyncio.run(delete_user())
EOF
```

---

## Frontend Setup

### Frontend — Local Development

```powershell
cd "c:\Users\YourName\MyWork\AI Demo\frontend"

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

The frontend reads `NEXT_PUBLIC_API_URL` to know where the backend is. For local development this is set automatically by Next.js from the root `.env` file if you run both servers locally. If you need to override it explicitly, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
JWT_SECRET=<same value as in backend/.env>
```

> **Important:** `JWT_SECRET` must be identical in both the backend `.env` and the frontend env — the Next.js middleware uses it to verify tokens server-side.

---

## Running with Docker Compose

> Docker Desktop must be installed and running first.

```powershell
# From the project root
cd "AI Demo"

# Build and start all services
docker compose up --build

# Run in background
docker compose up --build -d

# View logs
docker compose logs -f

# Stop everything
docker compose down
```

The Docker Compose file mounts the following paths for persistence across restarts:

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `./backend/ai_demo.db` | `/app/ai_demo.db` | SQLite database |
| `./backend/chroma_db/` | `/app/chroma_db/` | ChromaDB vector index |
| `./backend/data/` | `/app/data/` (read-only) | CSV + budget rules |

---

## API Reference

All endpoints except `/health` require a `Bearer` JWT token in the `Authorization` header.

### Auth

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/auth/login` | `{username, password}` | `{access_token, token_type}` |

### Chat

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/chat/message` | `multipart/form-data` (see below) | SSE stream — events: `data: {"chunk":"...","done":false}` |

**Chat request fields (multipart/form-data):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `message` | string (Form) | Yes | The user's text message |
| `history` | string (Form) | No | JSON array — `[{"role":"user"\|"model","content":"..."}]` |
| `files` | File[] | No | Up to 3 files (.pdf / .csv / .txt), max 10 MB each |

**SSE event format:**
```json
{ "chunk": "...", "done": false }
```
Final event: `{ "chunk": "", "done": true }`

### Data Visualisation

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/data/query` | `{question}` | `{job_id, summary, visuals[]}` |

**Response schema:**

```json
{
  "job_id": "uuid",
  "summary": "Plain-English answer quoting exact figures.",
  "visuals": [
    {
      "type": "bar" | "line" | "pie" | "table",
      "title": "...",
      "x_label": "...",
      "y_label": "...",
      "data": [{"label": "...", "value": 0}],
      "columns": ["col1", "col2"],
      "rows": [["cell", "cell"]]
    }
  ]
}
```

- `summary` is always present. `visuals` contains 1–3 charts or tables.
- For `bar`, `line`, and `pie` types: `data` is populated; `columns`/`rows` are omitted.
- For `table` type: `columns` + `rows` are populated; `data` is omitted.

### Receipts

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/receipts/upload` | `multipart: files[], email` | `{job_id, message}` |
| `GET` | `/api/jobs/{job_id}` | — | `{id, status, result?, error?}` |

### Transactions

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/transactions/classify` | `{transactions: [{description, amount}]}` | `{job_id, classifications[]}` |

Each classification item:

```json
{
  "transaction": "Office stationery",
  "amount": 125.00,
  "budget_code": "OPS-001",
  "budget_line": "Office Supplies",
  "meets_requirements": true,
  "reason": "Within per-transaction limit of R2,000"
}
```

---

## Data Files

### `backend/data/sample.csv`

The CSV dataset used by the Data Visualisation page. Expected columns (rename yours to match, or use any column names — the pipeline reads column names dynamically):

```
date, description, category, amount, department, vendor
```

Replace this file with your own data — even large files (3,000+ rows) are supported. The backend reads the full file on every query via the two-step pipeline; no restart is needed.

> **How the pipeline works:** On each query, Gemini 2.0 Flash first reads the schema summary (column names, data types, value ranges) and writes a pandas expression. The backend executes that expression safely against the full dataset to get exact figures. A second Gemini call then formats those exact results into the structured visual response. This means filter queries, percentiles, conditional aggregations, and period comparisons all return precise numbers — even for large CSVs.

### `backend/data/budget_rules.txt`

14 budget lines (OPS-001 through PST-014) used by the Transaction Classifier. Each line defines:

- Budget code and name
- Annual budget and per-transaction limit
- Approval thresholds
- Eligible and ineligible expense types

The file is chunked and embedded into ChromaDB on first startup. **If you update this file, delete `backend/chroma_db/` and restart the backend** so the index is rebuilt:

```powershell
Remove-Item -Recurse -Force "backend\chroma_db"
# Then restart uvicorn
```

---

## Using the Portal

All pages require login. Use the credentials set in `ADMIN_USERNAME` / `ADMIN_PASSWORD` (default: `admin` / `changeme123`).

---

### Chatbot (`/chat`)

An accounting and auditing expert assistant with streaming responses.

**To ask a question:**
1. Type your message in the input box and press **Enter** or click **Send**.
2. The assistant streams its answer in real time with full markdown formatting (tables, bold, lists, code blocks).

**To attach files:**
1. Click the **paperclip** icon to open the file picker.
2. Select up to **3 files** — supported formats: `.pdf`, `.csv`, `.txt`.
3. Each file must be under **10 MB**.
4. File names appear as chips above the input box. Click **×** to remove a file.
5. On send, the file contents are injected as context into the prompt (PDFs are OCR-extracted; CSVs and TXTs are decoded as plain text).

**Tips:**
- Attach a balance sheet or ledger export to ask questions about specific figures.
- Attach a CSV of transactions to get Gemini's analysis without leaving the chat.
- Conversation history is maintained within the session — ask follow-up questions naturally.

---

### Data Visualisation (`/data-viz`)

Ask natural-language questions about the `sample.csv` dataset and receive interactive charts.

**To query the data:**
1. Type a question in the input box (examples below) and press **Enter** or click **Analyse**.
2. A loading spinner appears while the backend executes the two-step pipeline.
3. The response shows:
   - A **summary card** with a plain-English answer quoting exact figures.
   - Up to **3 interactive visuals** (bar, line, pie charts, or data tables).

**Example questions:**
```
What are the total expenses by category?
Show monthly spend trends as a line chart.
Which department has the highest average transaction amount?
What are the top 5 vendors by total spend?
How much was spent on travel above R5,000?
What percentage of total spend does each category represent?
```

**Chart interactions:**
- **Hover** over bars, lines, and pie slices for exact values in a tooltip.
- For 3 visuals: the first two are side-by-side; the third spans full width.
- Tables have right-aligned numeric columns and hover-highlighted rows.

**Replacing the dataset:**
Copy your CSV to `backend/data/sample.csv` and reload the page. No restart required. The pipeline auto-detects column types including date columns (parsed from ISO 8601, `DD/MM/YYYY`, and common formats).

---

### Receipt Scanner (`/receipts`)

Upload PDF receipt scans for structured extraction, then email the results.

**To scan receipts:**
1. Drag and drop one or more PDF files onto the upload zone — or click to browse.
2. Enter the **destination email address** in the email field.
3. Click **Upload & Process**.
4. A job ID is returned immediately. The page polls for status every 2.5 seconds.
5. Once complete, the extracted receipt data appears in a table on the page and an HTML-formatted email is sent to the address provided.

**What is extracted per receipt:**
- Vendor name, date, line items (description + amount), subtotal, tax, total.

**Requirements:**
- Files must be `.pdf` format.
- Tesseract OCR must be installed for scanned (image-based) PDFs. Text-layer PDFs work without Tesseract.
- A valid `RESEND_API_KEY` is required for email delivery. If not set, extraction still works but no email is sent.

---

### Transaction Classifier (`/transactions`)

Classify transactions against your organisation's budget rules.

**To classify transactions:**
1. Enter one or more transactions using the row inputs — each row has a **Description** and **Amount** field.
2. Click **+ Add Row** to add more rows, or **Load samples** to prefill with example transactions.
3. Click **Classify Transactions**.
4. Results appear in a colour-coded compliance table:
   - **Green** badge — meets budget requirements.
   - **Red** badge — does not meet requirements.
5. Each row shows the matched budget code, budget line, and a plain-English reason.

**How it works:**
Each transaction description is embedded and compared against the budget rules in ChromaDB (vector similarity search). The top matching rules are retrieved and passed to Gemini alongside the transaction amount for a compliance verdict.

**Updating budget rules:**
Edit `backend/data/budget_rules.txt`, then delete `backend/chroma_db/` and restart the backend to rebuild the vector index.

---

## Troubleshooting

### `AttributeError: module 'bcrypt' has no attribute '__about__'`

bcrypt 5.x is incompatible with passlib 1.7.4. Pin bcrypt to `<5`:

```powershell
pip install "bcrypt>=4.0.0,<5.0.0"
```

This is already enforced in `requirements.txt`.

### `ValidationError: extra fields not permitted`

The `.env` file contains variables not declared in `Settings`. This is already fixed via `extra = "ignore"` in `core/config.py`. If you see this, ensure you have the latest `config.py`.

### Budget RAG bootstrap skipped on startup

Check that:
1. `GEMINI_API_KEY` is set correctly in `backend/.env`
2. `BUDGET_DOC_PATH` points to an existing file (default: `./data/budget_rules.txt`)
3. The backend has network access to the Gemini API

The warning is non-fatal — all other features still work; only the Transaction Classifier will return empty results.

### Tesseract not found (receipt OCR fails)

Install Tesseract and add it to your `PATH`. On Windows, the default install path is:

```
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Add `C:\Program Files\Tesseract-OCR` to your system `PATH`, then restart the backend.

### Frontend `JWT_SECRET` mismatch

The Next.js middleware verifies the JWT server-side using `JWT_SECRET`. If this value differs from the backend secret, all requests will redirect to `/login`. Ensure both `backend/.env` and `frontend/.env.local` (or the root `.env` consumed by Docker Compose) use the **same** `JWT_SECRET`.

### ChromaDB errors on startup (`sqlite3` version)

ChromaDB requires `sqlite3 >= 3.35`. Python 3.11 ships with a compatible version. If you see this error, upgrade Python or run:

```powershell
pip install pysqlite3-binary
```

And add to `app/main.py` before any chromadb import:

```python
__import__('pysqlite3')
import sys
sys.modules['sqlite3'] = sys.modules.pop('pysqlite3')
```
