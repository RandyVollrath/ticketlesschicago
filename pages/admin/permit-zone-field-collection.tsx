/**
 * /admin/permit-zone-field-collection
 *
 * Mobile-first field-ops page for collecting permit-zone hours data
 * block-by-block. Use on a phone while out walking/biking. The page:
 *   1) shows the plan (where to go next, priority blocks, instructions)
 *   2) lets you submit one observation per sign (photo + zone + days + hours)
 *   3) tracks progress (pending vs done) against the priority list seeded
 *      from the FOIA citation counts
 */
import { useEffect, useMemo, useState } from 'react';

type Target = {
  id: number;
  rank: number;
  street_dir: string;
  street_name: string;
  street_type: string | null;
  block_low: number;
  citation_count: number;
  cluster_label: string | null;
  status: string;
};

type Segment = {
  row_id: string;
  zone: string;
  odd_even: string;
  street_direction: string;
  street_name: string;
  street_type: string;
  address_range_low: string;
  address_range_high: string;
};

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

const CONDITIONS = ['clear', 'faded', 'damaged', 'obscured', 'missing'] as const;

export default function PermitZoneFieldCollection() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [planOpen, setPlanOpen] = useState(false);

  // form
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [streetDir, setStreetDir] = useState('N');
  const [streetName, setStreetName] = useState('');
  const [blockLow, setBlockLow] = useState('');
  const [matchedSegments, setMatchedSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);

  const [zoneOnSign, setZoneOnSign] = useState('');
  const [days, setDays] = useState<Record<string, boolean>>({});
  const [allDays, setAllDays] = useState(false);
  const [hoursStart, setHoursStart] = useState('');
  const [hoursEnd, setHoursEnd] = useState('');
  const [allTimes, setAllTimes] = useState(false);
  const [condition, setCondition] = useState<string>('clear');
  const [rawText, setRawText] = useState('');
  const [notes, setNotes] = useState('');
  const [gps, setGps] = useState<{ lat: number; lon: number; acc: number } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);

  // Load targets
  async function loadTargets() {
    const r = await fetch('/api/admin/permit-collection-targets?status=pending&limit=40');
    const j = await r.json();
    if (j.targets) setTargets(j.targets);
    if (j.summary) setSummary(j.summary);
  }
  useEffect(() => { loadTargets(); }, []);

  // Resolve segment whenever street_dir + street_name + block_low change
  useEffect(() => {
    if (!streetDir || !streetName || !blockLow) { setMatchedSegments([]); setSelectedSegment(null); return; }
    const ctl = new AbortController();
    fetch(`/api/admin/lookup-permit-segment?street_dir=${streetDir}&street_name=${encodeURIComponent(streetName)}&block_low=${blockLow}`, { signal: ctl.signal })
      .then(r => r.json())
      .then(j => {
        const segs: Segment[] = j.segments || [];
        setMatchedSegments(segs);
        if (segs.length === 1) setSelectedSegment(segs[0]);
        else setSelectedSegment(null);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [streetDir, streetName, blockLow]);

  // Geolocation
  function refreshGPS() {
    if (!navigator.geolocation) { setError('Geolocation unsupported on this browser'); return; }
    navigator.geolocation.getCurrentPosition(
      p => setGps({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => setError('GPS: ' + e.message),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }
  useEffect(() => { refreshGPS(); }, []);

  function onPhotoSelect(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPhotoData(dataUrl);
      await runOcr(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function runOcr(dataUrl: string) {
    setOcrBusy(true); setOcrInfo(null); setError(null);
    try {
      const r = await fetch('/api/admin/ocr-permit-sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_base64: dataUrl }),
      });
      const j = await r.json();
      if (!r.ok || !j.sign) { setOcrInfo('OCR returned no sign — fill manually'); return; }
      const s = j.sign;
      if (typeof s.zone_number === 'number') setZoneOnSign(String(s.zone_number));
      if (s.all_days) { setAllDays(true); setDays({}); }
      else if (Array.isArray(s.days_array)) {
        const next: Record<string, boolean> = {};
        for (const d of s.days_array) next[d] = true;
        setDays(next); setAllDays(false);
      }
      if (s.all_times) { setAllTimes(true); setHoursStart(''); setHoursEnd(''); }
      else {
        if (typeof s.hours_start_24 === 'string') setHoursStart(s.hours_start_24);
        if (typeof s.hours_end_24 === 'string') setHoursEnd(s.hours_end_24);
        setAllTimes(false);
      }
      if (typeof s.sign_condition === 'string') setCondition(s.sign_condition);
      if (typeof s.raw_text === 'string') setRawText(s.raw_text);
      setOcrInfo(`OCR: ${s.kind}${s.zone_number != null ? ' zone ' + s.zone_number : ''} — review and Save`);
    } catch (e: any) {
      setOcrInfo('OCR error: ' + (e.message || String(e)));
    } finally {
      setOcrBusy(false);
    }
  }

  function quickFillFromTarget(t: Target) {
    setStreetDir(t.street_dir);
    setStreetName(t.street_name);
    setBlockLow(String(t.block_low));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function markTargetStatus(id: number, status: string) {
    await fetch('/api/admin/update-permit-target', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    await loadTargets();
  }

  function resetForm() {
    setPhotoData(null);
    setZoneOnSign('');
    setDays({});
    setAllDays(false);
    setHoursStart('');
    setHoursEnd('');
    setAllTimes(false);
    setRawText('');
    setNotes('');
    setCondition('clear');
  }

  async function submit() {
    setSubmitting(true); setError(null); setLastSavedId(null);
    try {
      const payload: any = {
        collected_by: 'field',
        collected_at: new Date().toISOString(),
        photo_base64: photoData,
        lat: gps?.lat ?? null,
        lon: gps?.lon ?? null,
        gps_accuracy_m: gps?.acc ?? null,
        zone_on_sign: zoneOnSign ? Number(zoneOnSign) : null,
        days_mon: allDays || !!days.mon,
        days_tue: allDays || !!days.tue,
        days_wed: allDays || !!days.wed,
        days_thu: allDays || !!days.thu,
        days_fri: allDays || !!days.fri,
        days_sat: allDays || !!days.sat,
        days_sun: allDays || !!days.sun,
        all_days: allDays,
        hours_start: allTimes ? null : (hoursStart || null),
        hours_end: allTimes ? null : (hoursEnd || null),
        all_times: allTimes,
        sign_condition: condition,
        raw_sign_text: rawText || null,
        notes: notes || null,
      };
      if (selectedSegment) {
        payload.segment_row_id = selectedSegment.row_id;
        payload.matched_zone = Number(selectedSegment.zone);
        payload.street_direction = selectedSegment.street_direction;
        payload.street_name = selectedSegment.street_name;
        payload.street_type = selectedSegment.street_type;
        payload.block_low = Number(selectedSegment.address_range_low);
        payload.block_high = Number(selectedSegment.address_range_high);
        payload.odd_even = selectedSegment.odd_even;
      } else if (streetDir && streetName && blockLow) {
        payload.street_direction = streetDir;
        payload.street_name = streetName.toUpperCase();
        payload.block_low = Number(blockLow);
      }

      const r = await fetch('/api/admin/save-permit-observation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'save failed'); return; }
      setLastSavedId(j.id);
      resetForm();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // Group targets by cluster for the route list
  const byCluster = useMemo(() => {
    const m: Record<string, Target[]> = {};
    for (const t of targets) (m[t.cluster_label || 'Other'] ||= []).push(t);
    return m;
  }, [targets]);

  const totalTargets = (summary.pending || 0) + (summary.in_progress || 0) + (summary.done || 0) + (summary.skip || 0);
  const doneCount = summary.done || 0;

  return (
    <main style={{
      maxWidth: 760, margin: '0 auto', padding: '12px 16px 80px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#111', lineHeight: 1.4,
    }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Permit Zone Field Collection</h1>
      <div style={{ fontSize: 13, color: '#555' }}>
        <strong>{doneCount}</strong> / <strong>{totalTargets}</strong> priority blocks done
        {totalTargets > 0 && <> · {Math.round((doneCount / totalTargets) * 100)}%</>}
      </div>

      {/* QUICK CAPTURE FORM — always at top */}
      <section style={card}>
        <h2 style={h2}>📸 Capture one sign</h2>

        <div style={row}>
          <label style={lbl}>Photo of sign</label>
          <input type="file" accept="image/*" capture="environment"
                 onChange={e => e.target.files?.[0] && onPhotoSelect(e.target.files[0])} />
        </div>
        {photoData && (
          <div style={{ marginTop: 4 }}>
            <img src={photoData} alt="captured sign"
                 style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }} />
            <div style={{ fontSize: 12, color: ocrBusy ? '#06c' : '#555', marginTop: 4 }}>
              {ocrBusy ? '🔎 Reading sign with AI…' : (ocrInfo || 'Photo loaded')}
              {!ocrBusy && (
                <button onClick={() => runOcr(photoData)} style={{ ...btnGhost, marginLeft: 8 }}>
                  re-read
                </button>
              )}
            </div>
          </div>
        )}

        <div style={row}>
          <label style={lbl}>GPS</label>
          {gps ? (
            <span style={mono}>{gps.lat.toFixed(5)}, {gps.lon.toFixed(5)} (±{Math.round(gps.acc)}m)</span>
          ) : (
            <span style={{ color: '#888' }}>not available</span>
          )}
          <button onClick={refreshGPS} style={btnGhost}>refresh</button>
        </div>

        <div style={{ ...row, alignItems: 'flex-start' }}>
          <label style={lbl}>Address</label>
          <div style={{ display: 'flex', gap: 6, flex: 1 }}>
            <select value={streetDir} onChange={e => setStreetDir(e.target.value)} style={input}>
              <option>N</option><option>S</option><option>E</option><option>W</option>
            </select>
            <input value={streetName} onChange={e => setStreetName(e.target.value)}
                   placeholder="LAKEWOOD" style={{ ...input, flex: 1, textTransform: 'uppercase' }} />
            <input value={blockLow} onChange={e => setBlockLow(e.target.value)}
                   placeholder="2300" inputMode="numeric"
                   style={{ ...input, width: 88 }} />
          </div>
        </div>

        {matchedSegments.length > 0 && (
          <div style={{ ...row, alignItems: 'flex-start', fontSize: 13 }}>
            <label style={lbl}>Match</label>
            <div style={{ flex: 1 }}>
              {matchedSegments.map(s => (
                <label key={s.row_id} style={{ display: 'block', marginBottom: 4 }}>
                  <input type="radio" checked={selectedSegment?.row_id === s.row_id}
                         onChange={() => setSelectedSegment(s)} />
                  &nbsp;Zone <strong>{s.zone}</strong> · {s.street_direction} {s.street_name} {s.street_type} {s.address_range_low}-{s.address_range_high} ({s.odd_even})
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={row}>
          <label style={lbl}>Zone # on sign</label>
          <input value={zoneOnSign} onChange={e => setZoneOnSign(e.target.value)}
                 placeholder="143" inputMode="numeric" style={{ ...input, width: 100 }} />
          {zoneOnSign && selectedSegment && Number(zoneOnSign) !== Number(selectedSegment.zone) && (
            <span style={{ color: '#d22', fontSize: 12 }}>⚠ doesn't match segment zone {selectedSegment.zone}</span>
          )}
        </div>

        <div style={{ ...row, flexWrap: 'wrap' }}>
          <label style={lbl}>Days</label>
          <label style={chk}>
            <input type="checkbox" checked={allDays} onChange={e => setAllDays(e.target.checked)} />
            <strong>All days</strong>
          </label>
          {DAYS.map(d => (
            <label key={d.key} style={{ ...chk, opacity: allDays ? 0.4 : 1 }}>
              <input type="checkbox" disabled={allDays}
                     checked={!!days[d.key]}
                     onChange={e => setDays({ ...days, [d.key]: e.target.checked })} />
              {d.label}
            </label>
          ))}
        </div>

        <div style={row}>
          <label style={lbl}>Hours</label>
          <label style={chk}>
            <input type="checkbox" checked={allTimes} onChange={e => setAllTimes(e.target.checked)} />
            <strong>All times</strong>
          </label>
          {!allTimes && (
            <>
              <input type="time" value={hoursStart} onChange={e => setHoursStart(e.target.value)} style={{ ...input, width: 110 }} />
              <span>to</span>
              <input type="time" value={hoursEnd} onChange={e => setHoursEnd(e.target.value)} style={{ ...input, width: 110 }} />
            </>
          )}
        </div>

        <div style={row}>
          <label style={lbl}>Condition</label>
          <select value={condition} onChange={e => setCondition(e.target.value)} style={input}>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div style={row}>
          <label style={lbl}>Raw text</label>
          <textarea value={rawText} onChange={e => setRawText(e.target.value)}
                    placeholder='e.g. "RESIDENTIAL PERMIT PARKING ONLY / ZONE 143 / 5 PM TO 9 AM, MON THRU SAT, ANYTIME SUN"'
                    rows={2} style={{ ...input, flex: 1 }} />
        </div>

        <div style={row}>
          <label style={lbl}>Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
                 placeholder="anything unusual" style={{ ...input, flex: 1 }} />
        </div>

        {error && <div style={{ color: '#c00', fontSize: 13, marginTop: 8 }}>Error: {error}</div>}
        {lastSavedId && <div style={{ color: '#080', fontSize: 13, marginTop: 8 }}>✓ Saved {lastSavedId.slice(0, 8)}</div>}

        <button onClick={submit} disabled={submitting} style={btnPrimary}>
          {submitting ? 'Saving…' : 'Save observation'}
        </button>
      </section>

      {/* PRIORITY TARGETS */}
      <section style={card}>
        <h2 style={h2}>🗺️ Where to go next</h2>
        <p style={{ fontSize: 13, color: '#555', margin: '0 0 12px' }}>
          Highest-citation blocks first. Tap a block to pre-fill the form above, then walk there.
        </p>
        {Object.keys(byCluster).length === 0 && (
          <div style={{ color: '#888', fontSize: 13 }}>
            No targets loaded. Run <code>npx tsx scripts/seed-permit-zone-targets.ts</code> after applying the migration.
          </div>
        )}
        {Object.entries(byCluster).sort((a, b) => b[1].length - a[1].length).map(([cluster, list]) => (
          <details key={cluster} open={cluster !== 'Other'} style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '6px 0' }}>
              {cluster} <span style={{ color: '#888', fontWeight: 400 }}>({list.length})</span>
            </summary>
            <div>
              {list.map(t => (
                <div key={t.id} style={targetRow}>
                  <div style={{ flex: 1 }}>
                    <strong>#{t.rank}</strong> &nbsp;
                    {t.street_dir} {t.street_name} {t.street_type ?? ''} {t.block_low}–{t.block_low + 99}
                    <div style={{ fontSize: 11, color: '#777' }}>{t.citation_count.toLocaleString()} tickets</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={btnGhost} onClick={() => quickFillFromTarget(t)}>fill</button>
                    <button style={btnGhost} onClick={() => markTargetStatus(t.id, 'in_progress')}>start</button>
                    <button style={btnGhost} onClick={() => markTargetStatus(t.id, 'done')}>done</button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </section>

      {/* PLAN */}
      <section style={card}>
        <h2 style={h2} onClick={() => setPlanOpen(o => !o)}>
          📋 The plan {planOpen ? '▾' : '▸'}
        </h2>
        {planOpen && <PlanContent />}
      </section>
    </main>
  );
}

function PlanContent() {
  return (
    <div style={{ fontSize: 14 }}>
      <h3 style={h3}>What we're collecting</h3>
      <p>Per sign: <strong>zone number</strong>, <strong>days</strong>, <strong>hours</strong>, plus <strong>street + block</strong> (auto-resolved from u9xt-hiju). Photo + GPS for proof.</p>

      <h3 style={h3}>Capture technique</h3>
      <ol style={{ paddingLeft: 20, margin: '4px 0' }}>
        <li>Stop right in front of each permit-zone sign.</li>
        <li>Take ONE clear close-up photo with this page open.</li>
        <li>Fill the form (Address → Match → Zone → Days → Hours).</li>
        <li>Hit Save. Move to the next sign.</li>
      </ol>
      <p style={{ fontSize: 13, color: '#555' }}>Don't sample. Every sign on every block face in scope.</p>

      <h3 style={h3}>Coverage targets (citation-weighted)</h3>
      <table style={tbl}>
        <thead><tr><th>Phase</th><th>Blocks</th><th>% citations</th><th>Time</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Top 200</td><td>~18%</td><td>~1 day</td></tr>
          <tr><td>2</td><td>Top 500</td><td>~30%</td><td>~3 days</td></tr>
          <tr><td>3</td><td>Top 1,000</td><td>~45%</td><td>~5 days</td></tr>
          <tr><td>4</td><td>Top 4,000</td><td>~85%</td><td>~3 weeks</td></tr>
          <tr><td>5</td><td>All 9,876 segs</td><td>100%</td><td>~6 weeks</td></tr>
        </tbody>
      </table>

      <h3 style={h3}>1-hour plan</h3>
      <p>Pick the densest top-blocks cluster near you (Lakeview, Gold Coast, or Near South). Walk it block by block. ~20-30 signs per hour is the realistic pace with this form.</p>

      <h3 style={h3}>Equipment</h3>
      <ul style={{ paddingLeft: 20 }}>
        <li>Phone (this page).</li>
        <li>Bike or walking shoes.</li>
        <li>That's it.</li>
      </ul>

      <h3 style={h3}>What the form does for you</h3>
      <ul style={{ paddingLeft: 20 }}>
        <li>Auto-uploads the photo to Supabase Storage.</li>
        <li>Looks up the u9xt-hiju segment from your address entry — you pick the side (E/O) from the matches.</li>
        <li>Flags any disagreement between zone-on-sign and zone-from-segment so we catch OCR/data drift.</li>
        <li>Saves to <code>permit_zone_field_observations</code>.</li>
      </ul>

      <h3 style={h3}>Quality bar</h3>
      <p>Each block-face needs at least one observation with a clearly-readable sign. If you can't read the digits, mark condition <code>faded</code> or <code>damaged</code> and submit anyway — that's defense evidence for contests.</p>
    </div>
  );
}

// --- styles ---
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e2e6', borderRadius: 8, padding: 14, margin: '14px 0' };
const h2: React.CSSProperties = { fontSize: 16, margin: '0 0 10px', cursor: 'pointer' };
const h3: React.CSSProperties = { fontSize: 14, margin: '14px 0 4px' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' };
const lbl: React.CSSProperties = { width: 110, fontSize: 13, color: '#444' };
const input: React.CSSProperties = { padding: '6px 8px', border: '1px solid #cbd', borderRadius: 4, fontSize: 14 };
const chk: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '2px 6px' };
const btnPrimary: React.CSSProperties = { background: '#0a5', color: 'white', border: 'none', padding: '12px 18px', borderRadius: 6, fontSize: 15, fontWeight: 600, marginTop: 8, width: '100%' };
const btnGhost: React.CSSProperties = { background: 'white', border: '1px solid #bbb', padding: '4px 8px', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 };
const targetRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderTop: '1px solid #eee', fontSize: 13 };
const tbl: React.CSSProperties = { borderCollapse: 'collapse', fontSize: 13, margin: '8px 0' };
