import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import TicketContester from '../components/TicketContester';

export default function ContestTicket() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/contest-ticket');
        return;
      }

      setUser(currentUser);
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/contest-ticket');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#6b7280' }}>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Contest Your Ticket - Autopilot America</title>
        <meta name="description" content="Automatically generate professional contest letters for parking tickets" />
        <style>{`
          @media (max-width: 768px) {
            header {
              height: 70px !important;
              padding: 0 12px !important;
            }
            header > div:first-child {
              margin-right: 8px !important;
            }
            header > div:first-child > div:first-child {
              width: 42px !important;
              height: 42px !important;
              font-size: 22px !important;
            }
            header > div:first-child > div:last-child > span:first-child {
              font-size: 20px !important;
            }
            header > div:first-child > div:last-child > span:last-child {
              font-size: 10px !important;
            }
            header > div:last-child {
              gap: 8px !important;
            }
            header > div:last-child button {
              font-size: 13px !important;
            }
          }
        `}</style>
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: '24px'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Autopilot
            </span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: '#666',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            ← Back to Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '120px 16px 60px 16px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '12px' }}>
            <h1 style={{
              fontSize: '38px',
              fontWeight: 'bold',
              color: '#111827',
              margin: 0
            }}>
              Contest Your Ticket
            </h1>
            <span style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              letterSpacing: '0.5px'
            }}>
              BETA
            </span>
          </div>
          <p style={{
            fontSize: '18px',
            color: '#6b7280',
            margin: 0,
            lineHeight: '1.6'
          }}>
            Upload a photo of your ticket and we'll analyze it, help you identify grounds for contesting,
            and generate a professional contest letter with an evidence checklist.
          </p>
        </div>

        <TicketContester userId={user.id} />

        {/* Info Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e5e7eb',
          marginTop: '24px'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>
            How It Works
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                fontWeight: '600',
                color: '#2563eb',
                flexShrink: 0
              }}>1</div>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', margin: '0 0 4px 0' }}>
                  Upload Your Ticket
                </h4>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                  Take a photo of your parking ticket (front side with all details visible).
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                fontWeight: '600',
                color: '#2563eb',
                flexShrink: 0
              }}>2</div>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', margin: '0 0 4px 0' }}>
                  AI Extracts Details
                </h4>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                  Our AI reads the ticket and extracts ticket number, violation code, amount, location, and date.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                fontWeight: '600',
                color: '#2563eb',
                flexShrink: 0
              }}>3</div>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', margin: '0 0 4px 0' }}>
                  Select Contest Grounds
                </h4>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                  Choose the reasons why you believe the ticket was issued incorrectly.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                fontWeight: '600',
                color: '#2563eb',
                flexShrink: 0
              }}>4</div>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', margin: '0 0 4px 0' }}>
                  Get Your Letter & Checklist
                </h4>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                  Receive a professionally formatted contest letter and evidence checklist. Print, sign, and mail!
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Note */}
        <div style={{
          marginTop: '24px',
          padding: '16px',
          backgroundColor: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '8px'
        }}>
          <p style={{ fontSize: '13px', color: '#92400e', margin: 0, lineHeight: '1.5' }}>
            <strong>Note:</strong> This tool generates contest letters based on your input. It does not provide legal advice.
            For complex cases or if you need additional support, consider consulting with a traffic attorney.
          </p>
        </div>
      </main>
    </div>
  );
}
