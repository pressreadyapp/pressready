// /api/save-plan.js
// Saves a generated plan to Supabase tied to a Pro subscriber's email.
// Called after plan generation when the user is Pro and sets a launch date.

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const secret = process.env.PRESSREADY_TOKEN_SECRET;
  if (!secret) return null;
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expectedSig) return null;
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const colonIndex = decoded.lastIndexOf(':');
    const email = decoded.slice(0, colonIndex);
    const expiry = parseInt(decoded.slice(colonIndex + 1));
    if (Date.now() > expiry) return null;
    return email;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pro_token, plan_data, form, launch_date } = req.body;

  const email = verifyToken(pro_token);
  if (!email) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!plan_data || !form?.title) {
    return res.status(400).json({ error: 'Missing plan data' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase.from('plans').insert({
    email,
    title: form.title,
    genre: form.genre,
    series_position: form.series_position,
    platform: form.platform,
    timeline: form.timeline,
    launch_date: launch_date || null,
    plan_data
  }).select('id').single();

  if (error) {
    console.error('Save plan error:', error);
    return res.status(500).json({ error: 'Failed to save plan' });
  }

  return res.status(200).json({ saved: true, plan_id: data.id });
}
