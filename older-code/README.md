# StakePad — Accountability Exchange

> *Prediction markets promised to surface truth. Instead they surfaced insider trading, fake bets,
> and journalist harassment. StakePad takes the only part of prediction markets that was never
> corrupted — the psychology of skin in the game — and applies it to the one thing you actually
> control: yourself.*

StakePad is a **multiplayer accountability protocol** where your community invests in your
deadlines. By combining social pressure with virtual stakes — governed by a suite of autonomous
Gemini AI agents — we make it economically impossible to procrastinate.

---

## How it works

1. **List a stake** — your goal, deadline, and virtual points you're putting up
2. **Friends take positions YES or NO** — live odds shift in real time
3. **Submit proof at deadline** — the Gemini Oracle evaluates it
4. **Settlement** — winners collect, losers pay, reputation updates

---

## Four-agent architecture (all Gemini)

| Agent | Role |
|---|---|
| **Guardian** | Responsible AI — rejects harmful, illegal, or inappropriate stakes. Has a hard keyword blocklist that works even without API key. |
| **Analyst** | Parses the stake, sets difficulty + opening odds, factors in creator reputation history |
| **Oracle** | Evaluates submitted proof (text, URL, or image via Gemini Vision), issues binding verdict |
| **Narrator** | Generates live activity feed copy when stakes are created and positions are placed |

---

## Google technologies used

- **Gemini 2.0 Flash / 1.5 Flash** — all four AI agents
- **Google Cloud Vision** — photo proof verification (via Oracle, image passed as base64)
- **Google Calendar API** — calendar-based stake verification
- **Google AI Studio** — deployment target (Cloud Run via Build Mode)

> Note: Firebase is **not used**. Google deprecated new project creation after June 22, 2025.
> StakePad uses in-memory storage, which is sufficient for the hackathon demo.

---

## Frontend

Single-file `index.html` — no React, no build step, no npm.

- **Playfair Display** serif for editorial headlines and odds numbers
- **DM Sans** for body and UI
- **DM Mono** for numbers and data
- Fully responsive (mobile, tablet, desktop)
- Semantic HTML5 (`<main>`, `<article>`, `<section>`, `<header>`, `<footer>`, `<time>`, ARIA)
- No external CSS framework — custom CSS custom properties throughout
- Works offline from filesystem (just open `index.html` in a browser)

Key UI features:
- Featured "hot market" hero with large editorial odds display
- Newspaper-grid market cards with embedded sparklines
- Price chart with hover tooltip in every stake modal
- Creator reputation badge — click any creator name for their full history
- Community vote tab with live tally
- Image upload for photo proof (sent to Gemini Vision)
- Persistent handle via sessionStorage
- Handles expire gracefully — no broken UI on past-deadline stakes

---

## Local setup

### Backend

```bash
cd backend
cp .env.example .env
# Add your GEMINI_API_KEY (create at aistudio.google.com → new personal project)
pip install -r requirements.txt
uvicorn main:app --reload
# → http://localhost:8000
# → http://localhost:8000/docs  (auto-generated API docs)
```

Load demo data after starting:
```bash
curl -X POST "http://localhost:8000/admin/seed?secret=stakepad-demo"
```

### Frontend

```bash
cd frontend-v2
# Option 1: just open the file
open index.html

# Option 2: serve it (needed if backend is on a different origin)
python3 -m http.server 3000
# → http://localhost:3000
```

The frontend talks to `http://localhost:8000` by default.
To point it at a deployed backend, set `window.STAKEPAD_API` before the script runs,
or find and replace the default in `index.html`.

---

## API reference

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Status + last Gemini call result |
| GET | `/stats` | Platform-wide stats |
| GET | `/stakes` | List all stakes (filterable by status, category) |
| POST | `/stakes` | Create stake — runs Guardian + Analyst |
| GET | `/stakes/:id` | Stake detail + live odds |
| POST | `/stakes/:id/positions` | Take a position |
| POST | `/stakes/:id/resolve` | Submit proof → Oracle verdict |
| POST | `/stakes/:id/community-vote` | Cast a community vote |
| GET | `/users/:id/history` | Creator reputation + resolved stake timeline |
| GET | `/leaderboard` | Ranked by points |
| GET | `/feed` | Global activity stream |
| POST | `/admin/seed` | Load demo market data |
| DELETE | `/admin/reset` | Clear in-memory store |

---

## Project structure

```
stakepad-final/
├── README.md
├── backend/
│   ├── main.py           ← FastAPI + 4 Gemini agents (756 lines)
│   ├── seed.py           ← 6 scripted demo markets with realistic history
│   ├── requirements.txt  ← fastapi, uvicorn, google-genai, python-dotenv
│   └── .env.example
└── frontend/
    └── index.html        ← Complete frontend, single file, no build step
```

---
