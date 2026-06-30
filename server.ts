import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { getSeedStakes } from "./src/seed.js";
import {
  agentGuardian,
  agentAnalyst,
  agentOracle,
  agentNarrator,
  agentPepTalk,
  getGeminiStatus
} from "./src/gemini.js";

// Global in-memory stakes store pre-populated with seed data
let stakes: any[] = [];
try {
  stakes = getSeedStakes();
} catch (error) {
  console.error("Failed to load seed stakes on startup", error);
}

// Math & Odds calculation helpers
function computeOdds(yesV: number, noV: number, base: number) {
  const W = 5;
  const yesPrior = base * W;
  const noPrior = (1 - base) * W;
  const total = W + yesV + noV;
  return {
    yes_pct: Math.round(((yesPrior + yesV) / total) * 100),
    no_pct: Math.round(((noPrior + noV) / total) * 100)
  };
}

function computePayout(
  position: string,
  verdict: string,
  amount: number,
  poolYes: number,
  poolNo: number
) {
  if (position === "yes" && verdict === "success" && poolYes > 0) {
    return Math.round((amount / poolYes) * (poolYes + poolNo)) - amount;
  }
  if (position === "no" && verdict === "failure" && poolNo > 0) {
    return Math.round((amount / poolNo) * (poolYes + poolNo)) - amount;
  }
  return -amount;
}

