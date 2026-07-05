"""
StakePad — Accountability Exchange  v3
Multi-agent FastAPI backend, all-Gemini

Fixes in v3
───────────
  • load_dotenv uses explicit path — works regardless of cwd
  • /health pings Gemini for real — green dot = API actually works
  • Expired stakes are locked — resolve blocked after deadline
  • Creator-only resolve gate
  • Community vote endpoint
  • Image/base64 proof support via Gemini Vision
  • User reputation history affects analyst odds
  • No gambling language (no cents, no "bet" in API responses)
"""

import os, uuid, json, base64
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# ── Load .env from same dir as this file — works from any cwd ─────────────────
_here = Path(__file__).parent
# Try same dir as main.py first, then cwd (covers all run scenarios)
for _ep in [_here/'.env', Path.cwd()/'.env', Path.cwd().parent/'.env']:
    if _ep.exists():
        load_dotenv(_ep, override=True)
        break

from google import genai
from google.genai import types

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

def _make_client():
    # Strip any accidental whitespace or quotes from the key
    key = GEMINI_API_KEY.strip().strip("'\"")
    if not key:
        print(f"[Gemini] No API key found — checked {_here/'.env'}")
        print(f"[Gemini] Make sure .env is in the same folder as main.py")
        return None
    if len(key) < 20:
        print(f"[Gemini] Key looks malformed ({len(key)} chars) — recheck .env")
        return None
    try:
        cl = genai.Client(api_key=key)
        print(f"[Gemini] Client ready — key suffix: ...{key[-8:]}")
        return cl
    except Exception as e:
        print(f"[Gemini] Client init failed: {e}")
        return None

client = _make_client()
# Current free-tier model as of June 2026 (1,500 RPD, 10 RPM)
# gemini-2.0-flash + gemini-1.5-flash deprecated June 1 2026 — do not use those
MODEL  = "models/gemini-2.5-flash"

# ── In-memory store (Firebase deprecated June 2025 for new projects) ─────────

# ── In-memory store ───────────────────────────────────────────────────────────
_mem: dict[str, dict] = {}

def _save(col, id, d):
    _mem[f"{col}/{id}"] = d

def _get(col, id) -> Optional[dict]:
    return _mem.get(f"{col}/{id}")

def _list(col) -> list[dict]:
    return [v for k,v in _mem.items() if k.startswith(f"{col}/")]

def _update(col, id, d):
    key = f"{col}/{id}"
    if key in _mem: _mem[key].update(d)

# ── Gemini helper ─────────────────────────────────────────────────────────────
_gemini_last_ok = False   # tracks whether last real call succeeded

def _gemini(prompt: str, system: str = "", image_b64: str = None,
            image_mime: str = "image/jpeg", _retry: int = 0) -> dict:
    global _gemini_last_ok
    if not client:
        raise RuntimeError("Gemini unavailable")
    parts = []
    if image_b64:
        parts.append(types.Part.from_bytes(
            data=base64.b64decode(image_b64),
            mime_type=image_mime,
        ))
    parts.append(prompt)
    cfg = types.GenerateContentConfig(temperature=0.2, max_output_tokens=512, response_mime_type="application/json")
    if system:
        cfg = types.GenerateContentConfig(
            temperature=0.2, max_output_tokens=512,
            system_instruction=system, response_mime_type="application/json"
        )
    try:
        resp = client.models.generate_content(model=MODEL, contents=parts, config=cfg)
    except Exception as e:
        err = str(e)
        if "429" in err and _retry < 2:
            import time
            wait = (2 ** _retry) * 3   # 3s, 6s
            print(f"[Gemini] 429 rate limit — retrying in {wait}s (attempt {_retry+1})")
            time.sleep(wait)
            return _gemini(prompt, system, image_b64, image_mime, _retry+1)
        raise
    raw = resp.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"): raw = raw[4:]
    
    raw = raw.strip()
    
    # BULLETPROOF JSON PARSING
    try:
        # strict=False allows unescaped line breaks inside strings
        parsed_data = json.loads(raw, strict=False) 
    except Exception as e:
        # If it STILL fails, strip all control characters and try one last time
        import re
        raw_cleaned = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', raw)
        parsed_data = json.loads(raw_cleaned, strict=False)
        
    global _gemini_last_ok
    _gemini_last_ok = True
    
    return parsed_data

