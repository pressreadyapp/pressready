// /api/generate.js
//
// Generates a book launch plan via Claude.
// Subscription model: verifies a signed token (issued by /api/verify-subscription)
// instead of a one-time Stripe session ID.
//
// Free users: 3 plans/day per IP, 4 sections visible (gated in frontend)
// Pro users: 30 plans/day per IP, full 12-section plan

import { createHmac } from 'crypto';

// ── Rate limiting (in-memory, resets on cold start) ──────────────────────────
const dailyTotalKey = () => new Date().toISOString().split('T')[0];
let dailyCount = { date: dailyTotalKey(), count: 0 };
const ipTracker = new Map();
const DAILY_TOTAL_CAP = 100;
const PER_IP_DAILY_CAP = 3;
const PRO_PER_IP_DAILY_CAP = 30;

function checkAndIncrementLimits(ip, isPro) {
  const today = dailyTotalKey();
  if (dailyCount.date !== today) {
    dailyCount = { date: today, count: 0 };
    ipTracker.clear();
  }
  if (dailyCount.count >= DAILY_TOTAL_CAP) {
    return { allowed: false, reason: 'daily_cap' };
  }
  const cap = isPro ? PRO_PER_IP_DAILY_CAP : PER_IP_DAILY_CAP;
  const ipRecord = ipTracker.get(ip);
  if (ipRecord && ipRecord.date === today && ipRecord.count >= cap) {
    return { allowed: false, reason: 'ip_cap' };
  }
  dailyCount.count++;
  if (ipRecord && ipRecord.date === today) {
    ipRecord.count++;
  } else {
    ipTracker.set(ip, { date: today, count: 1 });
  }
  return { allowed: true };
}

// ── Token verification ────────────────────────────────────────────────────────
// Tokens are issued by /api/verify-subscription and signed with PRESSREADY_TOKEN_SECRET.
// Format: base64(email:expiry).hmac_signature
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const secret = process.env.PRESSREADY_TOKEN_SECRET;
  if (!secret) return null;

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expectedSig) return null; // tampered or invalid

  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const colonIndex = decoded.lastIndexOf(':');
    const email = decoded.slice(0, colonIndex);
    const expiry = parseInt(decoded.slice(colonIndex + 1));
    if (Date.now() > expiry) return null; // expired — user must re-verify
    return email;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, pro_token } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  // Verify Pro token if provided
  // verifyToken returns the subscriber's email if valid, null if not
  const subscriberEmail = pro_token ? verifyToken(pro_token) : null;
  const isPro = !!subscriberEmail;

  // Identify user by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
          || req.headers['x-real-ip']
          || 'unknown';

  // Rate limit check
  const limitCheck = checkAndIncrementLimits(ip, isPro);
  if (!limitCheck.allowed) {
    if (limitCheck.reason === 'daily_cap') {
      return res.status(429).json({
        error: { message: "We've hit today's plan limit. PressReady is in early access — come back tomorrow!" }
      });
    }
    if (limitCheck.reason === 'ip_cap') {
      if (isPro) {
        return res.status(429).json({
          error: { message: "You've generated a lot of plans today. Try again in a few hours, or contact blackfuegopublishing@proton.me if you need help." }
        });
      }
      return res.status(429).json({
        error: { message: "You've reached the free daily limit (3 plans per day). Upgrade to PressReady Pro for unlimited generations." }
      });
    }
  }

  // Call Claude
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

    // Pass back whether this is a Pro response so the frontend
    // knows to render all sections or apply the free gate
    return res.status(200).json({ ...data, isPro });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: { message: error.message } });
  }
}
