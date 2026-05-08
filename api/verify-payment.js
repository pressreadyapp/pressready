// /api/verify-payment.js
//
// Verifies a Stripe Checkout Session was actually paid.
// The frontend calls this with a session_id (received from Stripe's redirect)
// and we ask Stripe directly: "is this session paid?"
//
// We never trust the URL parameter alone — that could be faked.
// Stripe's API is the source of truth.

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.body || {};

  // Validate input
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  // Quick sanity check: real Stripe session IDs start with "cs_"
  if (!session_id.startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session_id format' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  try {
    // Call Stripe's Checkout Session API directly
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
      // Stripe rejected the session_id (doesn't exist, wrong account, etc.)
      return res.status(400).json({ paid: false, error: 'Session not found' });
    }

    const session = await stripeResponse.json();

    // The session must be marked as paid AND complete
    const isPaid = session.payment_status === 'paid' && session.status === 'complete';

    return res.status(200).json({
      paid: isPaid,
      session_id: session.id
    });
  } catch (err) {
    console.error('Stripe verification error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