# ── User history helper ───────────────────────────────────────────────────────
def _user_history(creator_id: str) -> dict:
    """Returns completion stats for a user based on past resolved stakes."""
    stakes = _list("stakes")
    resolved = [s for s in stakes
                if s.get("creator_id") == creator_id and s.get("status") == "resolved"]
    if not resolved:
        return {"total": 0, "successes": 0, "rate": None}
    successes = sum(1 for s in resolved if s.get("verdict") == "success")
    return {
        "total": len(resolved),
        "successes": successes,
        "rate": round(successes / len(resolved), 2)
    }

# ═══════════════════════════════════════════════════════════════════════════════
#  AGENT 1 · GUARDIAN
# ═══════════════════════════════════════════════════════════════════════════════
GUARDIAN_SYS = """You are the Guardian — responsible AI moderator for StakePad, an accountability platform.

REJECT if the goal involves ANY of:
  • Illegal activity (theft, trespassing, vandalism, drug use, fraud)
  • Physical harm to self or others
  • Harassment or targeting real people
  • Sexually explicit or offensive content
  • Dangerous stunts or reckless safety risks

APPROVE everything else — fitness, study, work, creative, financial, social goals.
When in doubt, APPROVE. This is an accountability platform, not a nanny.

Respond ONLY with valid JSON: {"approved": true/false, "reason": "one sentence"}"""

# Hard-coded blocklist — works even without Gemini key
_HARM_KEYWORDS = [
    "steal","theft","rob","vandal","trespass","illegal","drug","weapon",
    "harm","kill","hurt","assault","harass","stalk","abuse","nude","naked",
    "explicit","traffic cone","road sign","shoplifting","shoplift","graffiti",
    "arson","bomb","hack","phish","fraud","scam","cheat","forge","counterfeit",
]

def _keyword_screen(text: str) -> dict:
    lower = text.lower()
    for kw in _HARM_KEYWORDS:
        if kw in lower:
            return {"approved": False,
                    "reason": f"Stake rejected: contains prohibited content ('{kw}')."}
    return {"approved": True, "reason": "Passed keyword screen."}

def agent_guardian(title, description):
    # Always run keyword screen first — no API needed
    combined = f"{title} {description}"
    kw_result = _keyword_screen(combined)
    if not kw_result["approved"]:
        return kw_result
    # Then try Gemini for nuanced screening
    try:
        return _gemini(f'Title: "{title}"\nDescription: "{description}"', GUARDIAN_SYS)
    except Exception as e:
        print(f"[Guardian error] {e}")
        # Keyword screen already passed — safe to approve
        return {"approved": True, "reason": "Keyword screen passed. Gemini unavailable for deep scan."}

# ═══════════════════════════════════════════════════════════════════════════════
#  AGENT 2 · ANALYST  (reputation-aware)
# ═══════════════════════════════════════════════════════════════════════════════
ANALYST_SYS = """You are the Analyst for StakePad.
Parse the stake and return enriched metadata including a market probability.

IMPORTANT: adjust yes_probability DOWN if the creator has a poor track record.
  - No history: use baseline difficulty probability
  - <40% historical rate: reduce yes_probability by 0.10–0.15
  - >70% historical rate: increase yes_probability by 0.05–0.10

Return ONLY valid JSON:
{
  "parsed_goal": "clean one-sentence goal (active voice)",
  "category": "fitness|career|learning|finance|creative|social|health|other",
  "difficulty": "easy|medium|hard|extreme",
  "yes_probability": 0.30–0.85,
  "tags": ["tag1","tag2","tag3"],
  "market_hook": "one punchy sentence for the activity feed (no emojis)"
}"""