function getUserHistory(creatorId: string) {
  const userStakes = stakes.filter((s) => s.creator_id === creatorId);
  const resolved = userStakes.filter((s) => s.status === "resolved");
  if (resolved.length === 0) {
    return { total: 0, successes: 0, rate: null };
  }
  const successes = resolved.filter((s) => s.verdict === "success").length;
  return {
    total: resolved.length,
    successes,
    rate: Math.round((successes / resolved.length) * 100) / 100
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to support base64 image proof uploads and json payloads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // 1. HEALTH CHECK
  app.get("/health", (req, res) => {
    const status = getGeminiStatus();
    res.json({
      status: "ok",
      gemini: status.live,
      gemini_error: status.error,
      timestamp: new Date().toISOString()
    });
  });

  // 2. LIST STAKES
  app.get("/stakes", (req, res) => {
    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;
    const limit = parseInt((req.query.limit as string) || "50", 10);

    let filtered = [...stakes];
    if (status) {
      filtered = filtered.filter((s) => s.status === status);
    }
    if (category) {
      filtered = filtered.filter((s) => s.category === category);
    }

    // Sort descending by created_at
    filtered.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    const now = new Date();
    const result = filtered.map((s) => {
      const deadlinePassed = s.deadline ? new Date(s.deadline) <= now : false;
      const odds = computeOdds(
        s.yes_votes || 0,
        s.no_votes || 0,
        s.base_yes_probability || 0.6
      );
      return {
        ...s,
        deadline_passed: deadlinePassed,
        odds
      };
    });

    res.json({ stakes: result.slice(0, limit), total: stakes.length });
  });

  // 3. CREATE STAKE
  app.post("/stakes", async (req, res) => {
    const {
      creator_id,
      creator_name,
      title,
      description,
      deadline,
      stake_amount,
      verification_method,
      verification_hint
    } = req.body;

    if (!creator_id || !creator_name || !title || !description || !deadline || !stake_amount) {
      res.status(400).json({ detail: "Missing required fields." });
      return;
    }

    // A. Guardian AI Screening
    const screen = await agentGuardian(title, description);
    if (!screen.approved) {
      res.status(400).json({
        detail: {
          error: "guardian_rejected",
          reason: screen.reason
        }
      });
      return;
    }

    // B. Get creator's reputation stats for the Analyst
    const hist = getUserHistory(creator_id);

    // C. Analyst AI Market enrichment
    const enriched = await agentAnalyst(
      title,
      description,
      deadline,
      verification_method || "photo",
      hist.rate,
      hist.total
    );

    const baseP = enriched.yes_probability || 0.6;
    const now = new Date().toISOString();

    // D. Narrator AI Activity generation
    const feedEvents = await agentNarrator(creator_name, title, Math.round(baseP * 100));

    const stakeId = `stake-${crypto.randomUUID()}`;
    const newStake = {
      id: stakeId,
      creator_id,
      creator_name,
      title,
      description,
      deadline,
      stake_amount: Number(stake_amount),
      verification_method: verification_method || "photo",
      verification_hint: verification_hint || null,
      parsed_goal: enriched.parsed_goal || title,
      category: enriched.category || "other",
      difficulty: enriched.difficulty || "medium",
      base_yes_probability: baseP,
      tags: enriched.tags || [],
      market_hook: enriched.market_hook || "",
      creator_history: hist,
      status: "open",
      pool_yes: Number(stake_amount),
      pool_no: 0,
      yes_votes: 0,
      no_votes: 0,
      positions: [],
      community_votes: [],
      activity_feed: feedEvents.map((e: string) => ({ ts: now, event: e })),
      verdict: null,
      verdict_reasoning: null,
      verdict_confidence: null,
      evidence_quality: null,
      resolved_at: null,
      payouts: [],
      created_at: now,
      is_scripted: false,
      guardian_reason: screen.reason,
      odds_snapshots: [{ ts: now, yes_pct: Math.round(baseP * 100) }]
    };

    stakes.push(newStake);
    res.status(201).json(newStake);
  });

  // 4. GET SINGLE STAKE
  app.get("/stakes/:stake_id", (req, res) => {
    const s = stakes.find((x) => x.id === req.params.stake_id);
    if (!s) {
      res.status(404).json({ detail: "Stake not found" });
      return;
    }

    const now = new Date();
    const deadlinePassed = s.deadline ? new Date(s.deadline) <= now : false;
    const updated = {
      ...s,
      deadline_passed: deadlinePassed
    };

    const odds = computeOdds(
      s.yes_votes || 0,
      s.no_votes || 0,
      s.base_yes_probability || 0.6
    );

    res.json({ ...updated, odds });
  });

  // 4b. GET PEP TALK / MOTIVATOR
  app.get("/stakes/:stake_id/peptalk", async (req, res) => {
    const s = stakes.find((x) => x.id === req.params.stake_id);
    if (!s) {
      res.status(404).json({ detail: "Stake not found" });
      return;
    }

    const odds = computeOdds(
      s.yes_votes || 0,
      s.no_votes || 0,
      s.base_yes_probability || 0.6
    );

    try {
      const pep = await agentPepTalk(s.title, s.description, odds.yes_pct, odds.no_pct);
      res.json(pep);
    } catch (err: any) {
      res.status(500).json({ detail: err.message || "Failed to generate pep talk" });
    }
  });

  // 5. PLACE POSITION
  app.post("/stakes/:stake_id/positions", (req, res) => {
    const { bettor_id, bettor_name, position, amount } = req.body;
    const stakeId = req.params.stake_id;

    const s = stakes.find((x) => x.id === stakeId);
    if (!s) {
      res.status(404).json({ detail: "Stake not found" });
      return;
    }

    if (s.status !== "open") {
      res.status(400).json({ detail: "Stake is not open" });
      return;
    }

    const now = new Date();
    const deadlinePassed = s.deadline ? new Date(s.deadline) <= now : false;
    if (deadlinePassed) {
      res.status(400).json({ detail: "Deadline has passed — market closed" });
      return;
    }

    if (!bettor_id || !bettor_name || !position || !amount) {
      res.status(400).json({ detail: "Missing parameter details" });
      return;
    }

    const posId = `pos-${crypto.randomUUID()}`;
    const newPos = {
      pos_id: posId,
      bettor_id,
      bettor_name,
      position,
      amount: Number(amount),
      placed_at: now.toISOString()
    };

    s.positions = s.positions || [];
    s.positions.push(newPos);

    s.pool_yes = (s.pool_yes || 0) + (position === "yes" ? Number(amount) : 0);
    s.pool_no = (s.pool_no || 0) + (position === "no" ? Number(amount) : 0);
    s.yes_votes = (s.yes_votes || 0) + (position === "yes" ? 1 : 0);
    s.no_votes = (s.no_votes || 0) + (position === "no" ? 1 : 0);

    const odds = computeOdds(s.yes_votes, s.no_votes, s.base_yes_probability || 0.6);
    const yesPct = odds.yes_pct;

    s.activity_feed = s.activity_feed || [];
    s.activity_feed.push({
      ts: now.toISOString(),
      event: `${bettor_name} placed ${amount} pts ${position.toUpperCase()} — odds now ${yesPct}% YES.`
    });

    s.odds_snapshots = s.odds_snapshots || [
      { ts: s.created_at, yes_pct: Math.round((s.base_yes_probability || 0.6) * 100) }
    ];
    s.odds_snapshots.push({
      ts: now.toISOString(),
      yes_pct: yesPct
    });

    res.status(201).json({
      position: newPos,
      odds: computeOdds(s.yes_votes, s.no_votes, s.base_yes_probability),
      pool_yes: s.pool_yes,
      pool_no: s.pool_no
    });
  });

  // BACKWARDS COMPATIBILITY FOR SEED BETS
  app.post("/stakes/:stake_id/bets", (req, res) => {
    res.redirect(307, `/stakes/${req.params.stake_id}/positions`);
  });

  // 6. RESOLVE STAKE via Oracle
  app.post("/stakes/:stake_id/resolve", async (req, res) => {
    const { creator_id, proof_text, proof_url, image_b64, image_mime } = req.body;
    const stakeId = req.params.stake_id;

    const s = stakes.find((x) => x.id === stakeId);
    if (!s) {
      res.status(404).json({ detail: "Stake not found" });
      return;
    }

    if (s.status !== "open") {
      res.status(400).json({ detail: "Already resolved" });
      return;
    }

    if (creator_id !== s.creator_id) {
      res.status(403).json({
        detail: {
          error: "not_creator",
          reason: "Only the stake creator can submit proof."
        }
      });
      return;
    }

    const evidenceParts = [];
    if (proof_text) evidenceParts.push(proof_text);
    if (proof_url) evidenceParts.push(proof_url);
    const evidence = evidenceParts.join("\n") || "No evidence submitted.";

    // Oracle agent evaluation
    const result = await agentOracle(
      s.parsed_goal || s.title,
      s.deadline,
      s.verification_method,
      evidence,
      image_b64 || null,
      image_mime || "image/jpeg"
    );

    const verdict = result.verdict || "failure";
    const reasoning = result.reasoning || "";
    const confidence = result.confidence || 0.5;
    const evQuality = result.evidence_quality || "none";
    const now = new Date().toISOString();

    const poolYes = s.pool_yes || 0;
    const poolNo = s.pool_no || 0;
    const positions = s.positions || [];

    const payouts = positions.map((p: any) => {
      const profit = computePayout(p.position, verdict, p.amount, poolYes, poolNo);
      return {
        bettor_id: p.bettor_id,
        bettor_name: p.bettor_name,
        position: p.position,
        wagered: p.amount,
        profit,
        result: profit > 0 ? "won" : "lost"
      };
    });

    const creatorProfit = computePayout("yes", verdict, s.stake_amount, poolYes, poolNo);
    payouts.unshift({
      bettor_id: s.creator_id,
      bettor_name: s.creator_name,
      position: "yes",
      wagered: s.stake_amount,
      profit: creatorProfit,
      result: creatorProfit > 0 ? "won" : "lost",
      is_creator: true
    });

    s.activity_feed = s.activity_feed || [];
    const icon = verdict === "success" ? "✓" : "✗";
    s.activity_feed.push({
      ts: now,
      event: `Oracle verdict: ${icon} ${verdict.toUpperCase()} (${Math.round(confidence * 100)}% confidence) — ${reasoning.slice(0, 70)}…`
    });

    s.status = "resolved";
    s.verdict = verdict;
    s.verdict_reasoning = reasoning;
    s.verdict_confidence = confidence;
    s.evidence_quality = evQuality;
    s.resolved_at = now;
    s.payouts = payouts;

    res.json({
      verdict,
      confidence,
      reasoning,
      evidence_quality: evQuality,
      payouts,
      resolved_by: "Gemini Oracle (Agent 3)"
    });
  });

  // 7. COMMUNITY VOTE RESOLUTION
  app.post("/stakes/:stake_id/community-vote", (req, res) => {
    const { voter_id, voter_name, vote } = req.body;
    const stakeId = req.params.stake_id;

    const s = stakes.find((x) => x.id === stakeId);
    if (!s) {
      res.status(404).json({ detail: "Stake not found" });
      return;
    }

    if (s.status !== "open") {
      res.status(400).json({ detail: "Already resolved" });
      return;
    }

    if (s.verification_method !== "community") {
      res.status(400).json({ detail: "This stake uses a different verification method" });
      return;
    }

    s.community_votes = s.community_votes || [];
    if (s.community_votes.some((v: any) => v.voter_id === voter_id)) {
      res.status(400).json({ detail: "Already voted" });
      return;
    }

    const now = new Date().toISOString();
    s.community_votes.push({
      voter_id,
      voter_name,
      vote,
      voted_at: now
    });

    const successCount = s.community_votes.filter((v: any) => v.vote === "success").length;
    const failCount = s.community_votes.filter((v: any) => v.vote === "failure").length;
    const total = s.community_votes.length;

    s.activity_feed = s.activity_feed || [];
    s.activity_feed.push({
      ts: now,
      event: `${voter_name} voted ${vote.toUpperCase()} — ${successCount}/${total} say success so far.`
    });

    let autoResolved: string | null = null;
    if (total >= 5) {
      if (successCount / total >= 0.6) {
        autoResolved = "success";
      } else if (failCount / total >= 0.6) {
        autoResolved = "failure";
      }
    }

    if (autoResolved) {
      const poolYes = s.pool_yes || 0;
      const poolNo = s.pool_no || 0;
      const positions = s.positions || [];

      const payouts = positions.map((p: any) => {
        const profit = computePayout(p.position, autoResolved!, p.amount, poolYes, poolNo);
        return {
          bettor_id: p.bettor_id,
          bettor_name: p.bettor_name,
          position: p.position,
          wagered: p.amount,
          profit,
          result: profit > 0 ? "won" : "lost"
        };
      });

      const creatorProfit = computePayout("yes", autoResolved, s.stake_amount, poolYes, poolNo);
      payouts.unshift({
        bettor_id: s.creator_id,
        bettor_name: s.creator_name,
        position: "yes",
        wagered: s.stake_amount,
        profit: creatorProfit,
        result: creatorProfit > 0 ? "won" : "lost",
        is_creator: true
      });

      const icon = autoResolved === "success" ? "✓" : "✗";
      s.activity_feed.push({
        ts: now,
        event: `Community verdict: ${icon} ${autoResolved.toUpperCase()} (${successCount}/${total} voted success) — auto-resolved.`
      });

      s.status = "resolved";
      s.verdict = autoResolved;
      s.verdict_reasoning = `Community vote: ${successCount}/${total} voted success.`;
      s.verdict_confidence = successCount / total;
      s.evidence_quality = "moderate";
      s.resolved_at = now;
      s.payouts = payouts;
    }

    res.json({
      votes: total,
      success: successCount,
      failure: failCount,
      auto_resolved: autoResolved
    });
  });

  // 8. USER HISTORY
  app.get("/users/:user_id/history", (req, res) => {
    const userId = req.params.user_id;
    const userStakes = stakes.filter((s) => s.creator_id === userId);
    const resolved = userStakes.filter((s) => s.status === "resolved");

    const timeline = resolved
      .map((s) => ({
        id: s.id,
        title: s.title,
        category: s.category || "other",
        verdict: s.verdict,
        difficulty: s.difficulty || "medium",
        stake_amount: s.stake_amount || 0,
        created_at: s.created_at,
        resolved_at: s.resolved_at
      }))
      .sort((a, b) => (b.resolved_at || "").localeCompare(a.resolved_at || ""));

    const successRate = resolved.length
      ? Math.round((resolved.filter((s) => s.verdict === "success").length / resolved.length) * 100) / 100
      : null;

    // Streak logic
    let streak = 0;
    let streakType: string | null = null;
    const sortedResolved = [...resolved].sort((a, b) => (b.resolved_at || "").localeCompare(a.resolved_at || ""));

    for (const s of sortedResolved) {
      const v = s.verdict;
      if (streak === 0) {
        streakType = v;
      }
      if (v === streakType) {
        streak += 1;
      } else {
        break;
      }
    }

    res.json({
      user_id: userId,
      total_stakes: userStakes.length,
      resolved: resolved.length,
      success_rate: successRate,
      current_streak: streak,
      streak_type: streakType,
      timeline: timeline.slice(0, 20)
    });
  });

  // 9. LEADERBOARD
  app.get("/leaderboard", (req, res) => {
    const scores: Record<string, any> = {};

    const ensure = (uid: string, name: string) => {
      if (!scores[uid]) {
        scores[uid] = {
          user_id: uid,
          name,
          coins: 1000,
          stakes_created: 0,
          stakes_won: 0,
          positions_placed: 0,
          positions_won: 0
        };
      }
    };

    for (const s of stakes) {
      const cid = s.creator_id || "";
      const cname = s.creator_name || "?";
      ensure(cid, cname);
      scores[cid].stakes_created += 1;

      for (const p of s.payouts || []) {
        const uid = p.bettor_id || "";
        const uname = p.bettor_name || "?";
        ensure(uid, uname);
        scores[uid].coins += p.profit || 0;

        if (p.is_creator) {
          if (p.result === "won") {
            scores[cid].stakes_won += 1;
          }
        } else {
          scores[uid].positions_placed += 1;
          if (p.result === "won") {
            scores[uid].positions_won += 1;
          }
        }
      }
    }

    const board = Object.values(scores).sort((a, b) => b.coins - a.coins);
    board.forEach((e: any, i: number) => {
      e.rank = i + 1;
      const t = e.stakes_created;
      e.win_rate = t ? Math.round((e.stakes_won / t) * 100) : 0;
    });

    res.json({ leaderboard: board });
  });

  // 10. STATS
  app.get("/stats", (req, res) => {
    const resolved = stakes.filter((x) => x.status === "resolved");
    const successes = resolved.filter((x) => x.verdict === "success");

    const categories: Record<string, number> = {};
    for (const x of stakes) {
      const c = x.category || "other";
      categories[c] = (categories[c] || 0) + 1;
    }

    res.json({
      total_stakes: stakes.length,
      open_stakes: stakes.filter((x) => x.status === "open").length,
      resolved_stakes: resolved.length,
      success_rate: resolved.length ? Math.round((successes.length / resolved.length) * 100) : 0,
      total_coins_in_market: stakes.reduce((acc, x) => acc + (x.pool_yes || 0) + (x.pool_no || 0), 0),
      total_bets: stakes.reduce((acc, x) => acc + (x.positions || []).length, 0),
      categories,
      agents: ["Guardian", "Analyst", "Oracle", "Narrator"]
    });
  });

  // 11. GLOBAL ACTIVITY FEED
  app.get("/feed", (req, res) => {
    const limit = parseInt((req.query.limit as string) || "30", 10);
    const events: any[] = [];

    for (const s of stakes) {
      for (const e of s.activity_feed || []) {
        events.push({
          stake_id: s.id,
          stake_title: s.title,
          creator_name: s.creator_name,
          ts: e.ts,
          event: e.event,
          category: s.category || "other"
        });
      }
    }

    // Sort descending by timestamp
    events.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

    res.json({ events: events.slice(0, limit) });
  });

  // 12. ADMIN DEMO SEEDING
  app.post("/admin/seed", (req, res) => {
    const secret = req.query.secret || req.body.secret;
    if (secret !== "stakepad-demo") {
      res.status(403).json({ detail: "Forbidden" });
      return;
    }
    try {
      stakes = getSeedStakes();
      res.json({ seeded: stakes.length });
    } catch (error: any) {
      res.status(500).json({ detail: error.message || String(error) });
    }
  });

  // 13. ADMIN RESET
  app.delete("/admin/reset", (req, res) => {
    const secret = req.query.secret || req.body.secret;
    if (secret !== "stakepad-demo") {
      res.status(403).json({ detail: "Forbidden" });
      return;
    }
    stakes = [];
    res.json({ message: "cleared" });
  });

  // Serve firebase client config securely to the client in both dev and prod
  app.get("/firebase-applet-config.json", (req, res) => {
    res.sendFile(path.join(process.cwd(), "firebase-applet-config.json"));
  });

  // Vite Asset serving and fallback middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
