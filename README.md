# StakePad — The Accountability Exchange

StakePad is a decentralized accountability exchange designed to end procrastination by combining behavioral psychology with multi-agent orchestration. Users lock in personal goals, self-stake virtual points, and invite their community to back their success or bet on their failure.

---

## 🎯 Problem Statement & Practical Impact

Procrastination and lack of follow-through cost individuals thousands of hours in lost productivity, aborted fitness habits, and unfinished creative projects. 

StakePad solves this by utilizing **loss aversion** and **social validation**:
- **Loss Aversion**: Self-staking virtual points creates an immediate tangible cost to failure.
- **Peer Accountability**: Allowing public backing or skepticism introduces powerful social stakes.
- **Impartial Automated Verification**: Solves the "honor system" loophole by utilizing an objective AI jury to review real-world evidence.

---

## 🤖 Multi-Agent System & Agentic Depth

StakePad employs a robust, server-side **five-agent team** designed to manage the entire lifecycle of an accountability contract:

```
[User Goal] ──> [1. Guardian Agent] ──(Screen Approval)
                      │
                      └──> [2. Analyst Agent] ──(Categorize, Score Difficulty, Calculate Odds)
                                │
                                ├──> [4. Narrator Agent] ──(Dynamic Ticker Event Generation)
                                │
                                ├──> [5. Motivator Agent] ──(Empowering Pep Talks & Actionable Tips)
                                │
                                └───> [Active Trading & Betting Period]
                                            │ (User Submits Evidence)
                                            ▼
                                  [3. Oracle Agent] ──(Multimodal Proof Evaluation & Payout)
```

1. **The Guardian (Agent 1 — Risk & Content Moderation)**
   - **Role**: Conducts real-time safety and feasibility reviews on all proposed commitments.
   - **Agentic Logic**: Flags and rejects harmful, illegal, or physically hazardous activities, while seamlessly approving valid personal milestones. Works hand-in-hand with a fast keyword pre-filter.

2. **The Analyst (Agent 2 — Probability & Market Engineering)**
   - **Role**: Dissects the raw text description to extract structured metadata.
   - **Agentic Logic**: Dynamically maps commitments to specific categories and difficulty tiers. Crucially, it queries the creator's resolved history and **adjusts opening probability weights** based on past success rates, acting as a real-time credibility scoring engine.

3. **The Oracle (Agent 3 — Multimodal Evaluation & Resolution Jury)**
   - **Role**: Acts as the ultimate binding judge for resolving contracts.
   - **Agentic Logic**: Examines submitted text logs, external reference links (including **GitHub repository and commit URLs**), and **uploaded image screenshots** (e.g., GPS running maps, codebase screenshots, commit logs). It determines the ultimate verdict, assesses evidence quality, and automatically executes point distribution.

4. **The Narrator (Agent 4 — Live Workspace Narrative Generator)**
   - **Role**: Curates platform engagement.
   - **Agentic Logic**: Automatically translates market creation and shifting parameters into 3 unique, Bloomberg-esque feed events to populate the platform's live activity timeline.

5. **The Motivator (Agent 5 — Responsible AI Pep Talk & Wellness Coach)**
   - **Role**: Drives positive reinforcement and prevents negative pressure.
   - **Agentic Logic**: Detects when odds are stacked against the creator (high "NO" pool) and generates a fiery, positive **"Prove Them Wrong"** pep talk. If odds are favorable, it encourages consistency. Crucially, it attaches **responsible, healthy tips** (like breaking tasks into 20-minute chunks, pacing, and sleep quality) to avoid toxic pressure or burnout.

---

## 💡 Creative Innovations & Core Mechanics

