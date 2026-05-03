import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

interface ContestLetter {
  id: string;
  ticket_id: string;
  lifecycle_status: string | null;
  final_amount: number | null;
  autopay_opt_in: boolean | null;
  autopay_mode: string | null;
  autopay_cap_amount: number | null;
  autopay_payment_method_id: string | null;
  autopay_status: string | null;
  paid_at: string | null;
  ticket?: {
    ticket_number: string | null;
    plate: string | null;
    violation_type: string | null;
    violation_date: string | null;
  };
}

const COLORS = {
  primary: '#0052cc',
  text: '#1a1a1a',
  textMuted: '#6b7280',
  border: '#e5e7eb',
  bg: '#ffffff',
  bgSection: '#f9fafb',
  warning: '#f59e0b',
  warningBg: '#fef3c7',
  success: '#16a34a',
  danger: '#dc2626',
};

const AUTOPAY_MODE_OPTIONS = [
  { value: 'off', label: 'Off — never auto-pay' },
  { value: 'full_if_lost', label: 'Pay the full amount if I lose' },
  { value: 'up_to_cap', label: 'Pay if amount is at or below my cap' },
];

export default function AutopayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [letters, setLetters] = useState<ContestLetter[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingLetterId, setSavingLetterId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase!.auth.getSession();
      const session = sessionData?.session;
      if (!session) {
        router.replace('/login?next=/account/autopay');
        return;
      }
      try {
        const userId = session.user.id;
        // Pull all letters for this user that could be autopay-eligible.
        // Hide draft/cancelled/won — autopay only matters for terminal-or-pending payable states.
        const { data, error } = await supabase!
          .from('contest_letters')
          .select(`
            id, ticket_id, lifecycle_status, final_amount,
            autopay_opt_in, autopay_mode, autopay_cap_amount,
            autopay_payment_method_id, autopay_status, paid_at
          `)
          .eq('user_id', userId)
          .not('lifecycle_status', 'in', '(draft,won,closed,paid)')
          .order('lifecycle_status_changed_at', { ascending: false });
        if (error) throw error;
        const letterRows = (data as ContestLetter[]) || [];

        // Hydrate ticket info for display
        const ticketIds = letterRows.map((l) => l.ticket_id).filter(Boolean);
        if (ticketIds.length > 0) {
          const { data: tickets } = await supabase!
            .from('detected_tickets')
            .select('id, ticket_number, plate, violation_type, violation_date')
            .in('id', ticketIds);
          const byId = new Map<string, any>();
          for (const t of tickets || []) byId.set(t.id, t);
          for (const l of letterRows) l.ticket = byId.get(l.ticket_id);
        }

        if (!cancelled) {
          setLetters(letterRows);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMessage(err?.message || 'Failed to load contest letters');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function saveAutopay(letter: ContestLetter, patch: Partial<ContestLetter>) {
    setSavingLetterId(letter.id);
    setErrorMessage(null);
    try {
      const { data: sessionData } = await supabase!.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Not signed in');

      const res = await fetch('/api/contest/autopay-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          contestLetterId: letter.id,
          autopayOptIn: patch.autopay_opt_in ?? letter.autopay_opt_in ?? false,
          autopayMode: patch.autopay_mode ?? letter.autopay_mode,
          autopayCapAmount: patch.autopay_cap_amount ?? letter.autopay_cap_amount,
          refreshDefaultPaymentMethod: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');

      setLetters((prev) =>
        prev.map((l) => (l.id === letter.id ? { ...l, ...json.autopay } : l)),
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Save failed');
    } finally {
      setSavingLetterId(null);
    }
  }

  return (
    <>
      <Head>
        <title>Late Fee Protection — Autopilot America</title>
      </Head>
      <main style={{ maxWidth: 760, margin: '40px auto', padding: '0 20px', color: COLORS.text, fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Late Fee Protection</h1>
        <p style={{ color: COLORS.textMuted, fontSize: 15, lineHeight: 1.6 }}>
          If you lose a contested ticket, the City of Chicago gives you a deadline to pay the fine — miss it and they tack on late fees that often double the bill. Late Fee Protection lets us pay the fine for you automatically before that deadline. We only charge you the exact fine amount; we never add a service fee.
        </p>

        <div style={{ background: COLORS.warningBg, border: `1px solid ${COLORS.warning}`, padding: 14, borderRadius: 8, marginTop: 16, fontSize: 14, color: '#78350f' }}>
          <strong>How it works:</strong> Toggle this on per-ticket. We'll wait for the city to decide your contest. If you lose, we charge the card you have on file with us, then pay the City of Chicago payment portal on your behalf and email you the receipt.
        </div>

        {errorMessage && (
          <div style={{ background: '#fef2f2', border: `1px solid ${COLORS.danger}`, padding: 12, borderRadius: 6, marginTop: 16, color: COLORS.danger }}>
            {errorMessage}
          </div>
        )}

        <div style={{ marginTop: 32 }}>
          {loading ? (
            <p style={{ color: COLORS.textMuted }}>Loading your contest letters…</p>
          ) : letters.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, background: COLORS.bgSection, borderRadius: 8 }}>
              <p style={{ fontSize: 16, color: COLORS.textMuted, margin: 0 }}>You don't have any contested tickets that could use Late Fee Protection right now.</p>
              <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 8 }}>This page will list each contest letter the moment one is filed for you.</p>
            </div>
          ) : (
            letters.map((letter) => (
              <LetterCard
                key={letter.id}
                letter={letter}
                onSave={(patch) => saveAutopay(letter, patch)}
                saving={savingLetterId === letter.id}
              />
            ))
          )}
        </div>

        <div style={{ marginTop: 40, padding: 16, background: COLORS.bgSection, borderRadius: 8, fontSize: 13, color: COLORS.textMuted, lineHeight: 1.6 }}>
          <strong>Authorization:</strong> By turning on Late Fee Protection for a ticket, you authorize Autopilot America to charge the credit card on file for the exact final amount of the City of Chicago fine for that ticket — but only if the contest is decided as a loss or reduction. You can turn it off anytime before the contest is decided. We will email you before and after every charge.
        </div>
      </main>
    </>
  );
}

function LetterCard({
  letter,
  onSave,
  saving,
}: {
  letter: ContestLetter;
  onSave: (patch: Partial<ContestLetter>) => void;
  saving: boolean;
}) {
  const [mode, setMode] = useState(letter.autopay_mode || 'off');
  const [cap, setCap] = useState<string>(
    letter.autopay_cap_amount != null ? String(letter.autopay_cap_amount) : '',
  );
  const optIn = !!letter.autopay_opt_in;
  const violationLabel = letter.ticket?.violation_type?.replace(/_/g, ' ') || 'Ticket';

  return (
    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, marginBottom: 14, background: COLORS.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>{violationLabel}</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>
            {letter.ticket?.ticket_number ? `Ticket #${letter.ticket.ticket_number}` : 'Ticket'} ·{' '}
            {letter.ticket?.plate || '—'} ·{' '}
            {letter.ticket?.violation_date || '—'}
          </div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
            Contest status: <strong style={{ color: COLORS.text }}>{letter.lifecycle_status || 'unknown'}</strong>
            {letter.final_amount != null && (
              <> · Final amount: <strong style={{ color: COLORS.text }}>${letter.final_amount.toFixed(2)}</strong></>
            )}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={optIn}
            disabled={saving}
            onChange={(e) => onSave({ autopay_opt_in: e.target.checked, autopay_mode: e.target.checked ? (mode === 'off' ? 'full_if_lost' : mode) : 'off' })}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: optIn ? COLORS.success : COLORS.textMuted }}>
            {optIn ? 'Protected' : 'Off'}
          </span>
        </label>
      </div>

      {optIn && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLORS.border}`, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: 'block', marginBottom: 4 }}>Mode</label>
            <select
              value={mode}
              disabled={saving}
              onChange={(e) => {
                setMode(e.target.value);
                onSave({ autopay_mode: e.target.value });
              }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}`, fontSize: 14 }}
            >
              {AUTOPAY_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {mode === 'up_to_cap' && (
            <div style={{ flex: '0 0 140px' }}>
              <label style={{ fontSize: 12, color: COLORS.textMuted, display: 'block', marginBottom: 4 }}>Cap ($)</label>
              <input
                type="number"
                value={cap}
                disabled={saving}
                onChange={(e) => setCap(e.target.value)}
                onBlur={() => onSave({ autopay_cap_amount: cap ? Number(cap) : null })}
                placeholder="100"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}`, fontSize: 14 }}
              />
            </div>
          )}
          <div style={{ fontSize: 12, color: COLORS.textMuted, paddingBottom: 8 }}>
            Card: {letter.autopay_payment_method_id ? '✅ on file' : '⚠️ none — will use your default'}
          </div>
        </div>
      )}

      {letter.paid_at && (
        <div style={{ marginTop: 12, padding: 10, background: '#dcfce7', borderRadius: 6, fontSize: 13, color: '#15803d' }}>
          ✅ Paid {new Date(letter.paid_at).toLocaleDateString()}
        </div>
      )}
      {letter.autopay_status === 'charged_pending_city' && (
        <div style={{ marginTop: 12, padding: 10, background: COLORS.warningBg, borderRadius: 6, fontSize: 13, color: '#78350f' }}>
          ⏳ Card charged — paying City of Chicago portal now. You'll get a confirmation email shortly.
        </div>
      )}
      {letter.autopay_status === 'payment_failed' && (
        <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', borderRadius: 6, fontSize: 13, color: COLORS.danger }}>
          ⚠️ Autopay failed — please pay this ticket directly with the city before the deadline.
        </div>
      )}
    </div>
  );
}
