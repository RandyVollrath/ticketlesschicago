#!/usr/bin/env node
/**
 * TikTok Video Generator
 *
 * Takes a video idea (from ideas.js or custom JSON), generates ElevenLabs
 * voiceover for each scene, then renders with Remotion.
 *
 * Usage:
 *   # Generate from a random idea:
 *   node scripts/tiktok/generate.js
 *
 *   # Generate from a specific config file:
 *   node scripts/tiktok/generate.js --config path/to/idea.json
 *
 *   # Generate from a specific pillar:
 *   node scripts/tiktok/generate.js --pillar camera-trap
 *
 *   # Skip voiceover (use existing or none):
 *   node scripts/tiktok/generate.js --no-voice
 *
 *   # Custom output path:
 *   node scripts/tiktok/generate.js --output ~/Desktop/my-video.mp4
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Config ──
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio/tiktok");
const DEFAULT_MUSIC = "audio/bg-music.mp3";

// Load API key from .env.local
function getElevenLabsKey() {
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/ELEVENLABS_API_KEY=(.+)/);
  return match ? match[1].trim() : null;
}

const ELEVEN_KEY = getElevenLabsKey();
const VOICE_ID = "IKne3meq5aSn9XLyUdCD"; // Charlie — deep, confident, hyped

// ── ElevenLabs TTS ──
async function generateVoiceover(text, outputPath) {
  if (!ELEVEN_KEY) {
    console.log("  ⚠ No ElevenLabs API key, skipping voiceover");
    return false;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const body = JSON.stringify({
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.35,
      similarity_boost: 0.85,
      style: 0.7,
      use_speaker_boost: true,
    },
  });

  try {
    execSync(
      `curl -s "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" ` +
        `-H "xi-api-key: ${ELEVEN_KEY}" ` +
        `-H "Content-Type: application/json" ` +
        `-d '${body.replace(/'/g, "'\\''")}' ` +
        `--output "${outputPath}"`,
      { timeout: 30000 }
    );

    // Verify it's not an error response
    const stat = fs.statSync(outputPath);
    if (stat.size < 1000) {
      const content = fs.readFileSync(outputPath, "utf8");
      if (content.includes("error") || content.includes("rate_limit")) {
        console.log(`  ⚠ ElevenLabs error for scene, retrying in 5s...`);
        execSync("sleep 5");
        execSync(
          `curl -s "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" ` +
            `-H "xi-api-key: ${ELEVEN_KEY}" ` +
            `-H "Content-Type: application/json" ` +
            `-d '${body.replace(/'/g, "'\\''")}' ` +
            `--output "${outputPath}"`,
          { timeout: 30000 }
        );
      }
    }

    return fs.statSync(outputPath).size > 1000;
  } catch (e) {
    console.log(`  ⚠ Voice generation failed: ${e.message}`);
    return false;
  }
}

// ── Get audio duration ──
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf8", timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

// ── Main pipeline ──
async function generateVideo(idea, options = {}) {
  const {
    noVoice = false,
    output = null,
    musicFile = DEFAULT_MUSIC,
  } = options;

  const videoId = idea.id || `tiktok-${Date.now()}`;
  const audioSubDir = path.join(AUDIO_DIR, videoId);
  const outputPath =
    output ||
    path.join(os.homedir(), "Desktop", "tiktok-batch", `${videoId}.mp4`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n🎬 Generating: ${videoId}`);
  console.log(`   Scenes: ${idea.scenes.length}`);

  // Step 1: Generate voiceover for each scene
  const scenesWithAudio = [];
  for (let i = 0; i < idea.scenes.length; i++) {
    const scene = { ...idea.scenes[i] };
    const voPath = path.join(audioSubDir, `vo-${i}.mp3`);
    const voRelative = `audio/tiktok/${videoId}/vo-${i}.mp3`;

    if (!noVoice && scene.voScript) {
      console.log(`   🎙 Scene ${i + 1}: generating voiceover...`);
      const ok = await generateVoiceover(scene.voScript, voPath);
      if (ok) {
        scene.voFile = voRelative;

        // Adjust scene duration to match VO length + padding
        const voDuration = getAudioDuration(voPath);
        if (voDuration > 0) {
          const voFrames = Math.ceil(voDuration * 30) + 45; // 1.5s padding
          scene.durationFrames = Math.max(scene.durationFrames, voFrames);
          console.log(
            `     VO: ${voDuration.toFixed(1)}s → ${scene.durationFrames} frames`
          );
        }

        // Rate limit protection — wait between API calls
        if (i < idea.scenes.length - 1) {
          execSync("sleep 2");
        }
      }
    }

    // Remove voScript from the config (not needed by Remotion)
    delete scene.voScript;
    scenesWithAudio.push(scene);
  }

  // Step 2: Build Remotion input props
  const inputProps = {
    scenes: scenesWithAudio,
    musicFile,
    musicVolume: 0.1,
  };

  const totalFrames = scenesWithAudio.reduce(
    (sum, s) => sum + s.durationFrames,
    0
  );
  const totalSeconds = (totalFrames / 30).toFixed(1);
  console.log(`   📐 Total: ${totalFrames} frames (${totalSeconds}s)`);

  // Step 3: Write temp config
  const configPath = path.join(audioSubDir, "config.json");
  if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(inputProps, null, 2));

  // Also save the caption/hashtags
  const metaPath = path.join(audioSubDir, "meta.json");
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: videoId,
        caption: idea.caption,
        hashtags: idea.hashtags,
        pillar: idea.pillar,
        totalSeconds,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  // Step 4: Render with Remotion
  console.log(`   🎥 Rendering video...`);
  const propsJson = JSON.stringify(inputProps).replace(/'/g, "'\\''");

  try {
    execSync(
      `npx remotion render remotion/index.ts TikTok "${outputPath}" ` +
        `--props='${propsJson}' --log=error`,
      {
        cwd: PROJECT_ROOT,
        timeout: 600000, // 10 min max
        stdio: "inherit",
      }
    );

    const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
    console.log(`   ✅ Done: ${outputPath} (${fileSize} MB)`);

    // Save caption to a .txt file next to the video
    const captionPath = outputPath.replace(/\.mp4$/, "-caption.txt");
    fs.writeFileSync(
      captionPath,
      `${idea.caption}\n\n${idea.hashtags || ""}`
    );
    console.log(`   📝 Caption: ${captionPath}`);

    return { outputPath, captionPath, meta: idea };
  } catch (e) {
    console.error(`   ❌ Render failed: ${e.message}`);
    return null;
  }
}

// ── CLI ──
async function main() {
  const args = process.argv.slice(2);

  const noVoice = args.includes("--no-voice");
  const outputIdx = args.indexOf("--output");
  const output = outputIdx >= 0 ? args[outputIdx + 1] : null;
  const configIdx = args.indexOf("--config");
  const pillarIdx = args.indexOf("--pillar");

  let idea;

  if (configIdx >= 0) {
    // Load from config file
    idea = JSON.parse(fs.readFileSync(args[configIdx + 1], "utf8"));
  } else {
    // Generate a random idea
    const { generateIdeas } = require("./ideas");
    const pillar = pillarIdx >= 0 ? args[pillarIdx + 1] : null;
    const ideas = generateIdeas(1, pillar);
    idea = ideas[0];

    if (!idea) {
      console.error("Failed to generate content idea");
      process.exit(1);
    }
  }

  await generateVideo(idea, { noVoice, output });
}

main().catch(console.error);

module.exports = { generateVideo };
