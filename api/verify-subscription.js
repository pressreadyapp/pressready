// /api/verify-subscription.js
//
// Verifies a user has an active PressReady Pro subscription.
// Called when a subscriber enters their email to restore access.
//
// Flow:
//   1. Frontend sends { email }
//   2. We query Supabase for a subscriber record with that email
//   3. We verify their Stripe subscription status is still active
//   4. If active, we return a signed session token the frontend stores
//      in localStorage — replaces the old one-time unlock flag.
//
// The token is NOT a JWT — it's a simple HMAC-signed string:
//   base64( email + ":" + expiry_timestamp ) + "." + hmac_signature
// This is enough to verify server-side without a full auth library.

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.PRESSREADY_TOKEN_SECRET; // set in Vercel env vars
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
  if (sig !== expectedSig) return null; // tampered
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const [email, expiry] = decoded.split(':');
    if (Date.now() > parseInt(expiry)) return null; // expired
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

  // Check Supabase for subscriber record
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: subscriber, error } = await supabase
    .from('subscribers')
    .select('email, stripe_customer_id, stripe_subscription_id, status, plan')
    .eq('email', normalizedEmail)
    .single();

  if (error || !subscriber) {
    return res.status(200).json({
      active: false,
      reason: 'no_subscription'
    });
  }

  // Verify subscription is still active with Stripe directly
  // (catches cancellations and failed payments that haven't webhook'd yet)
  try {
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/subscriptions/${subscriber.stripe_subscription_id}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`
        }
      }
    );

    if (!stripeResponse.ok) {
      return res.status(200).json({ active: false, reason: 'stripe_error' });
    }

    const subscription = await stripeResponse.json();
    const isActive = ['active', 'trialing'].includes(subscription.status);

    if (!isActive) {
      // Update Supabase to reflect the cancellation
      await supabase
        .from('subscribers')
        .update({ status: subscription.status })
        .eq('email', normalizedEmail);

      return res.status(200).json({ active: false, reason: 'subscription_inactive' });
    }

    // Active — issue a session token
    const token = generateToken(normalizedEmail);

    return res.status(200).json({
      active: true,
      token,
      plan: subscriber.plan || 'pro',
      email: normalizedEmail
    });

  } catch (err) {
    console.error('Subscription verification error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
