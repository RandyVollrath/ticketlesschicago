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
          <h2 style={{ fontSize: 44, margin: '8px 0 6px 0' }}>$99<span style={{ fontSize: 20, color: '#64748B' }}>/year</span></h2>
          <p style={{ margin: 0, color: '#64748B' }}>$99/year - Founding Member Rate (locks in forever).</p>
          <p style={{ marginTop: 8, color: '#64748B' }}>Keep your membership active to keep your price.</p>

          <ul style={{ marginTop: 16, color: '#334155', lineHeight: 1.8 }}>
            <li>Unlimited automated contesting for eligible Chicago tickets</li>
            <li>Mobile app for Android &amp; iOS (coming soon)</li>
            <li>Real-time parking detection and smart alerts</li>
            <li>Street cleaning &amp; snow ban reminders for your block</li>
            <li>City sticker &amp; plate renewal deadline alerts</li>
            <li>Twice-weekly plate monitoring — we catch tickets fast</li>
            <li>We handle the paperwork and mail the contest for you</li>
            <li>First Dismissal Guarantee</li>
          </ul>

          <Link href="/get-started" style={{ display: 'inline-block', marginTop: 10, background: '#2563EB', color: '#fff', textDecoration: 'none', borderRadius: 10, padding: '12px 16px', fontWeight: 600 }}>
            Become a Founding Member
          </Link>
        </section>

        {/* Value Breakdown */}
        <section style={{ marginTop: 20, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ marginTop: 0, fontSize: 22 }}>The Math: Why $99 Is a No-Brainer</h3>
          <p style={{ color: '#64748B', lineHeight: 1.7, marginBottom: 20 }}>
            Based on 2.66 million parking tickets issued in Chicago in 2024 (FOIA data, excluding camera/speed violations):
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#DC2626' }}>2.2</div>
              <div style={{ fontSize: 13, color: '#991B1B', marginTop: 4 }}>parking tickets per vehicle/year</div>
            </div>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#DC2626' }}>$77</div>
              <div style={{ fontSize: 13, color: '#991B1B', marginTop: 4 }}>average ticket fine</div>
            </div>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#DC2626' }}>$154</div>
              <div style={{ fontSize: 13, color: '#991B1B', marginTop: 4 }}>avg cost per driver/year</div>
            </div>
          </div>

          <h4 style={{ fontSize: 16, marginBottom: 12, color: '#0F172A' }}>What Autopilot saves you:</h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#166534' }}>Ticket contesting (68.5% win rate)</div>
                <div style={{ fontSize: 13, color: '#15803D' }}>2.2 tickets × $77 avg × 68.5% dismissed</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>~$116</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#166534' }}>Escalation avoidance</div>
                <div style={{ fontSize: 13, color: '#15803D' }}>Unpaid tickets double to $166 avg — we catch them before that</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>~$40+</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#166534' }}>Alerts &amp; avoidance</div>
                <div style={{ fontSize: 13, color: '#15803D' }}>Street cleaning, snow bans, sticker/plate renewal reminders</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>~$60+</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#166534' }}>Your time saved</div>
                <div style={{ fontSize: 13, color: '#15803D' }}>No research, no letters, no trips to the post office</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>hours</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#1E293B', borderRadius: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: 18 }}>Total estimated value</div>
              <div style={{ fontSize: 13, color: '#94A3B8' }}>vs. your $99/year membership</div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#34D399' }}>$200+</div>
          </div>
        </section>

        <section style={{ marginTop: 20, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>Founding Member Rate</h3>
          <p style={{ color: '#64748B', lineHeight: 1.7 }}>
            Founding Members pay $99/year. Your rate is locked as long as you keep an active membership.
            If your membership is canceled or lapses beyond a 7-day renewal grace period, you may lose your Founding rate
            and re-subscribe at the then-current price.
          </p>

          <h3>First Dismissal Guarantee</h3>
          <p style={{ color: '#64748B', lineHeight: 1.7 }}>
            If we don't help you avoid all tickets or get at least 1 dismissed, you get a full refund.
            Your first dismissed ticket pays for the whole year.
          </p>
          <p style={{ color: '#94A3B8', fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>
            Camera tickets (red light / speed cameras) are excluded. <Link href="/guarantee" style={{ color: '#2563EB' }}>Full details</Link>
          </p>
        </section>

        <section style={{ marginTop: 20, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 16, padding: 24 }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#166534' }}>94% of Chicago parking tickets go uncontested.</p>
          <p style={{ margin: '8px 0 0', fontSize: 20, fontWeight: 600, color: '#15803D' }}>But 68.5% of contested parking tickets win.</p>
          <p style={{ margin: '12px 0 0', color: '#64748B', fontSize: 14 }}>Based on 2.66 million parking tickets and 35.7 million total records from Chicago FOIA data.</p>
        </section>
      </main>
    </div>
  );
}
