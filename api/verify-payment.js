// /api/verify-payment.js
//
// Verifies a Stripe Checkout Session and unlocks PressReady for a one-time buyer.
//
// Called by the frontend immediately after Stripe redirects the buyer back to
// pressready.ink?session_id=cs_xxx. We:
//
//   1. Ask Stripe directly: "is this session paid?" (never trust the URL alone)
//   2. Extract the buyer's email from the session
//   3. Upsert a row into one_time_unlocks with a 90-day access window
//   4. Mint and return a session token (same HMAC format as verify-subscription)
//
// The token lets the buyer use PressReady Pro features for 24 hours per token.
// The DB row lets them re-verify by email for up to 90 days.
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.PRESSREADY_TOKEN_SECRET;
const TOKEN_TTL_HOURS = 24;
const UNLOCK_DAYS = 90; // one-time buyers get 90 days of dashboard access

function generateToken(email) {
  const expiry = Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000;
  const payload = Buffer.from(`${email}:${expiry}`).toString('base64');
  const sig = createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.body || {};

  // Input validation
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'Missing session_id' });
  }
  if (!session_id.startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session_id format' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY not set');
    return res.status(500).json({ error: 'Stripe not configured' });
  }
  if (!TOKEN_SECRET) {
    console.error('PRESSREADY_TOKEN_SECRET not set');
    return res.status(500).json({ error: 'Auth not configured' });
  }

  // ── Step 1: Ask Stripe if the session was actually paid ─────────────────
  let session;
  try {
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${session_id}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    if (!stripeResponse.ok) {
      return res.status(400).json({ paid: false, error: 'Session not found' });
    }
    session = await stripeResponse.json();
  } catch (err) {
    console.error('Stripe session fetch error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }

  const isPaid = session.payment_status === 'paid' && session.status === 'complete';
  if (!isPaid) {
    return res.status(200).json({
      paid: false,
      session_id: session.id,
      error: 'Payment not complete'
    });
  }

  // ── Step 2: Extract buyer email from the session ────────────────────────
  // Stripe puts the email in different places depending on how the session was made.
  // customer_details.email is the most reliable for Checkout-collected emails.
  const email = (
    session.customer_details?.email ||
    session.customer_email ||
    ''
  ).trim().toLowerCase();

  if (!email || !email.includes('@')) {
    console.error('No email on paid session:', session.id);
    return res.status(500).json({
      paid: true,
      error: 'Payment succeeded but no email on file. Contact support.'
    });
  }

  // ── Step 3: Upsert into one_time_unlocks ────────────────────────────────
  // We use stripe_session_id as the unique key. If Stripe redirects the user
  // twice (refresh, back button), the second insert is a no-op — same row.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const expiresAt = new Date(Date.now() + UNLOCK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: upsertError } = await supabase
    .from('one_time_unlocks')
    .upsert(
      {
        email,
        stripe_session_id: session.id,
        expires_at: expiresAt
      },
      {
        onConflict: 'stripe_session_id', // dedupe by session, not by email
        ignoreDuplicates: false           // re-confirm expires_at if it changed
      }
    );

  if (upsertError) {
    console.error('Supabase upsert error:', upsertError);
    // Payment succeeded but we couldn't record it. Still give the user their token —
    // they can also restore via email lookup later if needed.
    // (Better UX than failing on a transient DB error.)
  }

  // ── Step 4: Mint and return a session token ─────────────────────────────
  const token = generateToken(email);

  return res.status(200).json({
    paid: true,
    session_id: session.id,
    token,
    email,
    tier: 'onetime',
    expires_at: expiresAt
  });
}
