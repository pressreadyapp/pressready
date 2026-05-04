export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { genre, title, description, platform, budget, timeline } = req.body;

  const systemPrompt = `You are PressReady, a launch strategist for indie authors. You write specific, executable launch plans grounded in the actual book — not generic genre advice.

Rules:
- Reference the book's specific title, premise, and themes throughout the plan. Never write advice that could apply to any book in the genre.
- Match recommendations to the stated budget. If budget is $1-100, do not recommend tools that cost $200/month.
- Be concrete. Name specific platforms, hashtags, sub-genres, communities, price points, and day-by-day actions.
- Write in clear professional prose. No marketing fluff. No hedging.
- Output ONLY a valid JSON object. No markdown code fences. No commentary before or after. The very first character of your response must be { and the very last must be }.`;

  const userPrompt = `Generate a launch plan for this book:

Title: ${title || 'Untitled'}
Genre: ${genre}
Description: ${description || 'Not provided'}
Platform: ${platform}
Budget: ${budget}
Timeline: ${timeline}

Return JSON with this exact schema:
{
  "executive_summary": "2-3 sentence strategic overview specific to THIS book",
  "pre_launch": "Bulleted action list for the pre-launch phase. Use • for bullets and \\n between items.",
  "launch_week": "Day-by-day breakdown for launch week. Day 1 through Day 7. Use \\n between days.",
  "pricing_strategy": "Specific pricing recommendations for this book at this budget on this platform.",
  "review_strategy": "Specific tactics for getting early reviews on this platform within this timeline."
}`;

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
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Generation failed', details: data });
    }

    const rawText = data.content?.[0]?.text || '';
    console.log('Raw response from Claude:', rawText.substring(0, 500));

    let plan = null;

    try {
      plan = JSON.parse(rawText.trim());
    } catch (e) {}

    if (!plan) {
      try {
        const stripped = rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        plan = JSON.parse(stripped);
      } catch (e) {}
    }

    if (!plan) {
      try {
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          const extracted = rawText.substring(firstBrace, lastBrace + 1);
          plan = JSON.parse(extracted);
        }
      } catch (e) {}
    }

    if (!plan) {
      console.error('All parse strategies failed. Raw text:', rawText);
      return res.status(500).json({
        error: 'Could not parse plan',
        raw: rawText.substring(0, 1000)
      });
    }

    res.status(200).json({ plan });
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ error: 'API call failed', message: error.message });
  }
}
