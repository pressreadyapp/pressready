// /api/get-plans.js
// Returns all saved plans for a Pro subscriber.
// Called when the dashboard loads to show saved launches.

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

  const { pro_token } = req.body;

  const email = verifyToken(pro_token);
  if (!email) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('plans')
    .select('id, title, genre, platform, timeline, launch_date, plan_data, created_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Get plans error:', error);
    return res.status(500).json({ error: 'Failed to retrieve plans' });
  }

  return res.status(200).json({ plans: data || [] });
}
