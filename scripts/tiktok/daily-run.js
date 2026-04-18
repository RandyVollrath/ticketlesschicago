#!/usr/bin/env node
/**
 * Daily TikTok Run — generates batch + emails results
 *
 * Designed to run via systemd timer. Generates 2-3 TikTok videos,
 * then emails Randy with the summary + video files attached.
 *
 * Usage:
 *   node scripts/tiktok/daily-run.js              # full run
 *   node scripts/tiktok/daily-run.js --no-email   # skip email
 *   node scripts/tiktok/daily-run.js --count 2    # generate 2 instead of 3
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

// Load env vars
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = "randyvollrath@gmail.com";
const FROM_EMAIL = "Randy from Autopilot America <randy@autopilotamerica.com>";

async function sendEmail(subject, html, attachments) {
  if (!RESEND_API_KEY) {
    console.log("⚠ No RESEND_API_KEY, skipping email");
    return;
  }

  const body = {
    from: FROM_EMAIL,
    to: [TO_EMAIL],
    subject,
    html,
    attachments,
  };

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      console.log("📧 Email sent successfully");
    } else {
      const err = await resp.text();
      console.error(`📧 Email failed: ${resp.status} ${err}`);
    }
  } catch (e) {
    console.error(`📧 Email error: ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const noEmail = args.includes("--no-email");
  const countIdx = args.indexOf("--count");
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 3 : 3;

  const date = new Date().toISOString().split("T")[0];
  const batchDir = path.join(os.homedir(), "Desktop", "tiktok-batch", date);

  console.log(`\n🎬 TikTok Daily Run — ${date}`);
  console.log(`   Count: ${count}`);
  console.log(`   Output: ${batchDir}/\n`);

  // Generate the batch using smart content mix
  const { generateDailyMix, generateIdeas } = require("./ideas");
  const { generateVideo } = require("./generate");

  const dayOfWeek = new Date().getDay();
  const dayType = dayOfWeek >= 1 && dayOfWeek <= 5 ? "weekday" : "weekend";

  // Use content mix strategy (morning/midday/evening slots)
  const mix = generateDailyMix(dayType);
  const ideas = mix.map((m) => m.idea);
  const slots = mix.map((m) => m.slot);

  console.log(`   Day type: ${dayType}`);
  console.log(`   Slots: ${slots.join(", ")}`);
  console.log(`   Pillars: ${ideas.map((i) => i.pillar).join(", ")}\n`);

  if (!fs.existsSync(batchDir)) fs.mkdirSync(batchDir, { recursive: true });

  const results = [];
  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];
    const slot = slots[i];
    const output = path.join(batchDir, `${slot}-${idea.id}.mp4`);

    console.log(`\n━━━ Video ${i + 1}/${ideas.length} ━━━`);
    const result = await generateVideo(idea, { output });
    if (result) results.push({ ...result, slot });
  }

  console.log(`\n✅ Generated ${results.length}/${ideas.length} videos`);

  if (noEmail || results.length === 0) {
    console.log("Skipping email.");
    return;
  }

  // Build email
  const videoRows = results
    .map((r, i) => {
      const filename = path.basename(r.outputPath);
      const size = (fs.statSync(r.outputPath).size / 1024 / 1024).toFixed(1);
      const slot = r.slot || "—";
      const timeMap = { morning: "7:00 AM CT", midday: "12:00 PM CT", evening: "7:00 PM CT" };
      const postTime = timeMap[slot] || "—";
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${filename}</strong></td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${r.meta.pillar}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${size} MB</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#2563EB;font-weight:600">${postTime}</td>
        </tr>
        <tr>
          <td colspan="4" style="padding:8px 12px 16px;border-bottom:1px solid #ddd;color:#666;font-size:13px">
            <strong>Caption:</strong> ${r.meta.caption}
          </td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0F172A">TikTok Daily Batch — ${date}</h2>
      <p style="color:#475569">${results.length} videos generated and ready to post.</p>
      <p style="color:#475569">Videos are on your Desktop at:<br>
        <code style="background:#f1f5f9;padding:4px 8px;border-radius:4px">${batchDir}/</code>
      </p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">File</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Pillar</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Size</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Post At</th>
          </tr>
        </thead>
        <tbody>${videoRows}</tbody>
      </table>

      <p style="color:#64748b;font-size:13px">
        Videos are attached below. Captions are also saved as .txt files next to each video.
        <br>To edit: open the video's config at <code>public/audio/tiktok/[id]/config.json</code>
        and re-render with <code>npm run tiktok -- --config [path]</code>
      </p>
    </div>`;

  // Attach videos (only if total < 25MB to stay within Resend limits)
  const attachments = [];
  let totalSize = 0;
  for (const r of results) {
    const size = fs.statSync(r.outputPath).size;
    totalSize += size;
    if (totalSize > 25 * 1024 * 1024) {
      console.log("⚠ Total attachment size >25MB, skipping remaining attachments");
      break;
    }
    const content = fs.readFileSync(r.outputPath).toString("base64");
    attachments.push({
      filename: path.basename(r.outputPath),
      content,
    });
  }

  await sendEmail(
    `TikTok Batch: ${results.length} videos ready — ${date}`,
    html,
    attachments
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