- **GitHub & Commit Verification Jury**: When resolving a stake, users submit their repository URL or commit links. The **Gemini Oracle Agent** parses the text, checks description details, and reviews the link to verify authentic completion of engineering tasks, completely bypassing the "honor system".
- **Google Calendar Event Integration**: Users can link their Google Account securely inside StakePad via Firebase Google Auth. Once authenticated, the system queries the user's calendar for relevant events (spanning last 10 to next 10 days). With one click, users can import a specific calendar event, auto-populating verified details directly into the resolution evidence!
- **Interactive Market Odds**: Opening odds are calculated using a Bayesian prior combined with live community sentiment (YES vs. NO pool ratios), creating a highly reactive game-theoretical experience.
- **Pre-Approved Responsible Goal Templates**: To ensure constructive gameplay and prevent self-harm or toxic betting, users can quickly select pre-built templates for studying, coding, or cardiovascular health. These encourage healthy milestones, proper rest, and prevent late-night cramming.
- **Multimodal Proof Processing**: Creators can upload screenshot image proofs directly from mobile health apps, GitHub dashboards, or calendar events.
- **Community Consensus Overrides**: For stakes choosing "Community Vote" verification, the platform tracks individual voter actions and auto-resolves when a 60% supermajority is established across minimum voters.

---

## 🛡️ Powered by Google Technologies

StakePad utilizes **Google Cloud Run** and Google's flagship **Gemini AI models** to drive intelligent platform services:
- **`@google/genai` TypeScript SDK**: Integrates server-side interactions with the state-of-the-art `gemini-3.5-flash` model.
- **Firebase Authentication & Google Integration**: Supports secure sign-in with Google to obtain read-only Google Calendar permissions, enabling secure event imports.
- **Multimodal Visual Diagnostics**: Translates base64-encoded image proof buffers directly to the Gemini API for visual inspection of screenshots (e.g., verifying running app distances or registration receipts).
- **Structured JSON Mode**: Configures model responses using strict `responseMimeType: "application/json"` formats, mapping system prompts to precise frontend schemas.
- **Graceful Error Fallbacks**: When Gemini API parameters or keys are absent or restricted, the platform automatically drops into a highly stable offline fallback logic (maintaining keyword blocklists, local scoring algorithms, and static motivator copy) to ensure uninterrupted service.

---

## 🎨 Editorial Design & UX Strategy

StakePad's interface is crafted with a high-fidelity **newspaper editorial style**:
- **Color Palette**: High-contrast, warm, organic tones (`#F5F0E8` off-white paper canvas, deep `#1A1209` charcoal ink, and distinct `#D64000` vermilion accent lines).
- **Typography Pairings**: Classic serif `Playfair Display` for bold display headings, paired with `DM Sans` for readable UI panels and `DM Mono` for numerical values and technical metrics.
- **Micro-Animations**: Features custom CSS-animated live status indicators, smooth modal slide transitions, responsive sliders, and canvas-based sparkline charts mapping odds variations over time.

---

## 🛠️ Technical Implementation details

- **Full-Stack Architecture**: Clean client-side layout powered by a high-performance, single-instance Express proxy backend binding on port `3000`.
- **Server Bundling**: Custom `esbuild` build script configuration compiles the backend TypeScript server into a streamlined `dist/server.cjs` bundle, safely resolving ES Module constraints for fast container execution.
- **Robust Verification Pipeline**: Handled via clean static linter validation checking (`tsc --noEmit`), with comprehensive error logs and zero runtime type-casting anomalies.

---

## 🚀 Completeness & Quick-Start Guide

### Prerequisites
- Node.js installed locally.

### Installation & Run Instructions
1. Clone the repository and install all node packages:
   ```bash
   npm install
   ```
2. Place your Google API Key inside a `.env` file at the project root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Boot up the full-stack development workspace:
   ```bash
   npm run dev
   ```
4. Access the web interface at `http://localhost:3000`.

## A note on the stack

StakePad was originally architected as a Python/FastAPI backend — a five-agent 
system (moderation, scoring, verification, narrative, coaching) using the Gemini 
API for multimodal proof verification (text, GitHub links, images).

For submission/deployment, the project went through Google AI Studio's publishing 
pipeline, which required a TypeScript/Node/Vite structure to deploy on Cloud Run. 
The live deployment reflects that conversion — the original agent architecture 
and logic were preserved, but the implementation language changed for hosting 
compatibility.
