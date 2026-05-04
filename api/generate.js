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
- Output ONLY valid JSON matching the schema. Do not wrap in markdown code fences. Do not add commentary before or after.`;

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
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(500).json({ error: 'Generation failed', details: data });
    }

    const rawText = data.content?.[0]?.text || '';

    let plan;
    try {
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Parse error:', parseError, 'Raw text:', rawText);
      return res.status(500).json({ error: 'Could not parse plan', raw: rawText });
    }

    res.status(200).json({ plan });
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ error: 'API call failed', message: error.message });
  }
}