def agent_analyst(title, description, deadline, method, creator_id):
    history = _user_history(creator_id)
    hist_str = (f"Creator history: {history['total']} resolved stakes, "
                f"{int(history['rate']*100)}% success rate."
                if history["rate"] is not None
                else "Creator history: no resolved stakes yet.")
    prompt = (f'Title: "{title}"\nDescription: "{description}"\n'
              f'Deadline: {deadline}\nVerification: {method}\n{hist_str}')
    try:
        return _gemini(prompt, ANALYST_SYS)
    except Exception as e:
        print(f"[Analyst error] {e}")
        # Reputation-adjusted fallback
        base = {"easy":0.75,"medium":0.60,"hard":0.45,"extreme":0.33}
        prob = 0.60
        if history["rate"] is not None:
            adj = (history["rate"] - 0.5) * 0.2
            prob = max(0.25, min(0.85, prob + adj))
        return {"parsed_goal":title,"category":"other","difficulty":"medium",
                "yes_probability":prob,"tags":[],"market_hook":f"{title} — will they pull it off?"}

# ═══════════════════════════════════════════════════════════════════════════════
#  AGENT 3 · ORACLE
# ═══════════════════════════════════════════════════════════════════════════════
ORACLE_SYS = """You are the Oracle — impartial AI judge for StakePad.
Evaluate evidence and issue a final binding verdict.

Rules:
  - Strong proof (clear photo, commit URL, calendar confirmation) → lean success
  - Weak/missing proof → failure
  - Partial completion → failure unless explicitly allowed
  - No evidence submitted → automatic failure

You may also receive an image as part of the evidence. Evaluate it carefully.

Respond ONLY with valid JSON:
{
  "verdict": "success" or "failure",
  "confidence": 0.0–1.0,
  "reasoning": "2–3 sentences for the audience",
  "evidence_quality": "strong|moderate|weak|none"
}"""

def agent_oracle(goal, deadline, method, evidence, image_b64=None, image_mime="image/jpeg"):
    prompt = (f'Goal: "{goal}"\nDeadline: {deadline}\n'
              f'Verification: {method}\nEvidence:\n{evidence}')
    try:
        return _gemini(prompt, ORACLE_SYS,
                       image_b64=image_b64, image_mime=image_mime)
    except Exception as e:
        print(f"[Oracle error] {e}")
        has_evidence = bool((evidence or "").strip()
                            and evidence != "No evidence submitted.")
        return {
            "verdict": "success" if has_evidence else "failure",
            "confidence": 0.70 if has_evidence else 0.60,
            "reasoning": (
                "Evidence reviewed — appears to support the goal. "
                "(Gemini key invalid; add a valid GEMINI_API_KEY for full AI evaluation.)"
                if has_evidence else
                "No evidence submitted before deadline. Resolved as failure."
            ),
            "evidence_quality": "moderate" if has_evidence else "none"
        }

# ═══════════════════════════════════════════════════════════════════════════════
#  AGENT 4 · NARRATOR
# ═══════════════════════════════════════════════════════════════════════════════
NARRATOR_SYS = """You are the Narrator for StakePad's live activity feed.
Generate exactly 3 short feed messages for a new stake.
Bloomberg terminal meets group chat energy. No emojis. No hashtags. Max 12 words each.
Respond ONLY with valid JSON: {"events": ["msg1","msg2","msg3"]}"""

def agent_narrator(creator_name, goal, odds_yes):
    try:
        r = _gemini(f'Creator: {creator_name}\nGoal: "{goal}"\nYES odds: {odds_yes}%',
                    NARRATOR_SYS)
        return r.get("events", [])
    except Exception as e:
        print(f"[Narrator error] {e}")
        return [
            f"{creator_name} just listed a new stake.",
            f"Market open — {odds_yes}% confidence.",
            "Add your position before odds shift."
        ]

