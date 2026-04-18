# TikTok Video Pipeline

Automated TikTok video generation powered by FOIA data + ElevenLabs voiceover + Remotion rendering.

## Quick Start

```bash
# Preview 3 random video ideas (no rendering):
npm run tiktok:dry-run

# Generate a single random video:
npm run tiktok

# Generate a daily batch (3 videos):
npm run tiktok:batch

# Generate 2 videos:
npm run tiktok:batch -- --count 2

# Generate from a specific content pillar:
npm run tiktok -- --pillar camera-trap
npm run tiktok -- --pillar contest-secret
npm run tiktok -- --pillar data-shock
npm run tiktok -- --pillar vehicle-make
```

## Output

Videos and captions are saved to `~/Desktop/tiktok-batch/YYYY-MM-DD/`:
- `1-camera-trap-445-127th.mp4` — the video
- `1-camera-trap-445-127th-caption.txt` — ready-to-paste caption + hashtags
- `BATCH_SUMMARY.md` — overview of all videos in the batch

## Content Pillars

### 1. Data Shock (`data-shock`)
Big-number hooks from FOIA aggregate data. "$2.3B in total fines", "$894M unpaid", etc.

### 2. Camera Trap (`camera-trap`)
Specific speed/red light camera locations with ticket counts. "This one camera wrote 478,264 tickets."

### 3. Contest Secret (`contest-secret`)
Win rate reveals by violation type. "89% of expired plate tickets get dismissed."

### 4. Vehicle Make (`vehicle-make`)
Targeted by car brand. "Toyota drivers have been charged $142M in tickets."

## Architecture

```
scripts/tiktok/
├── ideas.js          # Queries FOIA DB, generates content configs
├── generate.js       # Main pipeline: VO generation → Remotion render
└── daily-batch.js    # Batch wrapper, generates N videos

remotion/
├── Root.tsx          # Remotion entry point
├── TikTokVideo.tsx   # Dynamic composition driven by JSON config
├── TicketlessAd.tsx  # Original hand-crafted ad
└── scenes/           # Reusable scene components
    ├── shared.tsx        # Colors, fonts, particles, glitch text
    ├── BigNumberSlam.tsx # "$420M" style big number with screen shake
    ├── StatStack.tsx     # 2-4 stats stacked vertically
    ├── TwoStat.tsx       # Two contrasting stats (94% vs 67%)
    ├── BrandReveal.tsx   # Autopilot America logo with rings
    ├── PriceCompare.tsx  # $250 crossed out → $99
    └── CTA.tsx           # Call-to-action with animated button
```

## Scene Types

Each scene in a video config has a `type` that maps to a component:

| Type | Component | Best For |
|------|-----------|----------|
| `big-number` | BigNumberSlam | Hook slides: "$420M", "94%", etc |
| `stat-stack` | StatStack | 2-4 rapid-fire stats |
| `two-stat` | TwoStat | Contrast: "94% pay" vs "67% win" |
| `brand-reveal` | BrandReveal | Autopilot America logo reveal |
| `price-compare` | PriceCompare | $250 → $99 with strikethrough |
| `cta` | CTA | Final call-to-action |

## Custom Videos

Create a JSON config file and render directly:

```json
{
  "id": "my-custom-video",
  "pillar": "custom",
  "caption": "My custom caption #fyp",
  "hashtags": "#chicago #fyp",
  "scenes": [
    {
      "type": "big-number",
      "props": {
        "preText": "Did you know",
        "number": "$200",
        "postText": "no city sticker fine",
        "color": "#ff1a1a",
        "glitch": true
      },
      "durationFrames": 300,
      "voScript": "Did you know the fine for no city sticker is two hundred dollars?"
    },
    {
      "type": "cta",
      "props": {},
      "durationFrames": 240,
      "voScript": "Autopilot America. Link in bio."
    }
  ]
}
```

```bash
npm run tiktok -- --config path/to/my-video.json
```

## Dependencies

- **Remotion** (`remotion`, `@remotion/cli`) — video rendering
- **better-sqlite3** — FOIA database queries
- **ElevenLabs API** — voiceover (key in `.env.local` as `ELEVENLABS_API_KEY`)
- **ffprobe** — audio duration measurement (comes with ffmpeg)

## Data Source

All stats come from `~/Documents/FOIA/foia.db` (8.2GB SQLite):
- 35.7M ticket records (2019-2024)
- FOIA F118906 from Chicago Dept of Finance
- Includes: violations, fines, locations, vehicle makes, payments, boot data
