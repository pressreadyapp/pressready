// /api/verify-subscription.js
//
// Verifies a user has access to PressReady Pro.
// Checks BOTH active subscriptions AND active one-time unlocks.
//
// Flow:
//   1. Frontend sends { email }
//   2. We check Supabase subscribers table — if active, return token
//   3. If no subscription, check one_time_unlocks — if not expired, return token
//   4. Token is the same format for both tiers (downstream endpoints don't care)
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.PRESSREADY_TOKEN_SECRET;
const TOKEN_TTL_HOURS = 24; // token lasts 24 hours, then user re-verifies

function generateToken(email) {
  const expiry = Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000;
  const payload = Buffer.from(`${email}:${expiry}`).toString('base64');
  const sig = createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  if (sig !== expectedSig) return null;
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const [email, expiry] = decoded.split(':');
    if (Date.now() > parseInt(expiry)) return null;
    return email;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── Check 1: Active subscription ─────────────────────────────────────────
  const { data: subscriber, error: subError } = await supabase
    .from('subscribers')
    .select('email, stripe_customer_id, stripe_subscription_id, status, plan')
    .eq('email', normalizedEmail)
    .single();

  if (subscriber && !subError) {
    try {
      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/subscriptions/${subscriber.stripe_subscription_id}`,
        {
          headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` }
        }
      );
      if (stripeResponse.ok) {
        const subscription = await stripeResponse.json();
        const isActive = ['active', 'trialing'].includes(subscription.status);
        if (isActive) {
          const token = generateToken(normalizedEmail);
          return res.status(200).json({
            active: true,
            token,
            plan: subscriber.plan || 'pro',
            tier: 'subscription',
            email: normalizedEmail
          });
        }
        // Subscription cancelled/past_due — update DB and fall through to one-time check
        await supabase
          .from('subscribers')
          .update({ status: subscription.status })
          .eq('email', normalizedEmail);
      }
    } catch (err) {
      console.error('Stripe subscription check error:', err);
      // Fall through to one-time check — don't fail the whole flow on a Stripe hiccup
    }
  }

  // ── Check 2: Active one-time unlock ──────────────────────────────────────
  const { data: unlock, error: unlockError } = await supabase
    .from('one_time_unlocks')
    .select('email, expires_at')
    .eq('email', normalizedEmail)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();

  if (unlock && !unlockError) {
    const token = generateToken(normalizedEmail);
    return res.status(200).json({
      active: true,
      token,
      plan: 'onetime',
      tier: 'onetime',
      email: normalizedEmail,
      expires_at: unlock.expires_at
    });
  }

  // ── Check 3: Expired one-time (better error message) ─────────────────────
  const { data: expiredUnlock } = await supabase
    .from('one_time_unlocks')
    .select('expires_at')
    .eq('email', normalizedEmail)
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();

  if (expiredUnlock) {
    return res.status(200).json({
      active: false,
      reason: 'onetime_expired'
    });
  }

  return res.status(200).json({
    active: false,
    reason: 'no_subscription'
  });
}
