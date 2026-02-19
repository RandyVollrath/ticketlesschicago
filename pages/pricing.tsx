import React from 'react';
import Link from 'next/link';

export default function PricingPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', color: '#0F172A', fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 20px' }}>
        <Link href="/" style={{ color: '#2563EB', textDecoration: 'none', fontSize: 14 }}>← Back to Home</Link>

        <h1 style={{ fontSize: 42, margin: '16px 0 8px 0' }}>Founding Member Pricing</h1>
        <p style={{ marginTop: 0, color: '#64748B', fontSize: 18 }}>
          Chicago Driver Protection Plan
        </p>

        <section style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#2563EB', fontWeight: 700, letterSpacing: '0.04em' }}>FOUNDING MEMBER (ANNUAL)</p>
          <h2 style={{ fontSize: 44, margin: '8px 0 6px 0' }}>$49<span style={{ fontSize: 20, color: '#64748B' }}>/year</span></h2>
          <p style={{ margin: 0, color: '#64748B' }}>$49/year - Founding Member Rate (locks in forever).</p>
          <p style={{ marginTop: 8, color: '#64748B' }}>Keep your membership active to keep your price.</p>

          <ul style={{ marginTop: 16, color: '#334155', lineHeight: 1.8 }}>
            <li>Unlimited automated contesting for eligible Chicago tickets</li>
            <li>Free alerts and reminders</li>
            <li>We handle the paperwork</li>
            <li>We mail the contest for you</li>
            <li>First Dismissal Guarantee</li>
          </ul>

          <Link href="/get-started" style={{ display: 'inline-block', marginTop: 10, background: '#2563EB', color: '#fff', textDecoration: 'none', borderRadius: 10, padding: '12px 16px', fontWeight: 600 }}>
            Become a Founding Member
          </Link>
        </section>

        <section style={{ marginTop: 20, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>Founding Member Rate</h3>
          <p style={{ color: '#64748B', lineHeight: 1.7 }}>
            Founding Members pay $49/year. Your rate is locked as long as you keep an active membership.
            If your membership is canceled or lapses beyond a 7-day renewal grace period, you may lose your Founding rate
            and re-subscribe at the then-current price.
          </p>

          <h3>First Dismissal Guarantee</h3>
          <p style={{ color: '#64748B', lineHeight: 1.7, marginBottom: 0 }}>
            If we do not successfully dismiss at least one eligible non-camera ticket during your membership year,
            you can request a full refund of your membership fee. Camera tickets (red light / speed cameras) are excluded.
            Eligibility requires timely cooperation, including providing requested documentation within 17 days of the ticket issue date.
          </p>
        </section>
      </main>
    </div>
  );
}
