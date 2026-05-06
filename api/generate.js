// In-memory rate limiting (resets when the function cold-starts, but layers protect against abuse)
const dailyTotalKey = () => new Date().toISOString().split('T')[0]; // e.g. "2026-05-04"
let dailyCount = { date: dailyTotalKey(), count: 0 };
const ipTracker = new Map(); // ip -> { date, count }

const DAILY_TOTAL_CAP = 100;
const PER_IP_DAILY_CAP = 3;

function checkAndIncrementLimits(ip) {
  const today = dailyTotalKey();

  // Reset daily total if new day
  if (dailyCount.date !== today) {
    dailyCount = { date: today, count: 0 };
    ipTracker.clear();
  }

  // Check daily total
  if (dailyCount.count >= DAILY_TOTAL_CAP) {
    return { allowed: false, reason: 'daily_cap' };
  }

  // Check per-IP
  const ipRecord = ipTracker.get(ip);
  if (ipRecord && ipRecord.date === today && ipRecord.count >= PER_IP_DAILY_CAP) {
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

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  // Identify the user by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
          || req.headers['x-real-ip']
          || 'unknown';

  // Rate limit check
  const limitCheck = checkAndIncrementLimits(ip);
  if (!limitCheck.allowed) {
    if (limitCheck.reason === 'daily_cap') {
      return res.status(429).json({
        error: { message: "We've hit today's free plan limit. PressReady is in early access — come back tomorrow!" }
      });
    }
    if (limitCheck.reason === 'ip_cap') {
      return res.status(429).json({
        error: { message: "You've reached the free daily limit (3 plans per day). Come back tomorrow for more!" }
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
