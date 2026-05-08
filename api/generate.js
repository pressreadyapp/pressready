// In-memory rate limiting (resets when the function cold-starts, but layers protect against abuse)
const dailyTotalKey = () => new Date().toISOString().split('T')[0]; // e.g. "2026-05-04"
let dailyCount = { date: dailyTotalKey(), count: 0 };
const ipTracker = new Map(); // ip -> { date, count }
const DAILY_TOTAL_CAP = 100;
const PER_IP_DAILY_CAP = 3;
const UNLOCKED_PER_IP_DAILY_CAP = 30; // generous but protects against runaway abuse

// Cache verified session IDs in memory so we don't hit Stripe on every request
// from the same paid user. Cleared on cold start (acceptable; user re-verifies).
const verifiedSessions = new Set();

async function isSessionVerified(sessionId, stripeKey) {
  // Already verified this session in memory? Skip the API call.
  if (verifiedSessions.has(sessionId)) return true;
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) return false;
  if (!stripeKey) return false;

  try {
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    if (!stripeResponse.ok) return false;
    const session = await stripeResponse.json();
    const isPaid = session.payment_status === 'paid' && session.status === 'complete';
    if (isPaid) verifiedSessions.add(sessionId);
    return isPaid;
  } catch {
    return false;
  }
}

function checkAndIncrementLimits(ip, isUnlocked) {
  const today = dailyTotalKey();
  // Reset daily total if new day
  if (dailyCount.date !== today) {
    dailyCount = { date: today, count: 0 };
    ipTracker.clear();
  }
  // Check daily total (applies to everyone — protects against runaway API costs)
  if (dailyCount.count >= DAILY_TOTAL_CAP) {
    return { allowed: false, reason: 'daily_cap' };
  }
  // Check per-IP using the appropriate cap
  const cap = isUnlocked ? UNLOCKED_PER_IP_DAILY_CAP : PER_IP_DAILY_CAP;
  const ipRecord = ipTracker.get(ip);
  if (ipRecord && ipRecord.date === today && ipRecord.count >= cap) {
    return { allowed: false, reason: 'ip_cap' };
  }
  // Increment both counters
  dailyCount.count++;
  if (ipRecord && ipRecord.date === today) {
    ipRecord.count++;
  } else {
    ipTracker.set(ip, { date: today, count: 1 });
  }
  return { allowed: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { prompt, unlock_session_id } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  // If the frontend claims this is a paid user, verify with Stripe before
  // applying the higher rate limit. Never trust the frontend alone.
  let isUnlocked = false;
  if (unlock_session_id) {
    isUnlocked = await isSessionVerified(unlock_session_id, process.env.STRIPE_SECRET_KEY);
  }

  // Identify the user by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
          || req.headers['x-real-ip']
          || 'unknown';

  // Rate limit check (applies to both free and paid, just at different thresholds)
  const limitCheck = checkAndIncrementLimits(ip, isUnlocked);
  if (!limitCheck.allowed) {
    if (limitCheck.reason === 'daily_cap') {
      return res.status(429).json({
        error: { message: "We've hit today's plan limit. PressReady is in early access — come back tomorrow!" }
      });
    }
    if (limitCheck.reason === 'ip_cap') {
      if (isUnlocked) {
        return res.status(429).json({
          error: { message: "You've generated a lot of plans today. Try again in a few hours, or contact blackfuegopublishing@proton.me if you need help." }
        });
      }
      return res.status(429).json({
        error: { message: "You've reached the free daily limit (3 plans per day). Unlock the full plan for unlimited generations, or come back tomorrow." }
      });
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return res.status(500).json({ error: data.error || 'Generation failed' });
    }
    res.status(200).json(data);
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}
