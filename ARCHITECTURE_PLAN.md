# AI Accounting & Auditing Demo Portal — Architecture Plan

## Overview

A 4-page Next.js + FastAPI web portal powered by Google Gemini. Each page is a standalone AI feature, all protected by JWT auth and backed by a shared request queue. Packaged as Docker containers for Google Cloud Run deployment.

---

## Recommended Stack

| Concern | Choice | Reason |
|---|---|---|
| Frontend | Next.js 14 (TypeScript) | Built-in routing, middleware for JWT, SSR |
| Backend | FastAPI (Python 3.11) | Native async, ideal for AI/streaming workloads |
| LLM | `google-genai` SDK | Official modern Gemini SDK (replaces `google-generativeai`) |
| Vector DB | ChromaDB (embedded) | Zero external server, full Docker-native RAG |
| PDF OCR | PyMuPDF + Tesseract | Best for scanned receipts; OCR built into Dockerfile |
| Email | Resend | Simplest modern transactional email API |
| Charts | Recharts | React-native, streams data updates naturally |
| Auth store | SQLite | Zero-dependency, sufficient for a demo |
| Queue tracking | SQLite + asyncio | Async concurrency cap + durable job log |

---

## Project Structure

```
AI Demo/
├── frontend/                    # Next.js 14
│   ├── app/
│   │   ├── (auth)/login/        # Login page
│   │   ├── chat/                # Page 1: Chatbot
│   │   ├── data-viz/            # Page 2: CSV visualization
│   │   ├── receipts/            # Page 3: Receipt scanner
│   │   └── transactions/        # Page 4: Budget classifier
│   ├── middleware.ts             # JWT route guard
│   └── Dockerfile
├── backend/                     # FastAPI Python 3.11
│   ├── app/
│   │   ├── api/                 # auth, chat, data_viz, receipts, transactions
│   │   ├── core/                # config, queue, gemini client, security
│   │   ├── rag/                 # csv_pipeline.py, budget_rag.py
│   │   ├── services/            # pdf_extractor.py, email_sender.py
│   │   ├── db.py                # SQLite (users + jobs tables)
│   │   └── main.py
│   ├── data/
│   │   ├── sample.csv           # Simulated live feed CSV
│   │   └── budget_rules.*       # Pre-loaded budget document
│   └── Dockerfile               # Includes tesseract-ocr + poppler
├── docker-compose.yml
└── .env.example
```

---

## Pages & Features

### Page 1 — Chatbot (`/chat`)
- Accounting & auditing expert persona via system prompt
- Streaming responses via Server-Sent Events (SSE)
- **API:** `POST /api/chat/message` → Gemini streaming

### Page 2 — Data Visualization (`/data-viz`)
- User asks natural language questions about CSV data
- CSV re-read on every request (simulates live feed)
- Gemini generates a pandas query → executes → returns structured `{chart_type, labels, data}`
- Recharts renders bar / line / pie chart dynamically
- **API:** `POST /api/data/query`

### Page 3 — Receipt Scanner (`/receipts`)
- Upload one or more PDF receipt scans + enter an email address
- PyMuPDF + Tesseract OCR extracts text from scanned PDFs
- Gemini structures extracted data into a table
- Resend delivers an HTML-formatted email with itemized receipt analysis
- Long-running — runs as a `BackgroundTask`; client polls for status
- **API:** `POST /api/receipts/upload`, `GET /api/jobs/{job_id}`

### Page 4 — Transaction Classifier (`/transactions`)
- Paste or upload a list of transactions
- Budget rules document pre-embedded in ChromaDB at app startup
- Per transaction: ChromaDB retrieves relevant budget rules → Gemini classifies
- Response table: `{transaction, budget_line, meets_requirements, reason}`
- **API:** `POST /api/transactions/classify`

---

## Queue System Design

- `asyncio.Semaphore(3)` caps simultaneous Gemini calls portal-wide
- Every inbound request creates a row in the SQLite `jobs` table:  
  `{id, type, status, created_at, result}`
- Status flow: `queued → processing → done | failed`
- Fast requests (chat, classify) acquire the semaphore inline and return the result directly
- Slow requests (receipts) run as `BackgroundTasks`; the client polls `GET /api/jobs/{job_id}`
- UI shows queue position and a live status indicator while waiting

---

## Auth Flow

- `POST /api/auth/login` → bcrypt password verify → returns JWT (HS256, 8h expiry)
- No public registration — admin seeds user accounts directly
- Next.js `middleware.ts` checks JWT cookie and redirects unauthenticated users to `/login`

---

## Environment Variables

```
GEMINI_API_KEY=...
JWT_SECRET=...
RESEND_API_KEY=...
BACKEND_URL=http://backend:8000
MAX_CONCURRENT_REQUESTS=3
CSV_DATA_PATH=./data/sample.csv
BUDGET_DOC_PATH=./data/budget_rules.pdf
```

---

## Implementation Phases

### Phase 1 — Scaffold & Auth
1. Initialize Next.js 14 + TypeScript + Tailwind CSS
2. Initialize FastAPI + SQLite schema + JWT auth endpoints
3. Next.js login page + `middleware.ts` route protection
4. `docker-compose.yml` wiring frontend and backend

### Phase 2 — Core Infrastructure *(depends on Phase 1)*
5. Gemini client wrapper (`core/gemini.py`) with streaming support
6. Queue system (`core/queue.py`) — `asyncio.Semaphore` + SQLite jobs table
7. `GET /api/jobs/{job_id}` status polling endpoint
8. ChromaDB bootstrap — budget document chunked and embedded at app startup

### Phase 3 — Page Implementations *(steps 9–12 can run in parallel)*
9. **Page 1 — Chat:** SSE streaming endpoint + chat UI
10. **Page 2 — Data Viz:** CSV pipeline + Recharts rendering
11. **Page 3 — Receipts:** PyMuPDF + Tesseract + Resend + BackgroundTasks + polling
12. **Page 4 — Transactions:** Budget RAG classification + results table

### Phase 4 — Polish & Deploy *(depends on Phase 3)*
13. Shared navigation shell + queue status indicator in UI
14. Error handling + loading/skeleton states across all pages
15. Cloud Run–optimized Dockerfiles + `.env.example` + README

---

## Verification Steps

1. `docker-compose up` → both services healthy, login page loads
2. Login with seeded credentials → redirected to dashboard; invalid credentials blocked
3. Chat: ask "What is double-entry bookkeeping?" → streaming response appears
4. Data viz: ask "Show total expenses by category as a bar chart" → chart renders correctly
5. Receipts: upload a PDF receipt + email address → receive a formatted email within ~30s
6. Transactions: paste 5 sample transactions → all rows classified with budget lines and compliance status
7. Concurrency: fire 10 requests simultaneously → API returns `queued` status; processed in order, max 3 at a time

---

## Key Decisions

- **No public signup** — admin seeds accounts directly in SQLite
- **CSV simulates live feed** — file is re-read on every request; path is configurable via env var
- **Budget document is pre-loaded** — not user-uploadable; embedded into ChromaDB at startup
- **No Redis needed** — `asyncio.Semaphore` handles concurrency; SQLite handles job durability
- **Cloud Run deployment** — two separate services (frontend + backend); stateless, scales to zero
