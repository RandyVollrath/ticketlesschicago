/**
 * Camera-ticket evidence pipeline.
 *
 * Orchestrates: scrape → persist artifacts → AI-analyze → persist findings.
 * Called by the letter generator for red-light and speed-camera tickets.
 *
 * Idempotent: if a ticket already has evidence + findings cached, returns
 * cached. Pass force=true to re-scrape (rare — vendor URLs rotate, so this
 * is only useful for backfills).
 *
 * Graceful degradation: if the `camera_evidence` table doesn't exist yet
 * (migration not applied), the pipeline still scrapes + analyzes and
 * returns findings in-memory; it just can't cache them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scrapeCameraEvidence, type CameraEvidence } from './camera-evidence-scraper';
import { analyzeCameraEvidence, type CameraEvidenceFindings } from './camera-evidence-analysis';
import { formatViolationDate } from './contest-letter-date';
import { computeEnteredOnYellowArgument, type UserAppGpsEvidence } from './red-light-kinematics';

export interface CachedEvidence {
  ticketId: string;
  source: 'red_light' | 'speed_camera' | 'parking_photo';
  imagePaths: string[];
  videoPaths: string[];
  imageSourceUrls: string[];
  videoSourceUrls: string[];
  findings: CameraEvidenceFindings | null;
  notes: string[];
  scrapedAt: string;
  analyzedAt: string | null;
}

export interface PipelineResult {
  cached: boolean;
  evidence: CachedEvidence | null;
  /** True when scrape returned no media (e.g., parking ticket with no photo, or vendor portal said "not found") */
  noEvidenceAvailable: boolean;
  /** True if the table doesn't exist yet — caller should apply the migration */
  persistenceUnavailable: boolean;
  error?: string;
}

const STORAGE_BUCKET = 'ticket-photos';

export async function runCameraEvidencePipeline(
  supabase: SupabaseClient,
  ticket: {
    id: string;
    user_id: string;
    plate: string;
    ticket_number: string;
    violation_type: string | null;
    violation_code: string | null;
    violation_date: string | null;
    location: string | null;
  },
  options?: { force?: boolean },
): Promise<PipelineResult> {
  const force = options?.force === true;

  if (!isCameraTicket(ticket.violation_type, ticket.violation_code)) {
    return { cached: false, evidence: null, noEvidenceAvailable: false, persistenceUnavailable: false };
  }

  // 1. Check cache
  if (!force) {
    const cached = await readCached(supabase, ticket.id);
    if (cached.persistenceUnavailable) {
      // Table doesn't exist yet — fall through to live scrape, no persistence
    } else if (cached.evidence) {
      return { cached: true, evidence: cached.evidence, noEvidenceAvailable: false, persistenceUnavailable: false };
    }
  }

  // 2. Scrape
  const scrape = await scrapeCameraEvidence(
    ticket.violation_type,
    ticket.violation_code,
    ticket.ticket_number,
    ticket.plate,
  );
  if (!scrape) {
    return { cached: false, evidence: null, noEvidenceAvailable: false, persistenceUnavailable: false };
  }
  if (scrape.imageUrls.length === 0 && scrape.videoUrls.length === 0) {
    return {
      cached: false,
      evidence: null,
      noEvidenceAvailable: true,
      persistenceUnavailable: false,
    };
  }

  // 3. Upload bytes to Supabase Storage (best-effort — failure logs but doesn't block)
  const imagePaths: string[] = [];
  const videoPaths: string[] = [];
  for (let i = 0; i < scrape.images.length; i++) {
    const ext = mimeToExt(scrape.images[i].contentType, 'jpg');
    const p = `camera-evidence/${ticket.id}/image-${i + 1}.${ext}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(p, scrape.images[i].bytes, {
      contentType: scrape.images[i].contentType,
      upsert: true,
    });
    if (!error) imagePaths.push(p);
    else console.warn(`  Storage upload failed for ${p}:`, error.message);
  }
  for (let i = 0; i < scrape.videos.length; i++) {
    const ext = mimeToExt(scrape.videos[i].contentType, 'mp4');
    const p = `camera-evidence/${ticket.id}/video-${i + 1}.${ext}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(p, scrape.videos[i].bytes, {
      contentType: scrape.videos[i].contentType,
      upsert: true,
    });
    if (!error) videoPaths.push(p);
    else console.warn(`  Storage upload failed for ${p}:`, error.message);
  }

  // 4. AI analysis
  let findings: CameraEvidenceFindings | null = null;
  if (scrape.images.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      findings = await analyzeCameraEvidence(scrape.images, {
        expectedPlate: ticket.plate,
        violationType: scrape.source === 'red_light' ? 'red_light' : 'speed_camera',
        violationDate: formatViolationDate(ticket.violation_date),
        location: ticket.location || 'unknown',
      });
    } catch (err: any) {
      console.warn(`  Camera evidence analysis failed for ticket ${ticket.id}: ${err.message}`);
    }
  }

  // 5. Persist (best-effort; degrade gracefully if table missing)
  const persisted = await persistEvidence(supabase, ticket, scrape, imagePaths, videoPaths, findings);

  return {
    cached: false,
    evidence: {
      ticketId: ticket.id,
      source: scrape.source,
      imagePaths,
      videoPaths,
      imageSourceUrls: scrape.imageUrls,
      videoSourceUrls: scrape.videoUrls,
      findings,
      notes: scrape.notes,
      scrapedAt: scrape.scrapedAt,
      analyzedAt: findings?.analyzedAt || null,
    },
    noEvidenceAvailable: false,
    persistenceUnavailable: !persisted,
  };
}

