// /api/webhook.js
//
// Receives Stripe webhook events and keeps Supabase in sync.
//
// Events handled:
//   checkout.session.completed     → new subscriber, write to Supabase
//   customer.subscription.updated  → plan change or renewal
//   customer.subscription.deleted  → cancellation
//   invoice.payment_failed         → mark subscription as past_due
//
// Setup in Stripe Dashboard:
//   Webhooks → Add endpoint → https://pressready.ink/api/webhook
//   Select events: the four above
//   Copy the signing secret → set as STRIPE_WEBHOOK_SECRET in Vercel env vars

import { createClient } from '@supabase/supabase-js';

// Stripe sends a signature header so we can verify the event is real
// and not a spoofed POST from a bad actor.
async function verifyStripeSignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const v1 = parts.find(p => p.startsWith('v1='))?.slice(3);
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === v1;
}

export const config = {
  api: { bodyParser: false } // must receive raw body for signature verification
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const isValid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn('Invalid Stripe webhook signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    switch (event.type) {

      // New subscriber completed checkout
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break; // ignore one-time payments

        const email = session.customer_details?.email?.trim().toLowerCase();
        if (!email) break;

        await supabase.from('subscribers').upsert({
          email,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          status: 'active',
          plan: 'pro',
          subscribed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

        console.log(`New subscriber: ${email}`);
        break;
      }

      // Subscription changed (renewal, upgrade, downgrade)
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer;

        // Look up the customer's email from Stripe
        const customerRes = await fetch(
          `https://api.stripe.com/v1/customers/${customerId}`,
          { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
        );
        const customer = await customerRes.json();
        const email = customer.email?.trim().toLowerCase();
        if (!email) break;

        await supabase.from('subscribers')
          .update({
            status: sub.status,
            stripe_subscription_id: sub.id,
            updated_at: new Date().toISOString()
          })
          .eq('email', email);

        console.log(`Subscription updated: ${email} → ${sub.status}`);
        break;
      }

      // Subscription cancelled
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;

        const customerRes = await fetch(
          `https://api.stripe.com/v1/customers/${customerId}`,
          { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
        );
        const customer = await customerRes.json();
        const email = customer.email?.trim().toLowerCase();
        if (!email) break;

        await supabase.from('subscribers')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('email', email);

        console.log(`Subscription cancelled: ${email}`);
        break;
      }

      // Payment failed
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const customerRes = await fetch(
          `https://api.stripe.com/v1/customers/${customerId}`,
          { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
        );
        const customer = await customerRes.json();
        const email = customer.email?.trim().toLowerCase();
        if (!email) break;

        await supabase.from('subscribers')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString()
          })
          .eq('email', email);

        console.log(`Payment failed: ${email}`);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
