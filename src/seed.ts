function buildSnapshots(baseProb: number, bets: any[], createdAt: string) {
  const snapshots = [{ ts: createdAt, yes_pct: Math.round(baseProb * 100) }];
  let yesV = 0;
  let noV = 0;
  const sortedBets = [...bets].sort((a, b) => (a.placed_at || "").localeCompare(b.placed_at || ""));
  for (const b of sortedBets) {
    if (b.position === "yes") {
      yesV += 1;
    } else {
      noV += 1;
    }
    const W = 5;
    const yesPrior = baseProb * W;
    const total = W + yesV + noV;
    snapshots.push({
      ts: b.placed_at,
      yes_pct: Math.round(((yesPrior + yesV) / total) * 100)
    });
  }
  return snapshots;
}

function ts(hoursAgo = 0) {
  return new Date(Date.now() - hoursAgo * 36e5).toISOString();
}

function deadline(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 36e5).toISOString();
}

export function getSeedStakes(): any[] {
  const stakes = [
    // 1. FITNESS
    {
      id: "seed-001",
      creator_id: "user-arjun",
      creator_name: "Arjun Mehta",
      title: "Run a 5K under 25 minutes this Sunday",
      description: "Training for 6 weeks. Sunday morning, Cubbon Park. GPS screenshot as proof.",
      deadline: deadline(52),
      stake_amount: 200,
      verification_method: "photo",
      verification_hint: "GPS running app screenshot",
      parsed_goal: "Complete a sub-25 minute 5K run by Sunday morning",
      category: "fitness",
      difficulty: "medium",
      base_yes_probability: 0.62,
      tags: ["running", "5K", "fitness", "weekend"],
      market_hook: "Six weeks of training on the line — this Sunday decides everything.",
      status: "open",
      pool_yes: 850,
      pool_no: 420,
      yes_votes: 7,
      no_votes: 4,
      bets: [
        { bet_id: "b001a", bettor_id: "user-priya", bettor_name: "Priya S.", position: "yes", amount: 150, placed_at: ts(10) },
        { bet_id: "b001b", bettor_id: "user-rohan", bettor_name: "Rohan K.", position: "no", amount: 200, placed_at: ts(8) },
        { bet_id: "b001c", bettor_id: "user-sneha", bettor_name: "Sneha T.", position: "yes", amount: 100, placed_at: ts(5) },
        { bet_id: "b001d", bettor_id: "user-dev", bettor_name: "Dev P.", position: "no", amount: 220, placed_at: ts(3) },
        { bet_id: "b001e", bettor_id: "user-karan", bettor_name: "Karan M.", position: "yes", amount: 300, placed_at: ts(1) }
      ],
      activity_feed: [
        { ts: ts(12), event: "Arjun Mehta just listed a new stake — 200 coins on the line." },
        { ts: ts(10), event: "Priya S. bet 150 coins YES — odds 67% YES." },
        { ts: ts(8), event: "Rohan K. bet 200 coins NO — someone's skeptical." },
        { ts: ts(6), event: "Odds shifting. Market now split 58/42." },
        { ts: ts(3), event: "Dev P. doubled down NO — 220 coins against Arjun." },
        { ts: ts(1), event: "Karan M. bet 300 coins YES — biggest single bet so far." }
      ],
      verdict: null,
      verdict_reasoning: null,
      verdict_confidence: null,
      evidence_quality: null,
      resolved_at: null,
      payouts: [],
      created_at: ts(12),
      is_scripted: true,
      guardian_reason: "Approved — personal fitness challenge."
    },
    // 2. CAREER
    {
      id: "seed-002",
      creator_id: "user-meera",
      creator_name: "Meera Nair",
      title: "Submit my AWS Solutions Architect exam registration by tomorrow 9 PM",
      description: "Been putting this off for 3 months. Booking the exam slot and paying the fee tonight.",
      deadline: deadline(18),
      stake_amount: 500,
      verification_method: "photo",
      verification_hint: "Exam confirmation email screenshot",
      parsed_goal: "Register and pay for AWS Solutions Architect exam before 9 PM tomorrow",
      category: "career",
      difficulty: "easy",
      base_yes_probability: 0.78,
      tags: ["AWS", "certification", "career", "tech"],
      market_hook: "Three months of procrastination ends tonight — or does it?",
      status: "open",
      pool_yes: 1240,
      pool_no: 380,
      yes_votes: 9,
      no_votes: 3,
      bets: [
        { bet_id: "b002a", bettor_id: "user-arjun", bettor_name: "Arjun Mehta", position: "yes", amount: 200, placed_at: ts(6) },
        { bet_id: "b002b", bettor_id: "user-rahul", bettor_name: "Rahul V.", position: "yes", amount: 300, placed_at: ts(4) },
        { bet_id: "b002c", bettor_id: "user-rohan", bettor_name: "Rohan K.", position: "no", amount: 380, placed_at: ts(2) },
        { bet_id: "b002d", bettor_id: "user-sneha", bettor_name: "Sneha T.", position: "yes", amount: 240, placed_at: ts(1) }
      ],
      activity_feed: [
        { ts: ts(7), event: "Meera Nair put 500 coins on herself — biggest opening stake this week." },
        { ts: ts(6), event: "Arjun Mehta bet YES — 200 coins of peer pressure applied." },
        { ts: ts(4), event: "Rahul V. in with 300 YES — market confidence at 76%." },
        { ts: ts(2), event: "Rohan K. bet NO with 380 coins — contrarian call." },
        { ts: ts(1), event: "Sneha T. bet YES — 240 coins. Rohan now alone on the NO side." }
      ],
      verdict: null,
      verdict_reasoning: null,
      verdict_confidence: null,
      evidence_quality: null,
      resolved_at: null,
      payouts: [],
      created_at: ts(7),
      is_scripted: true,
      guardian_reason: "Approved — professional certification milestone."
    },
    // 3. LEARNING
    {
      id: "seed-003",
      creator_id: "user-vikram",
      creator_name: "Vikram Rao",
      title: "Ship a working side project in 72 hours — from zero to deployed",
      description: "No existing code allowed. Starting from scratch Friday midnight. Must have a live URL, GitHub repo, and at least one real user by Monday midnight.",
      deadline: deadline(61),
      stake_amount: 1000,
      verification_method: "github",
      verification_hint: "github.com/vikramrao",
      parsed_goal: "Build and deploy a working web app from scratch within 72 hours",
      category: "creative",
      difficulty: "extreme",
      base_yes_probability: 0.35,
      tags: ["hackathon", "coding", "72hours", "shipping"],
      market_hook: "1000 coins on 72 hours of pure execution — the market says 35% YES.",
      status: "open",
      pool_yes: 1350,
      pool_no: 2200,
      yes_votes: 5,
      no_votes: 9,
      bets: [
        { bet_id: "b003a", bettor_id: "user-priya", bettor_name: "Priya S.", position: "no", amount: 500, placed_at: ts(20) },
        { bet_id: "b003b", bettor_id: "user-dev", bettor_name: "Dev P.", position: "yes", amount: 200, placed_at: ts(18) },
        { bet_id: "b003c", bettor_id: "user-karan", bettor_name: "Karan M.", position: "no", amount: 300, placed_at: ts(15) },
        { bet_id: "b003d", bettor_id: "user-meera", bettor_name: "Meera Nair", position: "yes", amount: 150, placed_at: ts(10) },
        { bet_id: "b003e", bettor_id: "user-rahul", bettor_name: "Rahul V.", position: "no", amount: 400, placed_at: ts(6) },
        { bet_id: "b003f", bettor_id: "user-rohan", bettor_name: "Rohan K.", position: "no", amount: 1000, placed_at: ts(2) }
      ],
      activity_feed: [
        { ts: ts(22), event: "Vikram Rao dropped 1000 coins on a 72-hour build challenge." },
        { ts: ts(20), event: "Priya S. opened NO position — 500 coins of skepticism." },
        { ts: ts(18), event: "Dev P. believes. 200 coins YES on the underdog." },
        { ts: ts(15), event: "Market now 38/62. NO side building fast." },
        { ts: ts(6), event: "Rahul V. added 400 to NO — odds sliding to 33% YES." },
        { ts: ts(2), event: "Rohan K. just dropped 1000 coins NO. Biggest single bet on any stake this week." }
      ],
      verdict: null,
      verdict_reasoning: null,
      verdict_confidence: null,
      evidence_quality: null,
      resolved_at: null,
      payouts: [],
      created_at: ts(22),
      is_scripted: true,
      guardian_reason: "Approved — creative/technical challenge."
    },
    // 4. FINANCE
    {
      id: "seed-004",
      creator_id: "user-priya",
      creator_name: "Priya Sharma",
      title: "Zero food delivery orders for 30 days — cook every meal at home",
      description: "Spending ₹8000/month on Zomato. Stopping cold turkey. 30 days, zero orders, bank statement as proof.",
      deadline: ts(2),
      stake_amount: 300,
      verification_method: "photo",
      verification_hint: "Bank statement / Zomato order history screenshot",
      parsed_goal: "Avoid all food delivery apps for 30 consecutive days",
      category: "finance",
      difficulty: "hard",
      base_yes_probability: 0.45,
      tags: ["finance", "habits", "cooking", "savings"],
      market_hook: "30 days, zero Zomato. The market gave her 45% odds. She proved them wrong.",
      status: "resolved",
      pool_yes: 1100,
      pool_no: 900,
      yes_votes: 8,
      no_votes: 6,
      bets: [
        { bet_id: "b004a", bettor_id: "user-arjun", bettor_name: "Arjun Mehta", position: "no", amount: 300, placed_at: ts(750) },
        { bet_id: "b004b", bettor_id: "user-vikram", bettor_name: "Vikram Rao", position: "yes", amount: 400, placed_at: ts(700) },
        { bet_id: "b004c", bettor_id: "user-rohan", bettor_name: "Rohan K.", position: "no", amount: 200, placed_at: ts(650) },
        { bet_id: "b004d", bettor_id: "user-sneha", bettor_name: "Sneha T.", position: "yes", amount: 400, placed_at: ts(600) },
        { bet_id: "b004e", bettor_id: "user-dev", bettor_name: "Dev P.", position: "no", amount: 400, placed_at: ts(500) }
      ],
      activity_feed: [
        { ts: ts(760), event: "Priya Sharma staked 300 coins on 30 days without Zomato." },
        { ts: ts(750), event: "Arjun Mehta bet NO — 300 coins. 'One bad day and it's over.'" },
        { ts: ts(700), event: "Vikram Rao believes — 400 coins YES." },
        { ts: ts(400), event: "Day 15 update: Priya still going strong. Odds shifted to 54% YES." },
        { ts: ts(50), event: "Day 29 — market on edge. Final bets closing." },
        { ts: ts(2), event: "Oracle verdict: ✓ SUCCESS (confidence 91%) — Bank statement confirms zero delivery orders." }
      ],
      verdict: "success",
      verdict_reasoning: "Bank statement and Zomato order history both confirm zero food delivery orders over the 30-day period. Evidence quality is strong. Stake resolved in creator's favour.",
      verdict_confidence: 0.91,
      evidence_quality: "strong",
      resolved_at: ts(2),
      payouts: [
        { bettor_id: "user-priya", bettor_name: "Priya Sharma", position: "yes", wagered: 300, profit: 245, result: "won", is_creator: true },
        { bettor_id: "user-vikram", bettor_name: "Vikram Rao", position: "yes", wagered: 400, profit: 327, result: "won" },
        { bettor_id: "user-sneha", bettor_name: "Sneha T.", position: "yes", wagered: 400, profit: 327, result: "won" },
        { bettor_id: "user-arjun", bettor_name: "Arjun Mehta", position: "no", wagered: 300, profit: -300, result: "lost" },
        { bettor_id: "user-rohan", bettor_name: "Rohan K.", position: "no", wagered: 200, profit: -200, result: "lost" },
        { bettor_id: "user-dev", bettor_name: "Dev P.", position: "no", wagered: 400, profit: -400, result: "lost" }
      ],
      created_at: ts(760),
      is_scripted: true,
      guardian_reason: "Approved — personal finance and habit goal."
    },
    // 5. HEALTH
    {
      id: "seed-005",
      creator_id: "user-rohan",
      creator_name: "Rohan Kumar",
      title: "Wake up at 5:30 AM every day for 21 days — no alarms, no excuses",
      description: "Phone shows wake time on health app. Must be awake and out of bed by 5:30 AM, 21 consecutive days.",
      deadline: ts(5),
      stake_amount: 250,
      verification_method: "photo",
      verification_hint: "iPhone Health app wake data screenshots",
      parsed_goal: "Wake up naturally at or before 5:30 AM for 21 consecutive days",
      category: "health",
      difficulty: "hard",
      base_yes_probability: 0.40,
      tags: ["sleep", "discipline", "mornings", "21days"],
      market_hook: "21 consecutive 5:30 AM wake-ups. The market was right to doubt.",
      status: "resolved",
      pool_yes: 700,
      pool_no: 1050,
      yes_votes: 5,
      no_votes: 8,
      bets: [
        { bet_id: "b005a", bettor_id: "user-karan", bettor_name: "Karan M.", position: "no", amount: 300, placed_at: ts(520) },
        { bet_id: "b005b", bettor_id: "user-meera", bettor_name: "Meera Nair", position: "yes", amount: 200, placed_at: ts(500) },
        { bet_id: "b005c", bettor_id: "user-dev", bettor_name: "Dev P.", position: "no", amount: 300, placed_at: ts(480) },
        { bet_id: "b005d", bettor_id: "user-arjun", bettor_name: "Arjun Mehta", position: "yes", amount: 250, placed_at: ts(460) },
        { bet_id: "b005e", bettor_id: "user-priya", bettor_name: "Priya S.", position: "no", amount: 450, placed_at: ts(440) }
      ],
      activity_feed: [
        { ts: ts(525), event: "Rohan Kumar staked 250 coins on 21 days of 5:30 AM wake-ups." },
        { ts: ts(520), event: "Karan M. opened NO immediately — 300 coins. 'Day 4 will end this.'" },
        { ts: ts(500), event: "Meera Nair bet YES — solidarity." },
        { ts: ts(300), event: "Day 11 check-in: Rohan slept through twice already. Odds now 32% YES." },
        { ts: ts(50), event: "Final day — Rohan missed day 18. Market awaits Oracle." },
        { ts: ts(5), event: "Oracle verdict: ✗ FAILURE (confidence 94%) — Health data shows 3 missed mornings. Streak broken day 18." }
      ],
      verdict: "failure",
      verdict_reasoning: "iPhone Health screenshots submitted show wake times exceeding 5:30 AM on days 8, 14, and 18. The 21-day consecutive requirement was not met. Stake resolved against creator.",
      verdict_confidence: 0.94,
      evidence_quality: "strong",
      resolved_at: ts(5),
      payouts: [
        { bettor_id: "user-rohan", bettor_name: "Rohan Kumar", position: "yes", wagered: 250, profit: -250, result: "lost", is_creator: true },
        { bettor_id: "user-karan", bettor_name: "Karan M.", position: "no", wagered: 300, profit: 200, result: "won" },
        { bettor_id: "user-dev", bettor_name: "Dev P.", position: "no", wagered: 300, profit: 200, result: "won" },
        { bettor_id: "user-priya", bettor_name: "Priya S.", position: "no", wagered: 450, profit: 300, result: "won" },
        { bettor_id: "user-meera", bettor_name: "Meera Nair", position: "yes", wagered: 200, profit: -200, result: "lost" },
        { bettor_id: "user-arjun", bettor_name: "Arjun Mehta", position: "yes", wagered: 250, profit: -250, result: "lost" }
      ],
      created_at: ts(525),
      is_scripted: true,
      guardian_reason: "Approved — health and discipline challenge."
    },
    // 6. SOCIAL
    {
      id: "seed-006",
      creator_id: "user-sneha",
      creator_name: "Sneha Tiwari",
      title: "Cold email 10 people I admire this week — no template, personalised only",
      description: "Screenshots of sent emails (names blurred for privacy). 10 unique, personalised cold emails by Friday 11 PM.",
      deadline: deadline(38),
      stake_amount: 150,
      verification_method: "photo",
      verification_hint: "Gmail sent folder screenshots",
      parsed_goal: "Send 10 personalised cold emails to admired people by Friday 11 PM",
      category: "social",
      difficulty: "medium",
      base_yes_probability: 0.65,
      tags: ["networking", "cold-email", "career", "social"],
      market_hook: "Ten cold emails, zero templates — the market thinks she has a shot.",
      status: "open",
      pool_yes: 560,
      pool_no: 240,
      yes_votes: 6,
      no_votes: 3,
      bets: [
        { bet_id: "b006a", bettor_id: "user-dev", bettor_name: "Dev P.", position: "yes", amount: 200, placed_at: ts(15) },
        { bet_id: "b006b", bettor_id: "user-karan", bettor_name: "Karan M.", position: "no", amount: 240, placed_at: ts(10) },
        { bet_id: "b006c", bettor_id: "user-rahul", bettor_name: "Rahul V.", position: "yes", amount: 210, placed_at: ts(4) }
      ],
      activity_feed: [
        { ts: ts(16), event: "Sneha Tiwari listed a social bet — 10 cold emails in 5 days." },
        { ts: ts(15), event: "Dev P. bet YES — 200 coins. 'She's great at this.'" },
        { ts: ts(10), event: "Karan M. playing contrarian — 240 coins NO." },
        { ts: ts(4), event: "Rahul V. backs Sneha with 210 YES. Odds now 70%." }
      ],
      verdict: null,
      verdict_reasoning: null,
      verdict_confidence: null,
      evidence_quality: null,
      resolved_at: null,
      payouts: [],
      created_at: ts(16),
      is_scripted: true,
      guardian_reason: "Approved — professional networking challenge."
    }
  ];

  for (const s of stakes as any[]) {
    s.odds_snapshots = buildSnapshots(
      s.base_yes_probability,
      s.bets,
      s.created_at
    );
  }

  return stakes;
}