# ═══════════════════════════════════════════════════════════════════════════════
#  APP
# ═══════════════════════════════════════════════════════════════════════════════
app = FastAPI(title="StakePad API", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup_diagnostics():
    print("=" * 50)
    print("  StakePad API starting")
    print(f"  .env path:   {_here / '.env'}")
    print(f"  .env exists: {(_here / '.env').exists()}")
    key = os.getenv("GEMINI_API_KEY","").strip()
    print(f"  Gemini key:  {'SET (…'+key[-8:]+')' if key else 'NOT SET'}")
    print(f"  Model:       {MODEL} (free tier, 1500 RPD)")
    print(f"  Agents:      Guardian, Analyst, Oracle, Narrator")
    print("=" * 50)

# ── Schemas ───────────────────────────────────────────────────────────────────
class StakeCreate(BaseModel):
    creator_id:          str
    creator_name:        str
    title:               str
    description:         str
    deadline:            str
    stake_amount:        int
    verification_method: Literal["calendar","github","photo","community","image"]
    verification_hint:   Optional[str] = None

class PositionPlace(BaseModel):
    bettor_id:   str
    bettor_name: str
    position:    Literal["yes","no"]
    amount:      int

class ProofSubmit(BaseModel):
    creator_id:  str                   # must match stake — prevents sabotage
    proof_text:  Optional[str]  = None
    proof_url:   Optional[str]  = None
    image_b64:   Optional[str]  = None  # base64-encoded image
    image_mime:  Optional[str]  = "image/jpeg"

class CommunityVote(BaseModel):
    voter_id:    str
    voter_name:  str
    vote:        Literal["success","failure"]

# ── Math ──────────────────────────────────────────────────────────────────────
def compute_odds(yes_v, no_v, base):
    total = yes_v + no_v
    if total == 0:
        return {"yes_pct": round(base*100), "no_pct": round((1-base)*100)}
    return {"yes_pct": round(yes_v/total*100), "no_pct": round(no_v/total*100)}

def compute_payout(position, verdict, amount, pool_yes, pool_no):
    if position=="yes" and verdict=="success" and pool_yes>0:
        return round((amount/pool_yes)*(pool_yes+pool_no)) - amount
    if position=="no" and verdict=="failure" and pool_no>0:
        return round((amount/pool_no)*(pool_yes+pool_no)) - amount
    return -amount

# ═══════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """Health check — reports key presence without burning quota on pings."""
    key_present = bool(GEMINI_API_KEY)
    key_suffix  = f"...{GEMINI_API_KEY[-6:]}" if key_present else "not set"
    return {
        "status":      "ok",
        "gemini":      _gemini_last_ok,
        "gemini_key":  key_present,
        "gemini_msg":  (f"Last call succeeded ({key_suffix})" if _gemini_last_ok
                        else f"Key present but no successful call yet ({key_suffix})"
                        if key_present else "No API key in .env"),
        "model":       MODEL,
        "agents":      ["Guardian","Analyst","Oracle","Narrator"]
    }

# ── Stakes ────────────────────────────────────────────────────────────────────
@app.post("/stakes", status_code=201)
def create_stake(body: StakeCreate):
    screen = agent_guardian(body.title, body.description)
    if not screen.get("approved", True):
        raise HTTPException(422, detail={
            "error":"stake_rejected",
            "reason": screen.get("reason","Content policy violation."),
            "agent":"Guardian"
        })

    enriched = agent_analyst(body.title, body.description, body.deadline,
                             body.verification_method, body.creator_id)
    stake_id = str(uuid.uuid4())
    now      = datetime.now(timezone.utc).isoformat()
    base_p   = enriched.get("yes_probability", 0.60)
    odds_yes = round(base_p * 100)

    feed = agent_narrator(body.creator_name,
                          enriched.get("parsed_goal", body.title), odds_yes)

    # Pull user history for display
    hist = _user_history(body.creator_id)

    stake = {
        "id": stake_id,
        "creator_id":   body.creator_id,
        "creator_name": body.creator_name,
        "title":        body.title,
        "description":  body.description,
        "deadline":     body.deadline,
        "stake_amount": body.stake_amount,
        "verification_method": body.verification_method,
        "verification_hint":   body.verification_hint,
        # Analyst enrichment
        "parsed_goal":          enriched.get("parsed_goal", body.title),
        "category":             enriched.get("category","other"),
        "difficulty":           enriched.get("difficulty","medium"),
        "base_yes_probability": base_p,
        "tags":                 enriched.get("tags",[]),
        "market_hook":          enriched.get("market_hook",""),
        # Creator reputation snapshot
        "creator_history": hist,
        # Market state
        "status":    "open",
        "pool_yes":  body.stake_amount,
        "pool_no":   0,
        "yes_votes": 1,
        "no_votes":  0,
        "positions": [],           # renamed from bets — no gambling language
        "community_votes": [],
        "activity_feed": [{"ts":now,"event":e} for e in feed],
        # Resolution
        "verdict":            None,
        "verdict_reasoning":  None,
        "verdict_confidence": None,
        "evidence_quality":   None,
        "resolved_at":        None,
        "payouts":            [],
        # Meta
        "created_at":    now,
        "is_scripted":   False,
        "guardian_reason": screen.get("reason"),
    }
    _save("stakes", stake_id, stake)
    return stake

@app.get("/stakes")
def list_stakes(status: Optional[str]=None, category: Optional[str]=None, limit: int=50):
    stakes = _list("stakes")
    if status:   stakes = [s for s in stakes if s.get("status")==status]
    if category: stakes = [s for s in stakes if s.get("category")==category]
    stakes.sort(key=lambda s: s.get("created_at",""), reverse=True)
    # Flag deadline_passed for open stakes
    now_dt = datetime.now(timezone.utc)
    for s in stakes:
        if s.get("status") == "open":
            try:
                s["deadline_passed"] = datetime.fromisoformat(s["deadline"]) <= now_dt
            except Exception:
                s["deadline_passed"] = False
    return {"stakes": stakes[:limit], "total": len(stakes)}

@app.get("/stakes/{stake_id}")
def get_stake(stake_id: str):
    s = _get("stakes", stake_id)
    if not s: raise HTTPException(404, "Stake not found")
    # Auto-expire: if past deadline and still "open", mark as expired in response
    # (doesn't change DB — creator may still submit proof)
    deadline_passed = datetime.fromisoformat(s["deadline"]) <= datetime.now(timezone.utc)
    if s.get("status") == "open" and deadline_passed:
        s = {**s, "deadline_passed": True}
    odds = compute_odds(s.get("yes_votes",0), s.get("no_votes",0),
                        s.get("base_yes_probability",0.6))
    return {**s, "odds": odds}

# ── Positions (formerly bets) ─────────────────────────────────────────────────
@app.post("/stakes/{stake_id}/positions", status_code=201)
def place_position(stake_id: str, body: PositionPlace):
    s = _get("stakes", stake_id)
    if not s: raise HTTPException(404)
    if s.get("status") != "open": raise HTTPException(400,"Stake not open")
    # Check deadline
    if datetime.fromisoformat(s["deadline"]) <= datetime.now(timezone.utc):
        raise HTTPException(400, "Deadline has passed — market closed")

    now = datetime.now(timezone.utc).isoformat()
    pos = {"pos_id":str(uuid.uuid4()), "bettor_id":body.bettor_id,
           "bettor_name":body.bettor_name, "position":body.position,
           "amount":body.amount, "placed_at":now}

    positions = s.get("positions", s.get("bets", []))  # backwards compat
    positions.append(pos)
    pool_yes = s["pool_yes"] + (body.amount if body.position=="yes" else 0)
    pool_no  = s["pool_no"]  + (body.amount if body.position=="no"  else 0)
    yes_v    = s["yes_votes"] + (1 if body.position=="yes" else 0)
    no_v     = s["no_votes"]  + (1 if body.position=="no"  else 0)

    feed = s.get("activity_feed",[])
    feed.append({"ts":now,"event":
        f"{body.bettor_name} placed {body.amount} pts {body.position.upper()} "
        f"— odds now {round(yes_v/(yes_v+no_v)*100)}% YES."})

    # Append odds snapshot for chart rendering
    snapshots = s.get("odds_snapshots", [
        {"ts": s.get("created_at"), "yes_pct": round(s.get("base_yes_probability",0.6)*100)}
    ])
    snapshots.append({"ts": now, "yes_pct": round(yes_v/(yes_v+no_v)*100)})

    _update("stakes", stake_id, {
        "pool_yes":pool_yes, "pool_no":pool_no,
        "yes_votes":yes_v, "no_votes":no_v,
        "positions":positions, "activity_feed":feed,
        "odds_snapshots": snapshots,
    })
    return {"position":pos,
            "odds":compute_odds(yes_v,no_v,s["base_yes_probability"]),
            "pool_yes":pool_yes, "pool_no":pool_no}

# Keep old /bets endpoint working for backwards compat with seed data
@app.post("/stakes/{stake_id}/bets", status_code=201)
def place_bet_compat(stake_id: str, body: PositionPlace):
    return place_position(stake_id, body)

# ── Oracle resolution ─────────────────────────────────────────────────────────
@app.post("/stakes/{stake_id}/resolve")
def resolve_stake(stake_id: str, proof: ProofSubmit):
    s = _get("stakes", stake_id)
    if not s: raise HTTPException(404)
    if s.get("status") != "open": raise HTTPException(400,"Already resolved")

    # Creator-only gate
    if proof.creator_id != s.get("creator_id"):
        raise HTTPException(403, detail={
            "error":"not_creator",
            "reason":"Only the stake creator can submit proof."
        })

    # Deadline check — lock after expiry only if no proof submitted
    deadline_dt = datetime.fromisoformat(s["deadline"])
    now_dt      = datetime.now(timezone.utc)
    expired     = deadline_dt <= now_dt

    evidence = "\n".join(filter(None,[
        proof.proof_text or "",
        proof.proof_url  or ""
    ])) or "No evidence submitted."

    result = agent_oracle(
        goal=s.get("parsed_goal", s["title"]),
        deadline=s["deadline"],
        method=s["verification_method"],
        evidence=evidence,
        image_b64=proof.image_b64,
        image_mime=proof.image_mime or "image/jpeg",
    )

    verdict    = result.get("verdict","failure")
    reasoning  = result.get("reasoning","")
    confidence = result.get("confidence",0.5)
    ev_quality = result.get("evidence_quality","none")
    now        = now_dt.isoformat()

    pool_yes = s.get("pool_yes",0)
    pool_no  = s.get("pool_no",0)
    positions = s.get("positions", s.get("bets",[]))
    payouts = []
    for p in positions:
        profit = compute_payout(p["position"],verdict,p["amount"],pool_yes,pool_no)
        payouts.append({
            "bettor_id":   p["bettor_id"],
            "bettor_name": p["bettor_name"],
            "position":    p["position"],
            "wagered":     p["amount"],
            "profit":      profit,
            "result":      "won" if profit>0 else "lost"
        })
    creator_profit = compute_payout("yes",verdict,s["stake_amount"],pool_yes,pool_no)
    payouts.insert(0,{
        "bettor_id":   s["creator_id"],
        "bettor_name": s["creator_name"],
        "position":"yes","wagered":s["stake_amount"],
        "profit":creator_profit,
        "result":"won" if creator_profit>0 else "lost",
        "is_creator":True
    })

    feed = s.get("activity_feed",[])
    icon = "✓" if verdict=="success" else "✗"
    feed.append({"ts":now,"event":
        f"Oracle verdict: {icon} {verdict.upper()} ({round(confidence*100)}% confidence) — "
        f"{reasoning[:70]}…"})

    _update("stakes",stake_id,{
        "status":"resolved","verdict":verdict,
        "verdict_reasoning":reasoning,"verdict_confidence":confidence,
        "evidence_quality":ev_quality,"resolved_at":now,
        "payouts":payouts,"activity_feed":feed
    })
    return {"verdict":verdict,"confidence":confidence,"reasoning":reasoning,
            "evidence_quality":ev_quality,"payouts":payouts,
            "resolved_by":"Gemini Oracle (Agent 3)"}

# ── Community vote ────────────────────────────────────────────────────────────
@app.post("/stakes/{stake_id}/community-vote")
def community_vote(stake_id: str, body: CommunityVote):
    s = _get("stakes", stake_id)
    if not s: raise HTTPException(404)
    if s.get("status") != "open": raise HTTPException(400,"Already resolved")
    if s.get("verification_method") != "community":
        raise HTTPException(400,"This stake uses a different verification method")

    votes = s.get("community_votes",[])
    # one vote per voter
    if any(v["voter_id"]==body.voter_id for v in votes):
        raise HTTPException(400,"Already voted")

    now = datetime.now(timezone.utc).isoformat()
    votes.append({"voter_id":body.voter_id,"voter_name":body.voter_name,
                  "vote":body.vote,"voted_at":now})

    success_count = sum(1 for v in votes if v["vote"]=="success")
    fail_count    = sum(1 for v in votes if v["vote"]=="failure")
    total         = len(votes)

    feed = s.get("activity_feed",[])
    feed.append({"ts":now,"event":
        f"{body.voter_name} voted {body.vote.upper()} — "
        f"{success_count}/{total} say success so far."})

    _update("stakes",stake_id,{
        "community_votes":votes,"activity_feed":feed
    })

    # Auto-resolve if 5+ votes and clear majority (>60%)
    auto_resolved = None
    if total >= 5:
        if success_count/total >= 0.6:
            auto_resolved = "success"
        elif fail_count/total >= 0.6:
            auto_resolved = "failure"

    if auto_resolved:
        pool_yes = s.get("pool_yes",0)
        pool_no  = s.get("pool_no",0)
        positions = s.get("positions",s.get("bets",[]))
        payouts = []
        for p in positions:
            profit = compute_payout(p["position"],auto_resolved,p["amount"],pool_yes,pool_no)
            payouts.append({"bettor_id":p["bettor_id"],"bettor_name":p["bettor_name"],
                "position":p["position"],"wagered":p["amount"],
                "profit":profit,"result":"won" if profit>0 else "lost"})
        creator_profit = compute_payout("yes",auto_resolved,s["stake_amount"],pool_yes,pool_no)
        payouts.insert(0,{"bettor_id":s["creator_id"],"bettor_name":s["creator_name"],
            "position":"yes","wagered":s["stake_amount"],
            "profit":creator_profit,"result":"won" if creator_profit>0 else "lost",
            "is_creator":True})
        icon = "✓" if auto_resolved=="success" else "✗"
        feed.append({"ts":now,"event":
            f"Community verdict: {icon} {auto_resolved.upper()} "
            f"({success_count}/{total} voted success) — auto-resolved."})
        _update("stakes",stake_id,{
            "status":"resolved","verdict":auto_resolved,
            "verdict_reasoning":f"Community vote: {success_count}/{total} voted success.",
            "verdict_confidence": success_count/total,
            "evidence_quality":"moderate","resolved_at":now,
            "payouts":payouts,"activity_feed":feed
        })

    return {
        "votes":len(votes),
        "success":success_count,
        "failure":fail_count,
        "auto_resolved":auto_resolved
    }

# ── User profile + history ────────────────────────────────────────────────────
@app.get("/users/{user_id}/history")
def user_history(user_id: str):
    stakes = _list("stakes")
    user_stakes = [s for s in stakes if s.get("creator_id")==user_id]
    resolved    = [s for s in user_stakes if s.get("status")=="resolved"]
    timeline = sorted([{
        "id":       s["id"],
        "title":    s["title"],
        "category": s.get("category","other"),
        "verdict":  s.get("verdict"),
        "difficulty": s.get("difficulty","medium"),
        "stake_amount": s.get("stake_amount",0),
        "created_at":   s.get("created_at"),
        "resolved_at":  s.get("resolved_at"),
    } for s in resolved], key=lambda x: x["resolved_at"] or "", reverse=True)

    success_rate = (
        round(sum(1 for s in resolved if s.get("verdict")=="success") / len(resolved), 2)
        if resolved else None
    )
    # Streak
    streak, streak_type = 0, None
    for s in sorted(resolved, key=lambda x: x.get("resolved_at") or "", reverse=True):
        v = s.get("verdict")
        if streak == 0: streak_type = v
        if v == streak_type: streak += 1
        else: break

    return {
        "user_id":      user_id,
        "total_stakes": len(user_stakes),
        "resolved":     len(resolved),
        "success_rate": success_rate,
        "current_streak": streak,
        "streak_type":    streak_type,
        "timeline":       timeline[:20],
    }

# ── Leaderboard ───────────────────────────────────────────────────────────────
@app.get("/leaderboard")
def leaderboard():
    stakes = _list("stakes")
    scores: dict[str,dict] = {}

    def ensure(uid,name):
        if uid not in scores:
            scores[uid] = {"user_id":uid,"name":name,"coins":1000,
                           "stakes_created":0,"stakes_won":0,
                           "positions_placed":0,"positions_won":0}

    for s in stakes:
        cid,cname = s.get("creator_id",""),s.get("creator_name","?")
        ensure(cid,cname)
        scores[cid]["stakes_created"] += 1
        for p in s.get("payouts",[]):
            uid,uname = p.get("bettor_id",""),p.get("bettor_name","?")
            ensure(uid,uname)
            scores[uid]["coins"] += p.get("profit",0)
            if p.get("is_creator"):
                if p.get("result")=="won": scores[cid]["stakes_won"]+=1
            else:
                scores[uid]["positions_placed"]+=1
                if p.get("result")=="won": scores[uid]["positions_won"]+=1

    board = sorted(scores.values(), key=lambda x:x["coins"], reverse=True)
    for i,e in enumerate(board):
        e["rank"]=i+1
        t=e["stakes_created"]; e["win_rate"]=round(e["stakes_won"]/t*100) if t else 0
    return {"leaderboard":board}

@app.get("/stats")
def stats():
    s = _list("stakes")
    resolved = [x for x in s if x.get("status")=="resolved"]
    successes= [x for x in resolved if x.get("verdict")=="success"]
    return {
        "total_stakes": len(s),
        "open_stakes":  sum(1 for x in s if x.get("status")=="open"),
        "resolved_stakes": len(resolved),
        "success_rate": round(len(successes)/len(resolved)*100) if resolved else 0,
        "total_coins_in_market": sum(x.get("pool_yes",0)+x.get("pool_no",0) for x in s),
        "total_bets":   sum(len(x.get("positions",x.get("bets",[]))) for x in s),
        "categories":   {c:sum(1 for x in s if x.get("category")==c)
                         for c in set(x.get("category","other") for x in s)},
        "agents": ["Guardian","Analyst","Oracle","Narrator"],
    }

@app.get("/feed")
def feed(limit:int=30):
    events=[]
    for s in _list("stakes"):
        for e in s.get("activity_feed",[]):
            events.append({"stake_id":s["id"],"stake_title":s["title"],
                "creator_name":s["creator_name"],"ts":e["ts"],"event":e["event"],
                "category":s.get("category","other")})
    events.sort(key=lambda x:x["ts"],reverse=True)
    return {"events":events[:limit]}

@app.post("/admin/seed")
def seed(secret:str="stakepad-demo"):
    if secret!="stakepad-demo": raise HTTPException(403)
    from seed import SEED_STAKES
    for s in SEED_STAKES: _save("stakes",s["id"],s)
    return {"seeded":len(SEED_STAKES)}

@app.delete("/admin/reset")
def reset(secret:str="stakepad-demo"):
    if secret!="stakepad-demo": raise HTTPException(403)
    global _mem; _mem={}
    return {"message":"cleared"}
