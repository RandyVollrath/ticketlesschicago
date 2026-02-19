import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

const COLORS = {
  bg: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  muted: '#64748B',
  primary: '#2563EB',
};

export default function GuaranteePage() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <Head>
        <title>First Dismissal Guarantee | Autopilot America</title>
        <meta
          name="description"
          content="First Dismissal Guarantee: If we don't dismiss at least one eligible non-camera ticket during your membership year, we refund your annual membership fee."
        />
      </Head>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 20px' }}>
        <Link href="/" style={{ color: COLORS.primary, textDecoration: 'none', fontSize: 14 }}>
          ← Back to Home
        </Link>

        <h1 style={{ fontSize: 38, margin: '18px 0 12px 0' }}>First Dismissal Guarantee</h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: COLORS.muted, margin: 0 }}>
          If we do not successfully dismiss at least one eligible non-camera ticket during your membership year,
          you can request a full refund of your membership fee.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: COLORS.muted, marginTop: 10 }}>
          Camera tickets (red light / speed cameras) are excluded from the guarantee. Refund applies to your
          membership fee only and is issued to your original payment method.
        </p>

        <section style={{ marginTop: 24, background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <button
            onClick={() => setOpen(!open)}
            style={{ width: '100%', textAlign: 'left', padding: '16px 18px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 600, color: COLORS.text }}
          >
            Eligible Ticket Criteria {open ? '−' : '+'}
          </button>
          {open && (
            <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: '16px 18px', color: COLORS.muted, lineHeight: 1.7, fontSize: 15 }}>
              <p style={{ marginTop: 0 }}><strong>Location:</strong> Issued by the City of Chicago.</p>
              <p><strong>Timing:</strong> Issued after subscription start date and within paid membership period.</p>
              <p><strong>Type:</strong> Non-camera violations only. Red-light and speed camera tickets are excluded.</p>
              <p><strong>Status:</strong> Must still be eligible to contest (not past deadlines, not adjudicated, not in collections, not at boot/tow enforcement stage).</p>
              <p><strong>Documentation:</strong> Requested evidence/info must be provided promptly when requested (the sooner the better for your case). The absolute deadline is before the city's contest window closes.</p>
              <p><strong>Accuracy:</strong> Information provided must be truthful and complete.</p>
              <p style={{ marginBottom: 0 }}><strong>Volume/abuse cap:</strong> First 5 eligible tickets per membership year are included for guarantee consideration.</p>
            </div>
          )}
        </section>

        <section style={{ marginTop: 18, background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: '18px' }}>
          <p style={{ margin: 0, color: COLORS.muted, fontSize: 15, lineHeight: 1.7 }}>
            Refund requests must be submitted within 30 days after membership end, or immediately after final ticket decision if later.
          </p>
        </section>

        <div style={{ marginTop: 24 }}>
          <Link
            href="/guarantee-request"
            style={{ display: 'inline-block', background: COLORS.primary, color: '#fff', textDecoration: 'none', padding: '14px 18px', borderRadius: 10, fontWeight: 600 }}
          >
            Request a Guarantee Review
          </Link>
        </div>
      </main>
    </div>
  );
}
