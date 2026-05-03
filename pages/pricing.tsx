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
          <h2 style={{ fontSize: 44, margin: '8px 0 6px 0' }}>$79<span style={{ fontSize: 20, color: '#64748B' }}>/year</span></h2>
          <p style={{ margin: 0, color: '#64748B' }}>$79/year - Founding Member Rate (locks in forever).</p>
          <p style={{ marginTop: 8, color: '#64748B' }}>Keep your membership active to keep your price.</p>

          <ul style={{ marginTop: 16, color: '#334155', lineHeight: 1.8 }}>
            <li>Mobile app for iOS and Android</li>
            <li>Real-time parking detection and smart alerts</li>
            <li>Street cleaning &amp; snow ban alerts for your address</li>
            <li>Twice-weekly plate monitoring — we catch tickets fast</li>
            <li>Automatic contest letters drafted, printed, and mailed</li>
            <li>City sticker &amp; plate renewal deadline reminders</li>
            <li>No Ticket / First Dismissal Guarantee</li>
          </ul>

          <Link href="/get-started" style={{ display: 'inline-block', marginTop: 10, background: '#2563EB', color: '#fff', textDecoration: 'none', borderRadius: 10, padding: '12px 16px', fontWeight: 600 }}>
            Become a Founding Member
          </Link>
        </section>

        {/* Value Breakdown */}
        <section style={{ marginTop: 20, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 28 }}>
          <h3 style={{ marginTop: 0, fontSize: 24, letterSpacing: '-0.01em' }}>The Math: Why $79 Is a No-Brainer</h3>
          <p style={{ color: '#475569', lineHeight: 1.7, marginBottom: 20, fontSize: 15 }}>
            Based on 2025 FOIA ticket data and the City of Chicago 2025 Budget Appropriation Ordinance (Fund 0300 — Vehicle Tax Fund):
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>5.25M</div>
              <div style={{ fontSize: 12, color: '#991B1B', marginTop: 6, lineHeight: 1.4 }}>parking &amp; camera tickets issued in Chicago (2025)</div>
            </div>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>$420M</div>
              <div style={{ fontSize: 12, color: '#991B1B', marginTop: 6, lineHeight: 1.4 }}>total billed to Chicago drivers every year</div>
            </div>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>$234</div>
              <div style={{ fontSize: 12, color: '#991B1B', marginTop: 6, lineHeight: 1.4 }}>avg avoidable cost per Chicago driver/year (tickets + tow/impound)</div>
            </div>
          </div>

          <h4 style={{ fontSize: 17, marginBottom: 14, color: '#0F172A', fontWeight: 700 }}>What Autopilot saves you:</h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Automatic ticket contesting (59% mail-in win rate)</div>
                <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>Claude AI drafts, we print, we USPS-mail on Day 17 — four days before the deadline. 59% of mail-in contested Chicago parking tickets get dismissed (FOIA).</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>~$125</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Prevention alerts</div>
                <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>Street cleaning, snow ban, camera zones, permit zones, sticker &amp; plate renewals — before you get hit.</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>~$60+</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Escalation avoidance</div>
                <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>Unpaid tickets double. Chicago issued 51,000 boots and 81,000 tows in 2024. We catch tickets before they escalate to boot ($100) or tow ($250+).</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>~$40+</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Your time saved</div>
                <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>Fighting one ticket end-to-end takes ~3 hours. At 2.2 tickets/year, that&apos;s ~7 hours you keep.</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>~7 hrs</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Lawyer-equivalent work</div>
                <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>A ticket lawyer charges $150–$300 per letter. At 2.2 tickets/year that&apos;s $330–$660 of legal work for $79.</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>~$330+</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', background: 'linear-gradient(135deg, #1E293B, #0F172A)', borderRadius: 14, boxShadow: '0 4px 12px rgba(15,23,42,0.15)' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: 19 }}>Total estimated value</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 2 }}>vs. your $79/year membership</div>
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#34D399', letterSpacing: '-0.02em' }}>$550+</div>
          </div>

          <p style={{ marginTop: 18, marginBottom: 0, fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
            Sources: DOF FOIA F129773 (2025 ticket data, 5,246,241 rows; avg initial fine $68.76). Chicago 2025 Annual Appropriation Ordinance p.23 (Impoundment Fees $14.7M, Sale of Impounded Autos $2.2M). Chicago-resident share (63.2%) from zipcode analysis of 2025 FOIA. 1.18M Chicago vehicles per U.S. Census ACS. Street cleaning fine $60 initial / $120 late, verified FOIA violation code 0964040B.
          </p>
        </section>

        <section style={{ marginTop: 20, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>Founding Member Rate</h3>
          <p style={{ color: '#64748B', lineHeight: 1.7 }}>
            Founding Members pay $79/year. Your rate is locked as long as you keep an active membership.
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
          <p style={{ margin: '8px 0 0', fontSize: 20, fontWeight: 600, color: '#15803D' }}>But 59% of mail-in contested parking tickets win.</p>
          <p style={{ margin: '12px 0 0', color: '#64748B', fontSize: 14 }}>Based on 5.25 million Chicago tickets issued in 2025 and 35.7 million total ticket records (2018–2025) from FOIA data.</p>
        </section>
      </main>
    </div>
  );
}
