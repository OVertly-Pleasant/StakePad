import { GoogleGenAI } from "@google/genai";

export function checkIsGeminiLive(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return !!(
    key &&
    key !== "MY_GEMINI_API_KEY" &&
    key !== "GEMINI_API_KEY" &&
    key.trim() !== ""
  );
}

export let isGeminiLive = checkIsGeminiLive();
export let geminiError: string | null = null;

export function getGeminiStatus() {
  return {
    live: isGeminiLive && checkIsGeminiLive(),
    error: geminiError
  };
}

let ai: GoogleGenAI | null = null;
let lastKeyUsed: string | undefined = undefined;

export function getGoogleGenAI(): GoogleGenAI | null {
  const currentKey = process.env.GEMINI_API_KEY;
  if (currentKey !== lastKeyUsed) {
    lastKeyUsed = currentKey;
    geminiError = null;
    isGeminiLive = checkIsGeminiLive();
    ai = null;
  }

  if (!checkIsGeminiLive() || isGeminiLive === false) {
    ai = null;
    return null;
  }
  if (!ai) {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    isGeminiLive = true;
  }
  return ai;
}

// Try to initialize at startup
getGoogleGenAI();

async function queryGemini(
  prompt: string,
  systemInstruction = "",
  imageB64: string | null = null,
  imageMime = "image/jpeg",
  retry = 0
): Promise<any> {
  const client = getGoogleGenAI();
  if (!client) {
    throw new Error("Gemini client is not initialized because GEMINI_API_KEY is missing or disabled.");
  }

  const contents: any[] = [];
  if (imageB64) {
    contents.push({
      inlineData: {
        data: imageB64,
        mimeType: imageMime
      }
    });
  }
  contents.push(prompt);

  const config: any = {
    temperature: 0.2,
    responseMimeType: "application/json",
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  try {
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config
    });

    let raw = response.text || "";
    raw = raw.trim();
    if (raw.startsWith("```")) {
      const parts = raw.split("```");
      raw = parts[1];
      if (raw.startsWith("json")) {
        raw = raw.substring(4);
      }
    }
    raw = raw.trim();

    // Remove any illegal control characters that might break JSON parsing
    const cleanedRaw = raw.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
    
    // Clear any previous error on success
    geminiError = null;
    return JSON.parse(cleanedRaw);
  } catch (error: any) {
    const errStr = String(error);
    if (errStr.includes("403") || errStr.includes("PERMISSION_DENIED") || errStr.includes("denied access") || errStr.includes("401") || errStr.includes("API_KEY_INVALID")) {
      console.warn("[Gemini] API Key is invalid, unauthorized, or denied access.", error);
      geminiError = error.message || errStr;
      isGeminiLive = false;
    }
    
    if (errStr.includes("429") && retry < 2) {
      const wait = Math.pow(2, retry) * 3000;
      console.log(`[Gemini] 429 rate limit - retrying in ${wait / 1000}s (attempt ${retry + 1})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return queryGemini(prompt, systemInstruction, imageB64, imageMime, retry + 1);
    }
    throw error;
  }
}

// GUARDIAN
const HARM_KEYWORDS = [
  "steal", "theft", "rob", "vandal", "trespass", "illegal", "drug", "weapon",
  "harm", "kill", "hurt", "assault", "harass", "stalk", "abuse", "nude", "naked",
  "explicit", "traffic cone", "road sign", "shoplifting", "shoplift", "graffiti",
  "arson", "bomb", "hack", "phish", "fraud", "scam", "cheat", "forge", "counterfeit",
];

function keywordScreen(text: string) {
  const lower = text.toLowerCase();
  for (const kw of HARM_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        approved: false,
        reason: `Stake rejected by Guardian: contains prohibited content ('${kw}').`
      };
    }
  }
  return { approved: true, reason: "Passed keyword screen." };
}

const GUARDIAN_SYS = `You are the Guardian — responsible AI moderator for StakePad, an accountability platform.

REJECT if the goal involves ANY of:
  • Illegal activity (theft, trespassing, vandalism, drug use, fraud)
  • Physical harm to self or others
  • Harassment or targeting real people
  • Sexually explicit or offensive content
  • Dangerous stunts or reckless safety risks

APPROVE everything else — fitness, study, work, creative, financial, social goals.
When in doubt, APPROVE. This is an accountability platform, not a nanny.

Respond ONLY with valid JSON: {"approved": true/false, "reason": "one sentence"}`;

export async function agentGuardian(title: string, description: string): Promise<{ approved: boolean; reason: string }> {
  const combined = `${title} ${description}`;
  const kwResult = keywordScreen(combined);
  if (!kwResult.approved) {
    return kwResult;
  }
  if (!isGeminiLive) {
    const note = geminiError ? ` (Gemini key error: ${geminiError})` : " (Gemini key not configured)";
    return { approved: true, reason: `Keyword screen passed. Running in offline fallback mode.${note}` };
  }
  try {
    return await queryGemini(`Title: "${title}"\nDescription: "${description}"`, GUARDIAN_SYS);
  } catch (error: any) {
    console.error(`[Guardian error]`, error);
    const errMsg = error.message || String(error);
    return { approved: true, reason: `Keyword screen passed. Gemini request failed: "${errMsg}".` };
  }
}

// ANALYST
const ANALYST_SYS = `You are the Analyst for StakePad.
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
}`;

export async function agentAnalyst(
  title: string,
  description: string,
  deadlineStr: string,
  method: string,
  historyRate: number | null,
  historyTotal: number
): Promise<any> {
  const histStr = historyRate !== null
    ? `Creator history: ${historyTotal} resolved stakes, ${Math.round(historyRate * 100)}% success rate.`
    : `Creator history: no resolved stakes yet.`;

  const prompt = `Title: "${title}"\nDescription: "${description}"\nDeadline: ${deadlineStr}\nVerification: ${method}\n${histStr}`;

  if (!isGeminiLive) {
    const difficultyMap: Record<string, number> = { easy: 0.75, medium: 0.6, hard: 0.45, extreme: 0.33 };
    let prob = 0.6;
    if (historyRate !== null) {
      const adj = (historyRate - 0.5) * 0.2;
      prob = Math.max(0.25, Math.min(0.85, prob + adj));
    }
    const hookNote = geminiError ? ` (Gemini error: ${geminiError})` : " (Gemini key not configured)";
    return {
      parsed_goal: title,
      category: "other",
      difficulty: "medium",
      yes_probability: prob,
      tags: ["general"],
      market_hook: `${title} — will they pull it off?${hookNote}`
    };
  }

  try {
    return await queryGemini(prompt, ANALYST_SYS);
  } catch (error: any) {
    console.error(`[Analyst error]`, error);
    const errMsg = error.message || String(error);
    return {
      parsed_goal: title,
      category: "other",
      difficulty: "medium",
      yes_probability: 0.6,
      tags: ["general"],
      market_hook: `${title} — will they pull it off? (Gemini error: ${errMsg})`
    };
  }
}

// ORACLE
const ORACLE_SYS = `You are the Oracle — impartial AI judge for StakePad.
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
}`;

export async function agentOracle(
  goal: string,
  deadlineStr: string,
  method: string,
  evidence: string,
  imageB64: string | null = null,
  imageMime = "image/jpeg"
): Promise<any> {
  const prompt = `Goal: "${goal}"\nDeadline: ${deadlineStr}\nVerification: ${method}\nEvidence:\n${evidence}`;
  if (!isGeminiLive) {
    const hasEvidence = !!evidence.trim() && evidence !== "No evidence submitted.";
    return {
      verdict: hasEvidence ? "success" : "failure",
      confidence: hasEvidence ? 0.7 : 0.6,
      reasoning: hasEvidence
        ? (geminiError 
            ? `Evidence reviewed. (Note: Your GEMINI_API_KEY is configured but failed with error: "${geminiError}". Please verify your key and project permission in Settings > Secrets. Running in offline fallback mode.)`
            : "Evidence reviewed — appears to support the goal. (Gemini key invalid/absent; add a valid GEMINI_API_KEY in Settings > Secrets for full AI verification.)")
        : "No evidence submitted before deadline. Resolved as failure.",
      evidence_quality: hasEvidence ? "moderate" : "none"
    };
  }

  try {
    return await queryGemini(prompt, ORACLE_SYS, imageB64, imageMime);
  } catch (error: any) {
    console.error(`[Oracle error]`, error);
    const errStr = String(error);
    const hasEvidence = !!evidence.trim() && evidence !== "No evidence submitted.";
    const errMsg = error.message || errStr;
    return {
      verdict: hasEvidence ? "success" : "failure",
      confidence: hasEvidence ? 0.7 : 0.6,
      reasoning: `Judgment rendered in safety mode. (Note: Gemini API failed with error: "${errMsg}". Running in fallback mode.)`,
      evidence_quality: hasEvidence ? "moderate" : "none"
    };
  }
}

// NARRATOR
const NARRATOR_SYS = `You are the Narrator for StakePad's live activity feed.
Generate exactly 3 short feed messages for a new stake.
Bloomberg terminal meets group chat energy. No emojis. No hashtags. Max 12 words each.
Respond ONLY with valid JSON: {"events": ["msg1","msg2","msg3"]}`;

export async function agentNarrator(creatorName: string, goal: string, oddsYes: number): Promise<string[]> {
  if (!isGeminiLive) {
    return [
      `${creatorName} just listed a new stake.`,
      `Market open — ${oddsYes}% confidence.`,
      "Add your position before odds shift."
    ];
  }

  try {
    const result = await queryGemini(`Creator: ${creatorName}\nGoal: "${goal}"\nYES odds: ${oddsYes}%`, NARRATOR_SYS);
    return result.events || [];
  } catch (error) {
    console.error(`[Narrator error]`, error);
    return [
      `${creatorName} just listed a new stake.`,
      `Market open — ${oddsYes}% confidence.`,
      "Add your position before odds shift."
    ];
  }
}

// PEP TALK AGENT (MOTIVATOR & RESPONSIBLE AI PEPTALK)
const PEPTALK_SYS = `You are the StakePad Motivator AI. 
Your goal is to provide a highly positive, inspiring, and fiery "Prove Them Wrong" pep talk for a user's accountability contract.
If the odds are against them (high probability of failure, low YES odds), focus on turning skepticism into motivation.
If the odds are in their favor, focus on keeping the momentum and avoiding complacency.

IMPORTANT - Responsible AI / Anti-Bullying Guidelines:
- Encourage healthy behaviors and self-care.
- Frame accountability as self-improvement and self-mastery, NEVER self-punishment or toxicity.
- Remind them that failure is simply feedback, and they are surrounded by a community that wants them to grow.
- NEVER use shaming, insulting, or derogatory remarks, even playfully. Maintain a constructive, empowering, and coaching tone.

Respond ONLY with valid JSON:
{
  "peptalk": "A 2-3 sentence fiery, positive, encouraging pep talk addressing them by their goal and current odds. Keep it highly empowering and focused on proving skeptics wrong.",
  "tips": [
    "Practical actionable tip 1 to break down the goal",
    "Practical actionable tip 2 for momentum or consistency",
    "A self-care or healthy habit tip to ensure responsible execution"
  ]
}
`;

export async function agentPepTalk(
  title: string,
  description: string,
  yesPct: number,
  noPct: number
): Promise<{ peptalk: string; tips: string[] }> {
  if (!isGeminiLive) {
    const defaultTips = [
      "Break your big target into micro-tasks that take under 20 minutes to start.",
      "The first 5 minutes are the hardest — tell yourself you will only work for 5 minutes and see what happens.",
      "Self-care is productivity. Drink water, get enough sleep, and take breaks to avoid burnout."
    ];
    let peptalk = "";
    if (noPct > yesPct) {
      peptalk = `The crowd is currently betting against you on "${title}" with a ${noPct}% skeptics pool. This is your chance to shine! Prove them wrong, back yourself, and claim your victory.`;
    } else {
      peptalk = `You have strong backing on "${title}" with a ${yesPct}% success probability! Keep your focus, execute step-by-step, and cross that finish line.`;
    }
    return { peptalk, tips: defaultTips };
  }

  try {
    const prompt = `Goal: "${title}"\nDescription: "${description}"\nYES Odds: ${yesPct}%\nNO Odds: ${noPct}%`;
    const res = await queryGemini(prompt, PEPTALK_SYS);
    return {
      peptalk: res.peptalk || `Keep pushing! You've got this. Let's finish "${title}" strong.`,
      tips: res.tips || [
        "Break the work down into tiny bite-sized milestones.",
        "Remove distractions and set a focused timer for 25 minutes.",
        "Take a breath and remember that every step counts towards your progress."
      ]
    };
  } catch (error) {
    console.error("[PepTalk Agent error]", error);
    let peptalk = `Keep pushing! You've got this. Let's finish "${title}" strong.`;
    if (noPct > yesPct) {
      peptalk = `Skeptics have established a ${noPct}% NO pool on "${title}". Treat this skepticism as raw fuel. Let's get to work and prove them wrong!`;
    }
    return {
      peptalk,
      tips: [
        "Break the work down into tiny bite-sized milestones.",
        "Remove distractions and set a focused timer for 25 minutes.",
        "Take a breath and remember that every step counts towards your progress."
      ]
    };
  }
}

