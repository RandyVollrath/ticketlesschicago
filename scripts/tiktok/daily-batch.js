#!/usr/bin/env node
/**
 * Daily TikTok Batch Generator
 *
 * Generates 2-3 TikTok videos from FOIA data, saves to ~/Desktop/tiktok-batch/
 * Each video gets: .mp4 file + -caption.txt with ready-to-paste caption & hashtags
 *
 * Usage:
 *   node scripts/tiktok/daily-batch.js              # generates 3 videos
 *   node scripts/tiktok/daily-batch.js --count 2     # generates 2 videos
 *   node scripts/tiktok/daily-batch.js --no-voice    # skip voiceover
 *   node scripts/tiktok/daily-batch.js --dry-run     # preview ideas without rendering
 */

const path = require("path");
const os = require("os");
const fs = require("fs");

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 3 : 3;
  const noVoice = args.includes("--no-voice");
  const dryRun = args.includes("--dry-run");

  // Generate unique ideas
  const { generateIdeas } = require("./ideas");
  const ideas = generateIdeas(count);

  const date = new Date().toISOString().split("T")[0];
  const batchDir = path.join(os.homedir(), "Desktop", "tiktok-batch", date);

  console.log(`\n🎬 TikTok Daily Batch — ${date}`);
  console.log(`   Videos: ${ideas.length}`);
  console.log(`   Output: ${batchDir}/\n`);

  if (dryRun) {
    ideas.forEach((idea, i) => {
      console.log(`\n--- Video ${i + 1}: ${idea.id} ---`);
      console.log(`Pillar: ${idea.pillar}`);
      console.log(`Scenes: ${idea.scenes.length}`);
      console.log(`Caption: ${idea.caption}`);
      console.log(
        `VO scripts:\n${idea.scenes.map((s, j) => `  ${j + 1}. ${s.voScript || "(none)"}`).join("\n")}`
      );
    });
    return;
  }

  if (!fs.existsSync(batchDir)) fs.mkdirSync(batchDir, { recursive: true });

  const { generateVideo } = require("./generate");
  const results = [];

  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];
    const output = path.join(batchDir, `${i + 1}-${idea.id}.mp4`);

    console.log(`\n━━━ Video ${i + 1}/${ideas.length} ━━━`);
    const result = await generateVideo(idea, { noVoice, output });
    if (result) results.push(result);
  }

  // Summary
  console.log(`\n\n✅ Batch complete: ${results.length}/${ideas.length} videos`);
  console.log(`📂 ${batchDir}/`);
  results.forEach((r, i) => {
    console.log(`   ${i + 1}. ${path.basename(r.outputPath)}`);
  });

  // Write batch summary
  const summaryPath = path.join(batchDir, "BATCH_SUMMARY.md");
  const summary = [
    `# TikTok Batch — ${date}`,
    ``,
    `Generated ${results.length} videos.`,
    ``,
    ...results.map((r, i) => {
      return [
        `## Video ${i + 1}: ${r.meta.id}`,
        `- Pillar: ${r.meta.pillar}`,
        `- File: ${path.basename(r.outputPath)}`,
        `- Caption: ${r.meta.caption}`,
        ``,
      ].join("\n");
    }),
  ].join("\n");
  fs.writeFileSync(summaryPath, summary);
  console.log(`\n📋 Summary: ${summaryPath}`);
}

main().catch(console.error);
