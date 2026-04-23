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
  brandInk: '#166534',
  bg: '#FFFFFF',
  bgSoft: '#F8FAFC',
  border: '#E2E8F0',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',
  okBg: '#F0FDF4',
  okBorder: '#BBF7D0',
};

export interface FlyerProps {
  flyerKey: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  stat?: { big: string; label: string };
  bullets: string[];
}

export default function FlyerLanding({ flyerKey, eyebrow, headline, subhead, stat, bullets }: FlyerProps) {
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
      <div style={{
        minHeight: '100vh',
        background: C.bgSoft,
        color: C.ink,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.5,
      }}>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 64px' }}>

          {/* Brand */}
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.brand, textTransform: 'uppercase', marginBottom: 20 }}>
            Autopilot America
          </div>

          {/* Hero */}
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.danger, textTransform: 'uppercase', marginBottom: 10 }}>
            {eyebrow}
          </div>
          <h1 style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', margin: '0 0 18px 0' }}>
            {headline}
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: C.slate, margin: '0 0 28px 0' }}>
            {subhead}
          </p>

          {/* Primary CTA */}
          <Link href="/get-started" style={{
            display: 'block', textAlign: 'center', background: C.ink, color: '#fff', textDecoration: 'none',
            padding: '18px 22px', borderRadius: 14, fontWeight: 800, fontSize: 18, marginBottom: 12,
            boxShadow: '0 6px 16px rgba(15,23,42,0.22)',
          }}>
            Become a Founding Member — $99/year
          </Link>
          <div style={{ textAlign: 'center', fontSize: 13, color: C.muted, marginBottom: 36 }}>
            First Dismissal Guarantee · Cancel anytime · Chicago only
          </div>

          {/* Big stat */}
          {stat && (
            <Card style={{ background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, textAlign: 'center', padding: 28 }}>
              <div style={{ fontSize: 48, fontWeight: 800, color: C.danger, letterSpacing: '-0.02em', lineHeight: 1 }}>{stat.big}</div>
              <div style={{ fontSize: 14, color: '#991B1B', marginTop: 14, lineHeight: 1.5, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>{stat.label}</div>
            </Card>
          )}

          {/* How it works */}
          <Card>
            <SectionTitle>How Autopilot works for you</SectionTitle>
            <ul style={{ margin: 0, paddingLeft: 22, color: C.slate, fontSize: 15, lineHeight: 1.75 }}>
              {bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: 10 }}>{b}</li>
              ))}
            </ul>
          </Card>

          {/* What's covered — alerts list, standardized */}
          <Card>
            <SectionTitle>Every Chicago parking rule — covered.</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 6 }}>
              {[
                'Street cleaning',
                'Snow ban routes',
                'Residential permit zones',
                'Metered parking',
                'Red-light cameras',
                'Speed cameras',
                'City sticker / plate renewal',
              ].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: C.slate }}>
                  <span style={{ color: C.brand, fontWeight: 800, fontSize: 16 }}>✓</span>
                  {item}
                </div>
              ))}
            </div>
          </Card>

          {/* Why it works */}
          <Card>
            <SectionTitle>Why this works when nothing else has</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Fact
                title="We detect the ticket before you do."
                body="Our bot hits the City&rsquo;s payment portal twice a week for your plate. When a ticket posts, we know within 3 days — long before the 21-day contest deadline."
              />
              <Fact
                title="AI-drafted letter with real evidence."
                body="Claude AI pulls weather records, Google Street View signage photos, 311 complaints, construction permits, and camera malfunction history. Your letter is built from facts, not form text."
              />
              <Fact
                title="Printed and USPS-mailed on Day 17."
                body="Four days before the legal deadline. No printer, no stamp, no downtown hearing. You don&rsquo;t lift a finger."
              />
              <Fact
                title="Judge-tuned arguments."
                body="We profile all 74 Chicago hearing officers from 1.2M historical outcomes. Win rates swing 2× depending on who hears your case — we tune the letter to the judge."
              />
              <Fact
                title="Competitors would charge $150+ per ticket."
                body="A ticket lawyer charges $150–$300 to draft one letter. The average Chicago driver has 2.2 tickets/year. At $99/year unlimited, Autopilot is 3–6× cheaper than hiring it out once."
              />
            </div>
          </Card>

          {/* Math */}
          <Card>
            <SectionTitle>The math (Chicago FOIA data)</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <Stat value="$234" label="avg avoidable/year per Chicago driver" />
              <Stat value="66%" label="contested parking tickets dismissed" />
              <Stat value="94%" label="tickets never contested" />
              <Stat value="~7 hrs" label="DIY contest time per year" />
              <Stat value="51,000" label="Chicago boots issued in 2024" />
              <Stat value="81,000" label="Chicago tows issued in 2024" />
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 16, lineHeight: 1.6 }}>
              Sources: DOF FOIA F129773 (2025 ticket data, 5.25M rows, avg initial fine $68.76). Chicago 2025 Budget Ordinance p.23 (Impoundment Fees $14.7M, Sale of Impounded Autos $2.2M). Boots from FOIA boot_counts table (51,005 in 2024). Tows from DSS statement to CBS News Chicago, July 2025 (URT 58,245 + DSS 22,877 = 81,122 in 2024). 1.18M Chicago vehicles per U.S. Census ACS.
            </div>
          </Card>

          {/* Guarantee */}
          <Card style={{ background: C.okBg, border: `1px solid ${C.okBorder}` }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.brandInk, marginBottom: 8 }}>First Dismissal Guarantee</div>
            <div style={{ fontSize: 14, color: C.brandInk, lineHeight: 1.6 }}>
              If we don&rsquo;t help you avoid every ticket or get at least one dismissed in your first year, full refund. Your first dismissed ticket pays for the year.
            </div>
          </Card>

          {/* Final CTA */}
          <Link href="/get-started" style={{
            display: 'block', textAlign: 'center', background: C.brand, color: C.ink, textDecoration: 'none',
            padding: '18px 22px', borderRadius: 14, fontWeight: 800, fontSize: 18, marginTop: 8,
            boxShadow: '0 6px 16px rgba(16,185,129,0.28)',
          }}>
            Start Protecting Your Car → $99/yr
          </Link>
          <div style={{ textAlign: 'center', marginTop: 22 }}>
            <Link href="/pricing" style={{ color: C.muted, fontSize: 13, textDecoration: 'underline' }}>
              See the full pricing &amp; guarantee
            </Link>
          </div>
        </main>
      </div>
    </>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: 24,
      marginBottom: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 16, letterSpacing: '-0.01em' }}>
      {children}
    </div>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div style={{ fontWeight: 700, color: C.ink, marginBottom: 4, fontSize: 15 }}>{title}</div>
      <div style={{ color: C.slate, fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: C.bgSoft, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}
