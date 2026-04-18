import React, { useState } from 'react';
import Head from 'next/head';

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

const COLORS = {
  bg: '#020617',
  card: '#0F172A',
  accent: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  white: '#FFFFFF',
  muted: '#64748B',
  border: 'rgba(255,255,255,0.08)',
};

type Slide = {
  id: string;
  title: string;
  content: React.ReactNode;
};

const slides: Slide[] = [
  {
    id: 'hook',
    title: 'The Judge Lottery',
    content: (
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '18px', color: COLORS.muted, marginBottom: '32px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700 }}>
          City of Chicago FOIA Data
        </p>
        <div style={{ fontFamily: FONTS.heading, fontSize: 'clamp(48px, 8vw, 96px)', fontWeight: 800, lineHeight: 1.05, marginBottom: '24px' }}>
          1,198,179
        </div>
        <p style={{ fontSize: 'clamp(20px, 3vw, 28px)', color: COLORS.muted, marginBottom: '48px' }}>
          parking ticket hearings analyzed
        </p>
        <div style={{
          display: 'inline-block',
          padding: '16px 32px',
          borderRadius: '16px',
          background: 'rgba(16,185,129,0.1)',
          border: '1px solid rgba(16,185,129,0.3)',
        }}>
          <span style={{ fontFamily: FONTS.heading, fontSize: '28px', fontWeight: 800, color: COLORS.accent }}>54%</span>
          <span style={{ fontSize: '18px', color: COLORS.accent, marginLeft: '12px' }}>of people who contest WIN</span>
        </div>
      </div>
    ),
  },
  {
    id: 'the-spread',
    title: 'The Spread',
    content: (
      <div>
        <p style={{ fontSize: '16px', color: COLORS.muted, marginBottom: '40px', textAlign: 'center' }}>
          65 hearing officers. You don&apos;t pick yours. Here&apos;s what happens.
        </p>
        <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <div style={{
            flex: '1 1 280px', maxWidth: '360px', padding: '32px',
            borderRadius: '20px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '14px', color: COLORS.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
              Michael Quinn
            </div>
            <div style={{ fontFamily: FONTS.heading, fontSize: '72px', fontWeight: 800, color: COLORS.accent, lineHeight: 1 }}>
              70.8%
            </div>
            <div style={{ fontSize: '15px', color: COLORS.muted, marginTop: '8px' }}>dismissed</div>
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)', marginTop: '8px' }}>97,838 hearings</div>
          </div>
          <div style={{
            flex: '1 1 280px', maxWidth: '360px', padding: '32px',
            borderRadius: '20px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '14px', color: COLORS.red, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
              Harriet Parker
            </div>
            <div style={{ fontFamily: FONTS.heading, fontSize: '72px', fontWeight: 800, color: COLORS.red, lineHeight: 1 }}>
              29.9%
            </div>
            <div style={{ fontSize: '15px', color: COLORS.muted, marginTop: '8px' }}>dismissed</div>
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)', marginTop: '8px' }}>5,504 hearings</div>
          </div>
        </div>
        <p style={{ textAlign: 'center', color: COLORS.muted, marginTop: '32px', fontSize: '15px' }}>
          Both are currently employed. Both are on the city&apos;s ALJ roster.
        </p>
      </div>
    ),
  },
  {
    id: 'head-to-head',
    title: 'Head to Head',
    content: (
      <div>
        <p style={{ fontSize: '15px', color: COLORS.muted, marginBottom: '24px', textAlign: 'center' }}>
          Same violations. Same contest methods. Same time period.
        </p>
        <div style={{ borderRadius: '16px', overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.body, fontSize: '15px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLORS.border}` }}>
                <th style={{ padding: '14px 16px', textAlign: 'left', color: COLORS.muted, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Violation</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', color: COLORS.accent, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quinn</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', color: COLORS.red, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Parker</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', color: COLORS.muted, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Expired Plates', quinn: 91.5, parker: 29.0 },
                { name: 'No City Sticker', quinn: 81.3, parker: 37.9 },
                { name: 'Residential Permit', quinn: 81.4, parker: 26.1 },
                { name: 'Street Cleaning', quinn: 72.3, parker: 10.9 },
                { name: 'Expired Meter', quinn: 84.2, parker: 55.9 },
                { name: 'No Parking Anytime', quinn: 71.7, parker: 26.6 },
                { name: 'Red Light Camera', quinn: 27.0, parker: 2.0 },
                { name: 'Speed Camera', quinn: 26.2, parker: 10.2 },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '12px 16px', color: COLORS.white, fontWeight: 500 }}>{row.name}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.accent, fontFamily: FONTS.heading, fontWeight: 700 }}>{row.quinn}%</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.red, fontFamily: FONTS.heading, fontWeight: 700 }}>{row.parker}%</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.amber, fontFamily: FONTS.heading, fontWeight: 700 }}>{(row.quinn / row.parker).toFixed(1)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
  },
  {
    id: 'same-caseload',
    title: 'Same Caseload',
    content: (
      <div>
        <p style={{ fontSize: '18px', color: COLORS.white, marginBottom: '8px', textAlign: 'center', fontWeight: 600 }}>
          &ldquo;Maybe Parker just gets harder cases?&rdquo;
        </p>
        <p style={{ fontSize: '15px', color: COLORS.muted, marginBottom: '32px', textAlign: 'center' }}>
          We checked. The caseload mix is nearly identical.
        </p>
        <div style={{ borderRadius: '16px', overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.body, fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLORS.border}` }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>Judge</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>% Camera</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>% Plates</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>% Meter</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>% Cleaning</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>Dismiss</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Quinn', camera: '19.1%', plates: '15.6%', meter: '24.1%', cleaning: '5.8%', dismiss: '70.8%', color: COLORS.accent },
                { name: 'McHugh', camera: '21.2%', plates: '14.9%', meter: '20.5%', cleaning: '6.0%', dismiss: '58.2%', color: COLORS.white },
                { name: 'Morris', camera: '16.6%', plates: '16.5%', meter: '24.7%', cleaning: '6.3%', dismiss: '51.7%', color: COLORS.white },
                { name: 'Padilla', camera: '17.9%', plates: '13.8%', meter: '21.1%', cleaning: '6.1%', dismiss: '53.9%', color: COLORS.white },
                { name: 'Parker', camera: '17.6%', plates: '14.3%', meter: '22.2%', cleaning: '5.0%', dismiss: '29.9%', color: COLORS.red },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '12px 16px', color: row.color, fontWeight: 700 }}>{row.name}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.white }}>{row.camera}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.white }}>{row.plates}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.white }}>{row.meter}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: COLORS.white }}>{row.cleaning}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: row.color, fontFamily: FONTS.heading, fontWeight: 800, fontSize: '16px' }}>{row.dismiss}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ textAlign: 'center', color: COLORS.amber, marginTop: '24px', fontSize: '15px', fontWeight: 600 }}>
          Same types of tickets. Dramatically different outcomes.
        </p>
      </div>
    ),
  },
  {
    id: 'punchline',
    title: 'The Punchline',
    content: (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(24px, 4vw, 36px)',
          fontWeight: 800,
          lineHeight: 1.3,
          marginBottom: '40px',
          maxWidth: '700px',
          margin: '0 auto 40px',
        }}>
          Whether your $200 ticket gets dismissed depends more on which officer you draw than whether you did anything wrong.
        </div>
        <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '48px' }}>
          {[
            { stat: '94%', label: 'never contest' },
            { stat: '54%', label: 'of contesters win' },
            { stat: '$420M', label: 'billed in 2025' },
          ].map((item, i) => (
            <div key={i} style={{
              padding: '24px 32px', borderRadius: '16px',
              background: 'rgba(255,255,255,0.04)', border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ fontFamily: FONTS.heading, fontSize: '36px', fontWeight: 800, color: COLORS.accent }}>{item.stat}</div>
              <div style={{ fontSize: '13px', color: COLORS.muted, marginTop: '4px' }}>{item.label}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '18px', color: COLORS.white, fontWeight: 600, marginBottom: '8px' }}>
          The city is counting on you not fighting back.
        </p>
        <p style={{ fontSize: '14px', color: COLORS.muted }}>
          Source: City of Chicago FOIA &middot; 1.2M hearing records &middot; 35.7M ticket records (2018&ndash;2025)
        </p>
      </div>
    ),
  },
  {
    id: 'all-judges',
    title: 'All Current Judges',
    content: (
      <div>
        <p style={{ fontSize: '14px', color: COLORS.muted, marginBottom: '20px', textAlign: 'center' }}>
          All currently employed ALJs with 500+ decided hearings, ranked by dismissal rate.
        </p>
        <div style={{ borderRadius: '16px', overflow: 'hidden', border: `1px solid ${COLORS.border}`, maxHeight: '480px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.body, fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLORS.border}`, position: 'sticky', top: 0, background: COLORS.card }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>Judge</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>Hearings</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase' }}>Dismiss %</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase', width: '40%' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Michael Quinn', hearings: '97,838', pct: 70.8 },
                { name: 'Karen L. Riley', hearings: '11,718', pct: 68.8 },
                { name: 'Joseph Chico', hearings: '6,535', pct: 66.2 },
                { name: 'Bernadette Freeman', hearings: '20,261', pct: 64.6 },
                { name: 'Martin Kennelly Jr.', hearings: '39,009', pct: 63.7 },
                { name: 'Eli R. Johnson', hearings: '8,897', pct: 63.0 },
                { name: 'Zedrick T. Braden', hearings: '7,112', pct: 62.7 },
                { name: 'Kathryn Bailey', hearings: '12,961', pct: 60.6 },
                { name: 'Barbara J. Bell', hearings: '10,349', pct: 60.5 },
                { name: 'Michael Connelly', hearings: '32,851', pct: 59.9 },
                { name: 'Zipporah Lewis', hearings: '4,703', pct: 59.2 },
                { name: 'J. Paula Roderick', hearings: '6,655', pct: 58.8 },
                { name: 'Eileen McHugh', hearings: '54,772', pct: 58.2 },
                { name: 'James Reilly', hearings: '19,386', pct: 58.2 },
                { name: 'Elreta Dickinson', hearings: '36,085', pct: 58.3 },
                { name: 'Jean Brabeck', hearings: '36,270', pct: 56.7 },
                { name: 'Katie Diggins', hearings: '2,126', pct: 56.8 },
                { name: 'Rhonda Walker', hearings: '2,793', pct: 55.7 },
                { name: 'Alfred Quijano', hearings: '31,440', pct: 55.8 },
                { name: 'Urie R. Clark', hearings: '55,427', pct: 55.4 },
                { name: 'Mark Moreno', hearings: '21,976', pct: 55.0 },
                { name: 'Evelyn Ginger Mance', hearings: '20,108', pct: 54.6 },
                { name: 'Jose Padilla', hearings: '48,719', pct: 53.9 },
                { name: 'Mamie Alexander', hearings: '34,382', pct: 53.8 },
                { name: 'Taryn Springs', hearings: '6,339', pct: 52.3 },
                { name: 'Hugo Chaviano', hearings: '25,992', pct: 52.7 },
                { name: 'Mark Boyle', hearings: '27,447', pct: 52.7 },
                { name: 'Jorge Cazares', hearings: '7,503', pct: 52.6 },
                { name: 'Michael Dudek', hearings: '40,467', pct: 52.5 },
                { name: 'Mable Taylor', hearings: '10,224', pct: 52.2 },
                { name: 'Gia L. Morris', hearings: '50,933', pct: 51.7 },
                { name: 'Robert Barber', hearings: '12,692', pct: 50.9 },
                { name: 'Michael Cawley', hearings: '29,325', pct: 50.6 },
                { name: 'Mitchell C. Ex', hearings: '7,659', pct: 50.6 },
                { name: 'Joan Alvarez', hearings: '36,876', pct: 49.3 },
                { name: 'Julie Haran-King', hearings: '31,035', pct: 47.7 },
                { name: 'Denis Guest', hearings: '22,541', pct: 47.6 },
                { name: 'Philip Bernstein', hearings: '14,978', pct: 44.5 },
                { name: 'Mary Jo Strusz', hearings: '7,214', pct: 43.8 },
                { name: 'Kyra Payne', hearings: '3,813', pct: 42.2 },
                { name: 'Ralph Reyna', hearings: '2,736', pct: 43.3 },
                { name: 'Laurie Samuels', hearings: '8,231', pct: 41.0 },
                { name: 'Rodney Stewart', hearings: '14,701', pct: 40.8 },
                { name: 'Harriet J. Parker', hearings: '5,504', pct: 29.9 },
              ].map((row, i) => {
                const color = row.pct >= 60 ? COLORS.accent : row.pct >= 50 ? COLORS.white : row.pct >= 40 ? COLORS.amber : COLORS.red;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: '8px 14px', color: COLORS.white, fontWeight: 500 }}>{row.name}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>{row.hearings}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color, fontFamily: FONTS.heading, fontWeight: 700 }}>{row.pct}%</td>
                    <td style={{ padding: '8px 14px' }}>
                      <div style={{ height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${row.pct}%`, borderRadius: '4px', background: color }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ textAlign: 'center', color: COLORS.muted, marginTop: '16px', fontSize: '12px' }}>
          Source: City of Chicago FOIA &middot; Dept. of Administrative Hearings &middot; 1,198,179 hearing records
        </p>
      </div>
    ),
  },
];

export default function Slides() {
  const [current, setCurrent] = useState(0);
  const slide = slides[current];

  return (
    <div style={{ fontFamily: FONTS.body, backgroundColor: COLORS.bg, color: COLORS.white, minHeight: '100vh' }}>
      <Head>
        <title>The Judge Lottery — Chicago FOIA Data | Autopilot America</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Slide navigation */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 24px', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <span style={{ fontFamily: FONTS.heading, fontWeight: 800, fontSize: '18px' }}>
          AUTOPILOT<span style={{ color: COLORS.accent }}>.</span>
          <span style={{ color: COLORS.muted, fontSize: '14px', fontWeight: 400, marginLeft: '12px' }}>
            /{slide.id}
          </span>
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? '32px' : '8px', height: '8px', borderRadius: '4px',
                backgroundColor: i === current ? COLORS.accent : 'rgba(255,255,255,0.2)',
                border: 'none', cursor: 'pointer', transition: 'all 0.2s',
              }}
            />
          ))}
          <span style={{ color: COLORS.muted, fontSize: '13px', marginLeft: '12px' }}>
            {current + 1}/{slides.length}
          </span>
        </div>
      </div>

      {/* Slide content */}
      <div style={{
        maxWidth: '900px', margin: '0 auto', padding: '100px 24px 80px',
        minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <h2 style={{
          fontFamily: FONTS.heading, fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800,
          textAlign: 'center', marginBottom: '40px', color: COLORS.white,
        }}>
          {slide.title}
        </h2>
        {slide.content}
      </div>

      {/* Navigation buttons */}
      <div style={{
        position: 'fixed', bottom: '24px', left: 0, right: 0,
        display: 'flex', justifyContent: 'center', gap: '16px', zIndex: 10,
      }}>
        <button
          onClick={() => setCurrent(Math.max(0, current - 1))}
          disabled={current === 0}
          style={{
            padding: '12px 24px', borderRadius: '12px', border: `1px solid ${COLORS.border}`,
            background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(8px)',
            color: current === 0 ? COLORS.muted : COLORS.white, cursor: current === 0 ? 'default' : 'pointer',
            fontFamily: FONTS.heading, fontWeight: 600, fontSize: '14px',
          }}
        >
          &larr; Prev
        </button>
        <button
          onClick={() => setCurrent(Math.min(slides.length - 1, current + 1))}
          disabled={current === slides.length - 1}
          style={{
            padding: '12px 24px', borderRadius: '12px', border: 'none',
            background: current === slides.length - 1 ? COLORS.muted : COLORS.accent,
            color: current === slides.length - 1 ? COLORS.white : COLORS.bg,
            cursor: current === slides.length - 1 ? 'default' : 'pointer',
            fontFamily: FONTS.heading, fontWeight: 700, fontSize: '14px',
          }}
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
