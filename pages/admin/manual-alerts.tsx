import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

export default function ManualAlerts() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [alertType, setAlertType] = useState<'email' | 'sms' | 'both'>('both');
  const [recipients, setRecipients] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [sentLog, setSentLog] = useState<string[]>([]);

  const isDryRun = process.env.DRY_RUN === 'true' || process.env.NEXT_PUBLIC_DRY_RUN === 'true';

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      setUser(user);

      // Check if user is admin
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (error || profile?.role !== 'admin') {
        setMessage('Access denied. Admin role required.');
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      setLoading(false);
    };

    checkAdmin();
  }, [router]);

  const handleSendAlerts = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMessage('');
    setSentLog([]);

    try {
      // Parse recipients (comma-separated emails or CSVformat)
      const recipientList = recipients
        .split(/[,\n]/)
        .map(r => r.trim())
        .filter(r => r && r.includes('@'));

      if (recipientList.length === 0) {
        throw new Error('No valid email addresses found');
      }

      console.log(`Sending ${alertType} alerts to ${recipientList.length} recipients`);

      const results = [];

      for (const email of recipientList) {
        // Get user by email
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, phone_number, email')
          .eq('email', email)
          .single();

        if (profileError || !profile) {
          results.push(`❌ ${email}: User not found`);
          continue;
        }

        // Send alert via API
        const response = await fetch('/api/admin/send-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: profile.email,
            phone: profile.phone_number,
            message: alertMessage,
            type: alertType,
            dryRun: isDryRun
          })
        });

        const result = await response.json();

        if (response.ok) {
          results.push(`✅ ${email}: ${isDryRun ? '[DRY RUN] ' : ''}Sent successfully`);
        } else {
          results.push(`❌ ${email}: ${result.error}`);
        }
      }

      setSentLog(results);
      setMessage(`${isDryRun ? '[DRY RUN] ' : ''}Processed ${recipientList.length} alerts`);

    } catch (error: any) {
      console.error('Send alerts error:', error);
      setMessage(`Error: ${error.message}`);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Access Denied</h2>
          <p style={{ color: '#666', marginBottom: '24px' }}>Admin role required to access this page.</p>
          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              cursor: 'pointer'
            }}
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Manual Alerts - Admin - Ticketless America</title>
      </Head>

      {/* Header */}
      <header style={{
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', margin: 0 }}>
              Manual Alerts
            </h1>
            <p style={{ fontSize: '14px', color: '#666', margin: '4px 0 0 0' }}>
              Admin Tool {isDryRun && '- DRY RUN MODE (no messages will be sent)'}
            </p>
          </div>
          <button
            onClick={() => router.push('/settings')}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Back to Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 24px' }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }}>
          <form onSubmit={handleSendAlerts} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Alert Type
              </label>
              <select
                value={alertType}
                onChange={(e) => setAlertType(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  backgroundColor: 'white'
                }}
              >
                <option value="both">Email + SMS</option>
                <option value="email">Email Only</option>
                <option value="sms">SMS Only</option>
              </select>
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Recipients (comma-separated emails or one per line)
              </label>
              <textarea
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                required
                rows={6}
                placeholder="user1@example.com, user2@example.com"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Alert Message
              </label>
              <textarea
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                required
                rows={4}
                placeholder="Street cleaning alert: Tomorrow 9am-11am on your block..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {message && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                color: message.includes('Error') ? '#dc2626' : '#166534',
                border: '1px solid',
                borderColor: message.includes('Error') ? '#fecaca' : '#bbf7d0',
                fontSize: '14px'
              }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={sending}
              style={{
                backgroundColor: sending ? '#9ca3af' : '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '16px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: sending ? 'not-allowed' : 'pointer'
              }}
            >
              {sending ? 'Sending...' : `${isDryRun ? '[DRY RUN] ' : ''}Send Alerts`}
            </button>
          </form>

          {sentLog.length > 0 && (
            <div style={{ marginTop: '32px' }}>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '16px',
                margin: '0 0 16px 0'
              }}>
                Send Log:
              </h3>
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                padding: '16px',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                {sentLog.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: '14px',
                      fontFamily: 'monospace',
                      padding: '4px 0',
                      color: log.startsWith('✅') ? '#166534' : '#dc2626'
                    }}
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}