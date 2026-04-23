import React, { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { posthog } from '../lib/posthog';

const C = {
  ink: '#0F172A',
  slate: '#475569',
  muted: '#64748B',
  brand: '#10B981',
  alert: '#EF4444',
  bg: '#FFFFFF',
  bgSoft: '#F8FAFC',
  border: '#E2E8F0',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',
  okBg: '#F0FDF4',
  okBorder: '#BBF7D0',
  ok: '#166534',
};

export interface FlyerProps {
  flyerKey: string;
  eyebrow: string;
  eyebrowColor?: string;
  headline: string;
  subhead: string;
  stat?: { big: string; label: string };
  bullets: string[];
}

export default function FlyerLanding({ flyerKey, eyebrow, eyebrowColor = C.danger, headline, subhead, stat, bullets }: FlyerProps) {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const { src, area, date } = router.query;
    posthog?.capture('flyer_scan', {
      flyer_key: flyerKey,
      src: typeof src === 'string' ? src : undefined,
      area: typeof area === 'string' ? area : undefined,
      date: typeof date === 'string' ? date : undefined,
      path: router.asPath,
    });
  }, [flyerKey, router.isReady, router.query, router.asPath]);

  return (
    <>
      <Head>
        <title>{headline} — Autopilot America</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ minHeight: '100vh', background: C.bgSoft, color: C.ink, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <main style={{ maxWidth: 540, margin: '0 auto', padding: '24px 18px 56px' }}>

          {/* Brand mark */}
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: C.brand, textTransform: 'uppercase', marginBottom: 14 }}>
            Autopilot America
          </div>

          {/* Eyebrow + Headline */}
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: eyebrowColor, textTransform: 'uppercase', marginBottom: 8 }}>
            {eyebrow}
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', margin: '0 0 14px 0' }}>
            {headline}
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, color: C.slate, margin: '0 0 22px 0' }}>
            {subhead}
          </p>

          {/* Primary CTA (above the fold) */}
          <Link href="/get-started" style={{
            display: 'block', textAlign: 'center', background: C.ink, color: '#fff', textDecoration: 'none',
            padding: '16px 20px', borderRadius: 12, fontWeight: 700, fontSize: 17, marginBottom: 10,
            boxShadow: '0 4px 12px rgba(15,23,42,0.18)',
          }}>
            Start for $99/year — Founding Rate
          </Link>
          <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginBottom: 26 }}>
            First Dismissal Guarantee · Cancel anytime
          </div>

          {/* Big stat */}
          {stat && (
            <div style={{ background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 22 }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: C.danger, letterSpacing: '-0.02em', lineHeight: 1 }}>{stat.big}</div>
              <div style={{ fontSize: 13, color: '#991B1B', marginTop: 10, lineHeight: 1.4 }}>{stat.label}</div>
            </div>
          )}

          {/* How it works — pulled from the brief */}
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 14 }}>How Autopilot works for you</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: C.slate, fontSize: 14, lineHeight: 1.7 }}>
              {bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: 8 }}>{b}</li>
              ))}
            </ul>
          </div>

          {/* The moat — brief-style specifics */}
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 14 }}>Why this works when nothing else has</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 14, color: C.slate, lineHeight: 1.6 }}>
              <Bullet title="We detect the ticket before you do.">
                Our bot hits the City&apos;s payment portal twice a week for your plate. When a ticket posts, we know within 3 days — long before the 21-day contest deadline.
              </Bullet>
              <Bullet title="AI-drafted letter with real evidence.">
                Claude AI pulls weather records (for snow-ban defenses), Google Street View (for missing-sign defenses), 311 complaints (for sign-down defenses), construction permits, and camera malfunction history. Your letter is assembled from facts, not form text.
              </Bullet>
              <Bullet title="Printed and mailed USPS on Day 17.">
                Four days before the deadline — no printer, no stamp, no downtown hearing. You don&apos;t lift a finger.
              </Bullet>
              <Bullet title="Judge-tuned arguments.">
                We profile all 74 Chicago hearing officers from 1.2M historical outcomes. Win rates range from 35% to 71% depending on assignment — we tune the letter to the judge.
              </Bullet>
              <Bullet title="Competitors would charge $150+ per ticket.">
                A ticket lawyer charges $150–$300 to draft one letter. The average Chicago driver has 2.2 tickets/year. At $99/yr unlimited, Autopilot is 3–6× cheaper than hiring it out once.
              </Bullet>
            </div>
          </div>

          {/* Math block */}
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 12 }}>The math (Chicago FOIA data)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Stat value="$234" label="avg avoidable per Chicago driver/year" />
              <Stat value="66%" label="contested parking tickets dismissed" />
              <Stat value="94%" label="tickets never contested" />
              <Stat value="~7 hrs" label="DIY contest time per year (we do it for you)" />
              <Stat value="48,000" label="boots issued in Chicago last year" />
              <Stat value="$99" label="Autopilot, all year, all tickets" />
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 14, lineHeight: 1.5 }}>
              Sources: DOF FOIA F129773 (2025 ticket data, 5.25M rows); Chicago 2025 Budget Ordinance Fund 0300 (Impoundment Fees $14.7M, Sale of Impounded Autos $2.2M). Chicago-resident share (63.2%) from zipcode analysis of 2025 FOIA. 1.18M Chicago vehicles per U.S. Census ACS. DIY time = 2.2 tickets/yr × ~3 hrs/ticket end-to-end.
            </div>
          </div>

          {/* Guarantee */}
          <div style={{ background: C.okBg, border: `1px solid ${C.okBorder}`, borderRadius: 14, padding: 20, marginBottom: 26 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ok }}>First Dismissal Guarantee</div>
            <div style={{ fontSize: 13, color: C.ok, marginTop: 6, lineHeight: 1.5 }}>
              If we don&apos;t help you avoid every ticket or get at least one dismissed in your first year, full refund. Your first dismissed ticket pays for the year.
            </div>
          </div>

          {/* Secondary CTA */}
          <Link href="/get-started" style={{
            display: 'block', textAlign: 'center', background: C.brand, color: C.ink, textDecoration: 'none',
            padding: '16px 20px', borderRadius: 12, fontWeight: 800, fontSize: 17,
            boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
          }}>
            Become a Founding Member → $99/yr
          </Link>
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <Link href="/pricing" style={{ color: C.muted, fontSize: 13, textDecoration: 'underline' }}>
              See the full pricing &amp; guarantee
            </Link>
          </div>
        </main>
      </div>
    </>
  );
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontWeight: 700, color: C.ink, marginBottom: 2 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: C.bgSoft, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.3 }}>{label}</div>
    </div>
  );
}