function isCameraTicket(violationType: string | null, violationCode: string | null): boolean {
  const t = (violationType || '').toLowerCase();
  const c = (violationCode || '').toLowerCase();
  return t === 'red_light' || t === 'speed_camera' || c.startsWith('9-102-010') || c.startsWith('9-101-020');
}

async function readCached(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{ evidence: CachedEvidence | null; persistenceUnavailable: boolean }> {
  const { data, error } = await supabase
    .from('camera_evidence' as any)
    .select('*')
    .eq('ticket_id', ticketId)
    .maybeSingle();

  if (error) {
    // PGRST204 / 42P01 = relation does not exist
    if (/does not exist|relation .* does not exist/i.test(error.message) || error.code === '42P01') {
      return { evidence: null, persistenceUnavailable: true };
    }
    console.warn(`  camera_evidence cache read failed: ${error.message}`);
    return { evidence: null, persistenceUnavailable: false };
  }

  if (!data) return { evidence: null, persistenceUnavailable: false };

  return {
    evidence: {
      ticketId: (data as any).ticket_id,
      source: (data as any).source,
      imagePaths: (data as any).image_paths || [],
      videoPaths: (data as any).video_paths || [],
      imageSourceUrls: (data as any).image_source_urls || [],
      videoSourceUrls: (data as any).video_source_urls || [],
      findings: (data as any).findings || null,
      notes: (data as any).notes || [],
      scrapedAt: (data as any).scraped_at,
      analyzedAt: (data as any).analyzed_at,
    },
    persistenceUnavailable: false,
  };
}

async function persistEvidence(
  supabase: SupabaseClient,
  ticket: { id: string; user_id: string },
  scrape: CameraEvidence,
  imagePaths: string[],
  videoPaths: string[],
  findings: CameraEvidenceFindings | null,
): Promise<boolean> {
  const row = {
    ticket_id: ticket.id,
    user_id: ticket.user_id,
    source: scrape.source,
    image_paths: imagePaths,
    video_paths: videoPaths,
    image_source_urls: scrape.imageUrls,
    video_source_urls: scrape.videoUrls,
    findings: findings,
    notes: scrape.notes,
    scraped_at: scrape.scrapedAt,
    analyzed_at: findings?.analyzedAt || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('camera_evidence' as any)
    .upsert(row as any, { onConflict: 'ticket_id' });

  if (error) {
    if (/does not exist|relation .* does not exist/i.test(error.message) || error.code === '42P01') {
      console.warn(`  camera_evidence table not yet migrated — findings produced but not persisted`);
      return false;
    }
    console.warn(`  camera_evidence upsert failed: ${error.message}`);
    return false;
  }
  return true;
}

function mimeToExt(ct: string, fallback: string): string {
  const base = (ct || '').split(';')[0].trim().toLowerCase();
  if (base === 'image/jpeg') return 'jpg';
  if (base === 'image/jpg') return 'jpg';
  if (base === 'image/png') return 'png';
  if (base === 'image/gif') return 'gif';
  if (base === 'video/mp4') return 'mp4';
  if (base === 'video/webm') return 'webm';
  if (base === 'video/quicktime') return 'mov';
  return fallback;
}

/**
 * Turn AI findings into a paragraph the contest letter can cite.
 * Returns null when findings are too low-confidence to use affirmatively.
 *
 * When the photo metadata gives us amber duration + time-into-red, AND the
 * AI estimates the vehicle's distance past the stop bar, we generate a
 * full kinematic argument (the "math paragraph") that walks the hearing
 * officer through the two scenarios — entered on amber vs entered on red
 * — and shows that the entered-on-red scenario requires the driver to
 * have been doing roughly double the posted speed limit. That's a
 * decisive parsimony argument.
 */
export function renderFindingsParagraph(
  findings: CameraEvidenceFindings | null,
  expectedPlate: string,
  userAppGps?: UserAppGpsEvidence | null,
): string | null {
  if (!findings && !userAppGps) return null;
  if (!findings) {
    // No vendor findings, but we do have GPS — emit a GPS-only paragraph
    // so the user's app data still lands in the letter.
    return renderGpsOnlyParagraph(userAppGps!);
  }

  const lines: string[] = [];
  const f = findings;

  // ── WHAT WE WILL AND WILL NOT CITE ──
  //
  // Two defenses were previously emitted from this function and have been
  // removed because they require knowing where the painted stop bar is and
  // we have no honest source of truth for that:
  //
  //   • The entered-on-yellow kinematic argument from a photo alone.
  //   • The Photo 1 spec-mismatch defense (City's criteria require Photo 1
  //     to show front tires before the stop bar — but we can't verify the
  //     City failed that criterion without knowing where the stop bar is).
  //
  // Both relied on AI vision to estimate stop-bar position from a single
  // oblique camera photo, which is not a reliable measurement (it can
  // confuse crosswalk striping for the stop bar, especially in snow/slush
  // or at oblique angles). Until CDOT FOIA produces stop-bar coordinates
  // (see docs/FOIA_CDOT_STOP_BAR_GEOMETRY.md) — OR until we have an
  // independent measurement from the user's mobile-app GPS — these two
  // defenses must remain dormant.
  //
  // What remains, all of which is verifiable without a stop-bar estimate:
  //   • Plate mismatch (visible plate vs cited plate)
  //   • Plate illegibility
  //   • Short-amber observation (when amber ≤ 3.0s — Chicago/MUTCD policy
  //     question, not a position claim)
  //   • Right-turn-on-red exception (when the AI observed a stop+turn)
  //   • GPS-based kinematic argument (when user app data is present —
  //     this is real measurement, not photo estimation)

  const hasSignalArgument =
    (f.signal && f.signal.amberDurationSec !== null && f.signal.timeIntoRedPhaseSec !== null) ||
    !!userAppGps;
  if (hasSignalArgument) {
    lines.push(renderStatutoryFrameworkBlock());
  }

  // Plate mismatch / illegibility — these don't depend on stop bar location.
  if (f.vehicle.visiblePlateConfidence >= 0.6 && f.vehicle.visiblePlate) {
    const seen = f.vehicle.visiblePlate.replace(/\s/g, '').toUpperCase();
    const expected = expectedPlate.replace(/\s/g, '').toUpperCase();
    if (seen !== expected) {
      lines.push(
        `The license plate visible in the violation photos reads "${f.vehicle.visiblePlate}", which does not match the plate cited on the ticket ("${expectedPlate}"). This factual inconsistency calls into question whether the cited vehicle is the vehicle photographed.`,
      );
    }
  } else if (f.vehicle.visiblePlateConfidence > 0 && f.vehicle.visiblePlateConfidence < 0.4 && f.vehicle.visiblePlate === null) {
    lines.push(
      `The license plate of the moving vehicle in the violation photos is not legible at the resolution provided by the City. Without a legible plate, the City has not established that the photographed vehicle is the vehicle registered to the cited owner.`,
    );
  }

  // GPS-based kinematic argument — only fires when the user's mobile app
  // recorded the crossing. This is real second-source measurement, not a
  // photo guess. computeEnteredOnYellowArgument now refuses to compute
  // without userAppGps (see honesty guard at top of red-light-kinematics.ts).
  const sig = f.signal;
  if (
    userAppGps &&
    sig &&
    sig.amberDurationSec !== null &&
    sig.timeIntoRedPhaseSec !== null
  ) {
    const postedSpeed = sig.postedSpeedLimitMph ?? 30;
    const kin = computeEnteredOnYellowArgument({
      amberSec: sig.amberDurationSec,
      timeIntoRedSec: sig.timeIntoRedPhaseSec,
      postedSpeedMph: postedSpeed,
      estimatedFeetPastStopBar: null, // do not pass photo estimate; GPS branch only
      userAppGps,
    });
    if (kin.computed && kin.paragraph) {
      lines.push(kin.paragraph);
    }
  } else if (userAppGps) {
    // No photo signal metadata but GPS still present — emit GPS-only paragraph.
    lines.push(renderGpsOnlyParagraph(userAppGps));
  }

  // Short-amber observation — a factual reading of the metadata strip,
  // not a position claim. Honest at any approach speed: 3.0s is the floor
  // of MUTCD guidance for the slowest urban approaches and is below the
  // ITE-recommended interval for any approach faster than ~30 mph.
  if (
    sig &&
    sig.amberDurationSec !== null &&
    sig.amberDurationSec <= 3.0
  ) {
    lines.push(
      `The City's own evidence (Photo 1 metadata strip) records an amber phase duration of ${sig.amberDurationSec.toFixed(1)} seconds at this approach. Federal MUTCD guidance and Institute of Transportation Engineers (ITE) practice recommend longer amber intervals for any approach speed above the lowest urban range; a 3.0-second amber is at or below the floor of that range and provides minimal margin for a driver to perceive, decide, and stop safely. The brevity of the amber is itself a factor in whether a citation should issue against a particular driver, and I respectfully ask the hearing officer to weigh it.`,
    );
  }

  // Right-turn-on-red — depends on the AI observing a stop+turn sequence,
  // not on stop bar position. Honest to cite when present.
  const rtorContestable = f.contestable.filter((c) => c.supports === 'right_turn_on_red' && c.confidence >= 0.6);
  if (rtorContestable.length > 0) {
    lines.push(`Based on review of the City's own violation imagery: ${rtorContestable[0].observation}`);
  }

  if (lines.length === 0) return null;
  return lines.join('\n\n');
}

/**
 * Foundation block cited at the top of every red-light camera contest
 * letter. States the controlling legal premise (entry on red, not failure
 * to clear) using verbatim quotes from primary sources:
 *   - 625 ILCS 5/11-306(c)(1) — driver duty under steady red
 *   - 625 ILCS 5/11-208.6(a) — definition of what the camera records
 *   - Chicago CDOT/DOF "Automated Red-Light Camera Enforcement Violation
 *     Processing Methods & Criteria" PDF (eff. 03/15/2018)
 *   - Chicago CDOT public FAQ
 *
 * All four sources independently use the entry standard. Reciting them
 * up front locks the hearing officer into the correct legal framing
 * BEFORE the factual argument is presented.
 */
function renderStatutoryFrameworkBlock(): string {
  return (
`CONTROLLING LEGAL FRAMEWORK — what the law actually requires:

The duty under Illinois law at a steady red signal is to STOP BEFORE ENTERING the intersection. It is not a duty to clear the intersection before red. Four independent sources establish this:

(1) Illinois Vehicle Code, 625 ILCS 5/11-306(c)(1) — the controlling statute on signal compliance:
    "Vehicular traffic facing a steady circular red signal alone shall stop at a clearly marked stop line, but if there is no such stop line, before entering the crosswalk on the near side of the intersection, or if there is no such crosswalk, then before entering the intersection, and shall remain standing until an indication to proceed is shown."

(2) Illinois Vehicle Code, 625 ILCS 5/11-208.6(a) — the statute authorizing automated red-light cameras, which expressly defines what a violation is for camera-enforcement purposes:
    "'Automated traffic law enforcement system' means a device with one or more motor vehicle sensors working in conjunction with a red light signal to produce recorded images of motor vehicles entering an intersection against a red signal indication in violation of Section 11-306 of this Code or a similar provision of a local ordinance."

(3) City of Chicago Department of Transportation + Department of Finance, "Automated Red-Light Camera Enforcement Violation Processing Methods & Criteria" (effective 03/15/2018, available on chicago.gov) — the City's own published trigger rule:
    "The system is programmed to compile photographic and video images if upon entering the intersection, the traffic control signal has been red for at least 0.3 seconds before the vehicle enters the intersection."

(4) City of Chicago Department of Transportation, "Red Light Camera Enforcement" public FAQ (chicago.gov) — addressing exactly the scenario where a driver crossed during yellow:
    "Red Light Cameras do not take pictures of vehicles legally turning right on red after a complete stop ... or caught in the intersection after the light turns red (for example, vehicles that entered the intersection on yellow, or were already in the intersection and waiting to make a left turn)."

The legal standard is therefore unambiguous and consistent across the Illinois Vehicle Code, the Chicago administrative criteria, and the City's own public explanation: the violation is ENTRY into the intersection on red. A vehicle that entered on green or yellow and was still within the intersection when the signal changed to red has not violated 625 ILCS 5/11-306 — and accordingly there is nothing for the automated enforcement system to lawfully record as a violation under 625 ILCS 5/11-208.6. Indeed, per source (4) above, the City itself has publicly committed not to issue tickets in that scenario.`
  );
}

/**
 * When we have GPS data from the user's app but no vendor photo findings,
 * still produce a stand-alone paragraph that gets the GPS evidence into
 * the letter. Mirrors the wording of the kinematic helpers so it reads
 * the same way to a hearing officer.
 */
function renderGpsOnlyParagraph(gps: UserAppGpsEvidence): string {
  const lines: string[] = [
    'INDEPENDENT GPS EVIDENCE — Autopilot America mobile app:',
    '',
    "The cited vehicle was concurrently equipped with the Autopilot America mobile application, which independently recorded the vehicle's GPS-derived motion as it approached and crossed the cited intersection. The following measurements are on-device sensor readings, timestamped contemporaneously, and stored in the vehicle owner's account record:",
  ];
  if (gps.approachSpeedMph !== null && Number.isFinite(gps.approachSpeedMph)) {
    lines.push(`  • Peak approach speed: ${gps.approachSpeedMph.toFixed(1)} mph`);
  }
  if (gps.minSpeedMph !== null && Number.isFinite(gps.minSpeedMph)) {
    lines.push(`  • Minimum speed at/near intersection: ${gps.minSpeedMph.toFixed(1)} mph`);
  }
  if (gps.speedDeltaMph !== null && Number.isFinite(gps.speedDeltaMph)) {
    lines.push(`  • Speed delta across the approach window: ${gps.speedDeltaMph.toFixed(1)} mph (deceleration evidence)`);
  }
  if (gps.deviceTimestamp) {
    lines.push(`  • Device timestamp at crossing: ${gps.deviceTimestamp}`);
  }
  lines.push(
    '',
    "This evidence is independent of the City's evidence package and was not generated for the purpose of this contest. It is a contemporaneous, second-source recording — the City has no comparable second-source data."
  );
  if (gps.fullStopDetected) {
    const dur = gps.fullStopDurationSec ?? null;
    const durPhrase = dur !== null && Number.isFinite(dur)
      ? `a complete stop lasting approximately ${dur.toFixed(1)} second${dur === 1 ? '' : 's'}`
      : 'a complete stop';
    lines.push(
      '',
      `FULL-STOP CONFIRMED BY GPS — RIGHT-TURN-ON-RED DEFENSE:`,
      '',
      `The GPS trace records ${durPhrase} prior to the vehicle clearing the cited intersection. Under 625 ILCS 5/11-306(c)(1), a right turn on red is lawful after the driver has come to a complete stop. The City's evidence does not address the question of whether a stop occurred; the GPS record affirmatively does, and it does so in the driver's favor.`,
    );
  }
  return lines.join('\n');
}
