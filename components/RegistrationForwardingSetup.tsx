import { useState, useEffect } from 'react';
import { CheckCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';

interface RegistrationForwardingSetupProps {
  forwardingEmail: string;
  /** Compact mode for embedding in /start funnel or /settings card */
  compact?: boolean;
  /** User's email — used to auto-detect their email provider */
  userEmail?: string;
}

const CITY_STICKER_SENDER = 'chicagovehiclestickers@sebis.com';
const PLATE_STICKER_SENDER = 'ecommerce@ilsos.gov';

type EmailProvider = 'gmail' | 'outlook' | 'yahoo' | 'apple' | null;

function detectProvider(email: string | undefined): EmailProvider {
  if (!email) return null;
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail';
  if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com' || domain === 'msn.com') return 'outlook';
  if (domain === 'yahoo.com' || domain === 'ymail.com' || domain === 'rocketmail.com') return 'yahoo';
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com') return 'apple';
  return null;
}

/** Gmail filter creation URL — opens with "From" pre-filled with both sticker senders */
function gmailFilterUrl(): string {
  const from = `${CITY_STICKER_SENDER} OR ${PLATE_STICKER_SENDER}`;
  return `https://mail.google.com/mail/u/0/#create-filter/from=${encodeURIComponent(from)}`;
}

export default function RegistrationForwardingSetup({ forwardingEmail, compact, userEmail }: RegistrationForwardingSetupProps) {
  const [copied, setCopied] = useState(false);
  const detected = detectProvider(userEmail);
  const [provider, setProvider] = useState<EmailProvider>(detected);

  // Update provider when userEmail becomes available (e.g. after auth loads)
  useEffect(() => {
    const d = detectProvider(userEmail);
    if (d) setProvider(d);
  }, [userEmail]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(forwardingEmail);
    } catch {
      // Fallback for non-HTTPS / older browsers
      const ta = document.createElement('textarea');
      ta.value = forwardingEmail;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {/* ── Forwarding address + copy ── */}
      <div style={{
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
        padding: compact ? '12px 14px' : '14px 16px',
        marginBottom: compact ? 14 : 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF' }}>Your forwarding address:</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <code style={{
            fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace',
            fontSize: 12,
            color: '#1E3A8A',
            backgroundColor: '#DBEAFE',
            padding: '5px 8px',
            borderRadius: 6,
            wordBreak: 'break-all',
            flex: '1 1 auto',
            minWidth: 0,
          }}>
            {forwardingEmail}
          </code>
          <button
            onClick={copyToClipboard}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              color: '#FFFFFF',
              backgroundColor: copied ? '#10B981' : '#2563EB',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'background-color 0.2s',
            }}
          >
            {copied ? (
              <>
                <CheckCircleIcon style={{ width: 14, height: 14 }} />
                Copied
              </>
            ) : (
              <>
                <ClipboardDocumentIcon style={{ width: 14, height: 14 }} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Provider picker ── */}
      <div style={{ marginBottom: compact ? 10 : 14 }}>
        <p style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#0F172A',
          margin: '0 0 8px',
        }}>
          {detected ? 'Setup instructions:' : 'What email do you use?'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([
            { id: 'gmail' as const, label: 'Gmail' },
            { id: 'outlook' as const, label: 'Outlook' },
            { id: 'yahoo' as const, label: 'Yahoo' },
            { id: 'apple' as const, label: 'Apple Mail' },
          ] as const).map(p => (
            <button
              key={p.id}
              onClick={() => setProvider(provider === p.id ? null : p.id)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                border: provider === p.id ? '1.5px solid #2563EB' : '1.5px solid #CBD5E1',
                backgroundColor: provider === p.id ? '#2563EB' : '#FFFFFF',
                color: provider === p.id ? '#FFFFFF' : '#334155',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Provider-specific instructions ── */}
      {provider === 'gmail' && (
        <GmailInstructions forwardingEmail={forwardingEmail} copied={copied} onCopy={copyToClipboard} />
      )}
      {provider === 'outlook' && (
        <OutlookInstructions forwardingEmail={forwardingEmail} />
      )}
      {provider === 'yahoo' && (
        <YahooInstructions forwardingEmail={forwardingEmail} />
      )}
      {provider === 'apple' && (
        <AppleMailInstructions forwardingEmail={forwardingEmail} />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Gmail — 3-click flow using direct filter creation URL
   ──────────────────────────────────────────────────────────────── */
function GmailInstructions({ forwardingEmail, copied, onCopy }: {
  forwardingEmail: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const filterUrl = gmailFilterUrl();

  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid #E2E8F0',
      backgroundColor: '#FFFFFF',
      padding: 16,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 14,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Gmail setup</span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#10B981',
          backgroundColor: '#ECFDF5',
          padding: '2px 8px',
          borderRadius: 10,
        }}>
          3 clicks
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Step n={1}>
          <p style={{ margin: 0 }}>
            <strong>Copy</strong> your forwarding address above, then{' '}
            <a
              href={filterUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'underline' }}
            >
              open Gmail filter setup
            </a>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
            This opens Gmail with the city sticker and plate sticker senders already filled in.
          </p>
        </Step>
        <Step n={2}>
          <p style={{ margin: 0 }}>
            Click <strong>&quot;Create filter&quot;</strong> to advance to the next screen. Check <strong>&quot;Forward it to&quot;</strong> and paste the address you copied.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
            If the address isn&apos;t in the dropdown, click &quot;Add forwarding address&quot; — Gmail will send a verification email that we confirm automatically.
          </p>
        </Step>
        <Step n={3}>
          <p style={{ margin: 0 }}>
            Click <strong>&quot;Create filter&quot;</strong> — done. Receipts forward automatically from now on.
          </p>
        </Step>
      </div>

      <div style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: '1px solid #F1F5F9',
        fontSize: 12,
        color: '#64748B',
      }}>
        Both senders are included in one filter: <code style={{ backgroundColor: '#F1F5F9', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{CITY_STICKER_SENDER}</code> and <code style={{ backgroundColor: '#F1F5F9', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{PLATE_STICKER_SENDER}</code>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Outlook
   ──────────────────────────────────────────────────────────────── */
function OutlookInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid #E2E8F0',
      backgroundColor: '#FFFFFF',
      padding: 16,
    }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', margin: '0 0 14px' }}>Outlook setup</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Step n={1}>
          <p style={{ margin: 0 }}>
            Open{' '}
            <a href="https://outlook.live.com/mail/0/options/mail/rules" target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'underline' }}>
              Outlook Mail Rules
            </a>
            {' '}and click <strong>&quot;Add new rule&quot;</strong>
          </p>
        </Step>
        <Step n={2}>
          <p style={{ margin: 0 }}>
            Name it <strong>&quot;Sticker Receipts&quot;</strong>. Under condition, select <strong>&quot;From&quot;</strong> and enter:
          </p>
          <code style={codeBlockStyle}>{CITY_STICKER_SENDER}</code>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748B' }}>
            Add a second &quot;From&quot; condition for: <code style={inlineCodeStyle}>{PLATE_STICKER_SENDER}</code>
          </p>
        </Step>
        <Step n={3}>
          <p style={{ margin: 0 }}>
            Under action, select <strong>&quot;Forward to&quot;</strong> and paste your forwarding address:
          </p>
          <code style={codeBlockStyle}>{forwardingEmail}</code>
        </Step>
        <Step n={4}>
          <p style={{ margin: 0 }}>Click <strong>&quot;Save&quot;</strong> — done.</p>
        </Step>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Yahoo
   ──────────────────────────────────────────────────────────────── */
function YahooInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid #E2E8F0',
      backgroundColor: '#FFFFFF',
      padding: 16,
    }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', margin: '0 0 14px' }}>Yahoo Mail setup</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Step n={1}>
          <p style={{ margin: 0 }}>
            Open Yahoo Mail &rarr; <strong>Settings</strong> (gear icon) &rarr; <strong>More Settings</strong> &rarr; <strong>Filters</strong>
          </p>
        </Step>
        <Step n={2}>
          <p style={{ margin: 0 }}>
            Click <strong>&quot;Add new filters&quot;</strong>, name it <strong>&quot;Sticker Receipts&quot;</strong>
          </p>
        </Step>
        <Step n={3}>
          <p style={{ margin: 0 }}>
            Set <strong>&quot;From&quot;</strong> contains: <code style={inlineCodeStyle}>{CITY_STICKER_SENDER}</code>
          </p>
        </Step>
        <Step n={4}>
          <p style={{ margin: 0 }}>
            Yahoo doesn&apos;t support per-filter forwarding. Set up full forwarding instead:
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
            Settings &rarr; More Settings &rarr; Mailboxes &rarr; Your account &rarr; Forwarding &rarr; add your forwarding address. Use the filter above to label sticker emails for organization.
          </p>
        </Step>
      </div>
      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, backgroundColor: '#FEF3C7', fontSize: 12, color: '#92400E' }}>
        Or simply forward the receipt when we ask for it — we&apos;ll remind you if you get ticketed.
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Apple Mail
   ──────────────────────────────────────────────────────────────── */
function AppleMailInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid #E2E8F0',
      backgroundColor: '#FFFFFF',
      padding: 16,
    }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', margin: '0 0 14px' }}>Apple Mail setup</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Step n={1}>
          <p style={{ margin: 0 }}>
            <strong>On iCloud.com</strong> (recommended — always on): Mail &rarr; Settings (gear) &rarr; Rules &rarr; &quot;Add a Rule&quot;
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
            On Mac: Mail &rarr; Settings &rarr; Rules tab &rarr; &quot;Add Rule&quot; (only runs when Mail is open)
          </p>
        </Step>
        <Step n={2}>
          <p style={{ margin: 0 }}>
            Set condition: <strong>&quot;From&quot;</strong> contains <code style={inlineCodeStyle}>{CITY_STICKER_SENDER}</code>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
            Add a second rule for <code style={inlineCodeStyle}>{PLATE_STICKER_SENDER}</code>
          </p>
        </Step>
        <Step n={3}>
          <p style={{ margin: 0 }}>
            Set action: <strong>&quot;Forward to&quot;</strong> and paste:
          </p>
          <code style={codeBlockStyle}>{forwardingEmail}</code>
        </Step>
        <Step n={4}>
          <p style={{ margin: 0 }}>Click <strong>&quot;OK&quot;</strong> / <strong>&quot;Done&quot;</strong> — done.</p>
        </Step>
      </div>
    </div>
  );
}

/* ── Shared ── */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        borderRadius: '50%',
        backgroundColor: '#EFF6FF',
        color: '#2563EB',
        fontSize: 12,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
      }}>
        {n}
      </span>
      <div style={{ flex: 1, fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  );
}

const codeBlockStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
  fontSize: 12,
  color: '#1E3A8A',
  backgroundColor: '#EFF6FF',
  padding: '6px 10px',
  borderRadius: 6,
  wordBreak: 'break-all',
};

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
  fontSize: 11,
  backgroundColor: '#F1F5F9',
  padding: '1px 5px',
  borderRadius: 3,
};
