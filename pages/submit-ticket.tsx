import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import ReimbursementRequest from '../components/ReimbursementRequest';

export default function SubmitTicket() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasProtection, setHasProtection] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  async function checkAccess() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/submit-ticket');
        return;
      }

      setUser(currentUser);

      // Check if user has protection
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('has_protection')
        .eq('user_id', currentUser.id)
        .single();

      if (!profile?.has_protection) {
        router.push('/protection');
        return;
      }

      setHasProtection(true);
    } catch (error) {
      console.error('Error checking access:', error);
      router.push('/');
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

  if (!hasProtection) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Submit Ticket for Reimbursement - Ticketless America</title>
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
              Ticketless
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
        maxWidth: '800px',
        margin: '0 auto',
        padding: '120px 16px 60px 16px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#111827',
            margin: '0 0 12px 0'
          }}>
            Submit Ticket for Reimbursement
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#6b7280',
            margin: 0
          }}>
            We reimburse 80% of eligible tickets up to $200 per year. Submit your ticket photos and details below.
          </p>
        </div>

        {user && <ReimbursementRequest userId={user.id} />}
      </main>
    </div>
  );
}
