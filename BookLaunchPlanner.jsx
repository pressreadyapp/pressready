import React, { useState } from 'react';

export default function BookLaunchPlanner() {
  const [step, setStep] = useState(0);
  const [genre, setGenre] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState('');
  const [budget, setBudget] = useState('');
  const [timeline, setTimeline] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);

  const genres = [
    'Urban Fiction', 'Literary Fiction', 'Psychological Thriller',
    'Science Fiction', 'Romance', 'Mystery',
    'Fantasy', 'Non-Fiction', 'Self-Help',
    'Biography', 'Horror', 'Historical Fiction'
  ];

  const platforms = [
    'Amazon KDP / Kindle Unlimited',
    'Amazon KDP (wide pricing)',
    'Wide (Apple, Kobo, B&N, Google)',
    'Direct sales (Shopify / Payhip)',
    'Hybrid'
  ];

  const budgets = [
    '$1 - $100', '$100 - $500', '$500 - $1,500',
    '$1,500 - $5,000', '$5,000+'
  ];

  const timelines = [
    'Less than 1 month', '1 month', '2-3 months',
    '3-6 months', '6+ months'
  ];

  async function generatePlan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, title, description, platform, budget, timeline })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
      } else {
        setPlan(data.plan);
      }
    } catch (e) {
      setError('Network error. Check your connection and try again.');
    }
    setLoading(false);
  }

  function reset() {
    setStep(0);
    setGenre(''); setTitle(''); setDescription('');
    setPlatform(''); setBudget(''); setTimeline('');
    setPlan(null); setError(null);
  }

  function copyPlan() {
    if (!plan) return;
    const text = [
      `${title || 'Launch Plan'}`,
      `${genre} · ${platform} · ${timeline}`,
      '',
      'EXECUTIVE SUMMARY',
      plan.executive_summary,
      '',
      'PRE-LAUNCH',
      plan.pre_launch,
      '',
      'LAUNCH WEEK',
      plan.launch_week,
      '',
      'PRICING STRATEGY',
      plan.pricing_strategy,
      '',
      'REVIEW STRATEGY',
      plan.review_strategy
    ].join('\n');
    navigator.clipboard.writeText(text);
  }

  // ---------- RESULTS VIEW ----------
  if (plan) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.header}>
            <div style={styles.eyebrow}>LAUNCH PLAN READY</div>
            <h1 style={styles.bookTitle}>{title || 'Untitled'}</h1>
            <div style={styles.meta}>{genre} · {platform} · {timeline}</div>
          </div>

          <div style={styles.actions}>
            <button style={styles.primaryBtn} onClick={copyPlan}>COPY PLAN</button>
            <button style={styles.secondaryBtn} onClick={reset}>NEW PLAN</button>
          </div>

          <Section title="Executive Summary" body={plan.executive_summary} />
          <Section title="Pre-Launch" body={plan.pre_launch} />
          <Section title="Launch Week" body={plan.launch_week} />
          <Section title="Pricing Strategy" body={plan.pricing_strategy} />
          <Section title="Review Strategy" body={plan.review_strategy} />

          <div style={styles.footer}>POWERED BY PRESSREADY · LAUNCH INTELLIGENCE</div>
        </div>
      </div>
    );
  }

  // ---------- LOADING VIEW ----------
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.loadingBox}>
            <div style={styles.loadingPulse}>GENERATING LAUNCH PLAN</div>
            <div style={styles.loadingSub}>Analyzing genre, budget, and timeline...</div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- WIZARD VIEW ----------
  const steps = ['GENRE', 'BOOK DETAILS', 'PLATFORM', 'BUDGET', 'TIMELINE'];
  const canAdvance =
    (step === 0 && genre) ||
    (step === 1 && title) ||
    (step === 2 && platform) ||
    (step === 3 && budget) ||
    (step === 4 && timeline);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.eyebrow}>PRESSREADY · LAUNCH INTELLIGENCE</div>
        <h1 style={styles.brand}>Press<span style={styles.brandAccent}>Ready</span></h1>
        <p style={styles.tagline}>AI-generated launch strategy tailored to your book, budget &amp; timeline.</p>

        <div style={styles.card}>
          <div style={styles.tabs}>
            {steps.map((s, i) => (
              <div key={s} style={{...styles.tab, ...(i === step ? styles.tabActive : {})}}>
                <div style={{...styles.tabBar, ...(i === step ? styles.tabBarActive : {})}} />
                <div style={{...styles.tabLabel, ...(i === step ? styles.tabLabelActive : {})}}>{s}</div>
              </div>
            ))}
          </div>

          {step === 0 && (
            <>
              <div style={styles.question}>WHAT GENRE IS YOUR BOOK?</div>
              <div style={styles.grid}>
                {genres.map(g => (
                  <button key={g}
                    onClick={() => setGenre(g)}
                    style={{...styles.optionBtn, ...(genre === g ? styles.optionBtnActive : {})}}>
                    {g}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div style={styles.question}>TELL US ABOUT YOUR BOOK</div>
              <label style={styles.label}>BOOK TITLE</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g., THB IV"
                style={styles.input}
              />
              <label style={styles.label}>SHORT DESCRIPTION (1-3 SENTENCES)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What's it about? Who's it for?"
                style={styles.textarea}
                rows={4}
              />
            </>
          )}

          {step === 2 && (
            <>
              <div style={styles.question}>WHERE ARE YOU PUBLISHING?</div>
              <div style={styles.gridTwo}>
                {platforms.map(p => (
                  <button key={p}
                    onClick={() => setPlatform(p)}
                    style={{...styles.optionBtn, ...(platform === p ? styles.optionBtnActive : {})}}>
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div style={styles.question}>WHAT'S YOUR LAUNCH BUDGET?</div>
              <div style={styles.gridTwo}>
                {budgets.map(b => (
                  <button key={b}
                    onClick={() => setBudget(b)}
                    style={{...styles.optionBtn, ...(budget === b ? styles.optionBtnActive : {})}}>
                    {b}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div style={styles.question}>WHEN IS LAUNCH DAY?</div>
              <div style={styles.gridTwo}>
                {timelines.map(t => (
                  <button key={t}
                    onClick={() => setTimeline(t)}
                    style={{...styles.optionBtn, ...(timeline === t ? styles.optionBtnActive : {})}}>
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.navRow}>
            {step > 0 && (
              <button style={styles.backBtn} onClick={() => setStep(step - 1)}>← BACK</button>
            )}
            {step < 4 && (
              <button
                style={{...styles.nextBtn, ...(canAdvance ? {} : styles.nextBtnDisabled)}}
                disabled={!canAdvance}
                onClick={() => setStep(step + 1)}>
                NEXT →
              </button>
            )}
            {step === 4 && (
              <button
                style={{...styles.nextBtn, ...(canAdvance ? {} : styles.nextBtnDisabled)}}
                disabled={!canAdvance}
                onClick={generatePlan}>
                GENERATE PLAN →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, body }) {
  if (!body) return null;
  const lines = body.split('\n').filter(l => l.trim());
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title.toUpperCase()}</div>
      <div style={styles.sectionBody}>
        {lines.map((line, i) => (
          <div key={i} style={styles.line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at top, #1a1a1f 0%, #0a0a0c 70%)',
    color: '#e8e6df',
    fontFamily: '"JetBrains Mono", "Courier New", monospace',
    padding: '60px 20px'
  },
  container: { maxWidth: '900px', margin: '0 auto' },
  eyebrow: {
    fontSize: '11px', letterSpacing: '3px', color: '#d4af37',
    marginBottom: '16px', fontWeight: 600
  },
  brand: {
    fontSize: '64px', fontWeight: 700, margin: '0 0 12px 0',
    fontFamily: '"Playfair Display", Georgia, serif',
    color: '#f5f3eb', letterSpacing: '-1px'
  },
  brandAccent: { color: '#d4af37', fontStyle: 'italic' },
  tagline: { fontSize: '15px', color: '#9a988f', marginBottom: '40px', lineHeight: 1.6 },
  card: {
    background: 'rgba(20, 20, 24, 0.6)',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    borderRadius: '12px', padding: '40px',
    backdropFilter: 'blur(10px)'
  },
  tabs: { display: 'flex', gap: '12px', marginBottom: '32px' },
  tab: { flex: 1 },
  tabBar: { height: '2px', background: 'rgba(154, 152, 143, 0.2)', marginBottom: '8px' },
  tabBarActive: { background: '#d4af37' },
  tabLabel: { fontSize: '10px', letterSpacing: '2px', color: '#5a594f' },
  tabLabelActive: { color: '#d4af37' },
  question: { fontSize: '12px', letterSpacing: '2px', color: '#9a988f', marginBottom: '20px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' },
  gridTwo: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' },
  optionBtn: {
    background: 'rgba(40, 40, 45, 0.5)',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    color: '#e8e6df', padding: '16px 20px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '14px', cursor: 'pointer',
    textAlign: 'left', transition: 'all 0.15s'
  },
  optionBtnActive: {
    background: 'rgba(212, 175, 55, 0.12)',
    border: '1px solid #d4af37', color: '#f5f3eb'
  },
  label: {
    display: 'block', fontSize: '10px', letterSpacing: '2px',
    color: '#9a988f', marginTop: '20px', marginBottom: '8px'
  },
  input: {
    width: '100%', background: 'rgba(40, 40, 45, 0.5)',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    color: '#f5f3eb', padding: '14px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '15px', boxSizing: 'border-box'
  },
  textarea: {
    width: '100%', background: 'rgba(40, 40, 45, 0.5)',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    color: '#f5f3eb', padding: '14px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '15px', boxSizing: 'border-box',
    resize: 'vertical'
  },
  navRow: { display: 'flex', justifyContent: 'space-between', marginTop: '32px', gap: '12px' },
  backBtn: {
    background: 'transparent', border: '1px solid rgba(154, 152, 143, 0.3)',
    color: '#9a988f', padding: '14px 24px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '12px', letterSpacing: '2px', cursor: 'pointer'
  },
  nextBtn: {
    marginLeft: 'auto', background: '#d4af37', border: 'none',
    color: '#0a0a0c', padding: '14px 32px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '12px', letterSpacing: '2px',
    fontWeight: 700, cursor: 'pointer'
  },
  nextBtnDisabled: { background: 'rgba(212, 175, 55, 0.2)', color: 'rgba(10,10,12,0.4)', cursor: 'not-allowed' },
  error: {
    marginTop: '20px', padding: '14px',
    background: 'rgba(220, 80, 80, 0.1)', border: '1px solid rgba(220, 80, 80, 0.3)',
    color: '#f5b5b5', borderRadius: '6px', fontSize: '13px'
  },
  loadingBox: { textAlign: 'center', padding: '120px 0' },
  loadingPulse: {
    fontSize: '14px', letterSpacing: '4px', color: '#d4af37',
    animation: 'pulse 1.5s ease-in-out infinite'
  },
  loadingSub: { fontSize: '12px', color: '#5a594f', marginTop: '12px' },
  header: { marginBottom: '40px' },
  bookTitle: {
    fontSize: '48px', fontFamily: '"Playfair Display", Georgia, serif',
    color: '#f5f3eb', margin: '12px 0 8px 0'
  },
  meta: { fontSize: '13px', color: '#9a988f', letterSpacing: '1px' },
  actions: { display: 'flex', gap: '12px', marginBottom: '40px' },
  primaryBtn: {
    background: '#d4af37', border: 'none', color: '#0a0a0c',
    padding: '12px 24px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '11px', letterSpacing: '2px',
    fontWeight: 700, cursor: 'pointer'
  },
  secondaryBtn: {
    background: 'transparent', border: '1px solid rgba(212, 175, 55, 0.3)',
    color: '#d4af37', padding: '12px 24px', borderRadius: '6px',
    fontFamily: 'inherit', fontSize: '11px', letterSpacing: '2px', cursor: 'pointer'
  },
  section: {
    background: 'rgba(20, 20, 24, 0.6)',
    border: '1px solid rgba(212, 175, 55, 0.12)',
    borderRadius: '8px', padding: '28px', marginBottom: '20px'
  },
  sectionTitle: {
    fontSize: '11px', letterSpacing: '3px', color: '#d4af37',
    marginBottom: '16px', fontWeight: 600
  },
  sectionBody: { fontSize: '14px', lineHeight: 1.7, color: '#d8d6cc' },
  line: { marginBottom: '8px' },
  footer: {
    textAlign: 'center', fontSize: '10px', letterSpacing: '3px',
    color: '#5a594f', marginTop: '60px', paddingTop: '40px',
    borderTop: '1px solid rgba(154, 152, 143, 0.1)'
  }
};
