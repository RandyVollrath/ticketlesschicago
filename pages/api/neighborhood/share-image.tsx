import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const config = {
  runtime: 'edge',
};

function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#22c55e';
    case 'B': return '#84cc16';
    case 'C': return '#eab308';
    case 'D': return '#f97316';
    case 'F': return '#ef4444';
    default: return '#6b7280';
  }
}

function getChaosLevel(score: number): string {
  if (score >= 90) return 'Surprisingly Chill';
  if (score >= 80) return 'Pretty Decent';
  if (score >= 70) return 'Classic Chicago';
  if (score >= 60) return 'Getting Spicy';
  if (score >= 50) return 'Chaos Mode';
  return 'Total Mayhem';
}

export default async function handler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const grade = searchParams.get('grade') || 'C';
    const score = parseInt(searchParams.get('score') || '70');
    const address = searchParams.get('address') || 'Chicago';

    const gradeColor = getGradeColor(grade);
    const chaosLevel = getChaosLevel(score);

    // Short address for display
    const shortAddress = address.length > 40 ? address.substring(0, 40) + '...' : address;

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
            fontFamily: 'sans-serif',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            <span style={{ fontSize: '36px', marginRight: '12px' }}>🏙️</span>
            <span style={{ color: 'white', fontSize: '28px', fontWeight: 'bold' }}>
              Chicago Block Grade
            </span>
          </div>

          {/* Grade Circle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '180px',
              height: '180px',
              borderRadius: '90px',
              backgroundColor: gradeColor,
              border: '8px solid white',
              marginBottom: '20px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: '100px', fontWeight: 'bold', color: 'white' }}>
              {grade}
            </span>
          </div>

          {/* Score */}
          <div
            style={{
              color: 'white',
              fontSize: '42px',
              fontWeight: 'bold',
              marginBottom: '8px',
            }}
          >
            {score}/100
          </div>

          {/* Chaos Level */}
          <div
            style={{
              color: '#fbbf24',
              fontSize: '32px',
              fontWeight: '600',
              marginBottom: '24px',
            }}
          >
            {chaosLevel}
          </div>

          {/* Address */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.1)',
              padding: '12px 24px',
              borderRadius: '30px',
              marginBottom: '30px',
            }}
          >
            <span style={{ color: '#a5b4fc', fontSize: '20px' }}>
              📍 {shortAddress}
            </span>
          </div>

          {/* CTA */}
          <div
            style={{
              color: '#a5b4fc',
              fontSize: '18px',
            }}
          >
            Check your block at autopilotamerica.com/block-grade
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e) {
    console.error('Error generating image:', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
