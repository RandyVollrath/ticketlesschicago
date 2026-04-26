#!/usr/bin/env node
/**
 * TikTok Content Idea Generator
 *
 * Queries the FOIA SQLite database and generates unique video configs.
 * Each idea includes scene configs, voiceover scripts, and metadata.
 *
 * Usage:
 *   node scripts/tiktok/ideas.js                  # prints 3 random ideas as JSON
 *   node scripts/tiktok/ideas.js --count 5        # prints 5
 *   node scripts/tiktok/ideas.js --pillar camera   # only camera-related ideas
 */

const Database = require("better-sqlite3");
const path = require("path");
const os = require("os");

const DB_PATH = path.join(os.homedir(), "Documents/FOIA/foia.db");

// ── Pillar generators ──

function pillarDataShock(db) {
  // Random year comparison or big number
  const templates = [
    () => {
      const row = db
        .prepare(
          `SELECT COUNT(*) as cnt, CAST(SUM(fine_level1) AS INT) as rev
           FROM tickets WHERE fine_level1 > 0`
        )
        .get();
      const millions = Math.round(row.rev / 1000000);
      return {
        id: "data-shock-total-fines",
        pillar: "data-shock",
        caption:
          "Chicago has charged drivers over $2 BILLION in parking tickets since 2019. All from real FOIA data. #chicago #parkingtickets #fyp",
        hashtags: "#chicago #parkingtickets #foia #didyouknow #fyp",
        scenes: [
          {
            type: "big-number",
            props: {
              preText: "Since 2019, Chicago charged drivers",
              number: `$${millions}M+`,
              postText: "in parking and camera fines",
              subText: "Source: FOIA F118906, 35.7M records",
              color: "#ff1a1a",
              glitch: true,
            },
            durationFrames: 300,
            voScript: `Since two thousand nineteen, the city of Chicago has charged drivers over ${millions} million dollars in parking and camera fines. That's from real city data. Thirty five point seven million ticket records.`,
          },
          {
            type: "stat-stack",
            props: {
              stats: [
                {
                  number: "35.7M",
                  label: "total tickets issued",
                  color: "#ff1a1a",
                },
                {
                  number: `$${millions}M`,
                  label: "in fines charged",
                  color: "#ff6b2b",
                },
                {
                  number: "94%",
                  label: "never contested",
                  sublabel: "the city is counting on it",
                  color: "#ffd700",
                },
              ],
            },
            durationFrames: 360,
            voScript: `Thirty five point seven million tickets. Over ${millions} million dollars in fines. And ninety four percent of people never even try to contest. The city is literally counting on you not fighting back.`,
          },
          {
            type: "brand-reveal",
            props: {
              tagline1: "We fight your tickets automatically.",
              tagline2: "57% of mail-in contested tickets get dismissed.",
            },
            durationFrames: 270,
            voScript:
              "That's why we built Autopilot America. We contest your tickets automatically. And fifty seven percent of mail-in contested parking tickets get dismissed. Link in bio.",
          },
          {
            type: "cta",
            props: {},
            durationFrames: 210,
            voScript:
              "Seventy nine dollars a year. Pays for itself with one avoided ticket. autopilot america dot com.",
          },
        ],
      };
    },

    () => {
      const row = db
        .prepare(
          `SELECT CAST(SUM(current_amount_due) AS INT) as unpaid
           FROM tickets WHERE current_amount_due > 0`
        )
        .get();
      const millions = Math.round(row.unpaid / 1000000);
      return {
        id: "data-shock-unpaid",
        pillar: "data-shock",
        caption: `Chicago drivers currently owe $${millions}M+ in unpaid parking tickets. The boot trucks are coming. #chicago #parkingticket #fyp`,
        hashtags: "#chicago #parkingtickets #boots #citysticker #fyp",
        scenes: [
          {
            type: "big-number",
            props: {
              preText: "Chicago drivers currently owe",
              number: `$${millions}M`,
              postText: "in unpaid tickets",
              subText: "And 44,000 cars got booted last year",
              color: "#ff1a1a",
              glitch: true,
            },
            durationFrames: 300,
            voScript: `Right now, Chicago drivers owe over ${millions} million dollars in unpaid parking tickets. And last year, forty four thousand cars got booted. If you have unpaid tickets, the boot truck is coming for you.`,
          },
          {
            type: "two-stat",
            props: {
              stat1Label: "Cars booted in 2025",
              stat1Number: "44,014",
              stat1Sub: "that's 120 boots per day",
              stat1Color: "#ff6b2b",
              stat2Label: "Average boot release fee",
              stat2Number: "$500+",
              stat2Sub: "plus towing if you don't pay fast",
              stat2Color: "#ff1a1a",
              kicker:
                "One unpaid ticket can snowball into hundreds in fees.",
            },
            durationFrames: 420,
            voScript:
              "Forty four thousand cars booted. That's a hundred and twenty boots every single day. And the average boot release fee is over five hundred dollars, plus towing if you don't pay fast enough. One unpaid ticket can snowball into hundreds in extra fees.",
          },
          {
            type: "cta",
            props: {
              headline: "We scan your plate twice a week",
              headlineSub: "so you never miss a ticket",
            },
            durationFrames: 240,
            voScript:
              "Autopilot America scans your plate twice a week, so you know about tickets before the late fees hit. Seventy nine dollars a year. Link in bio.",
          },
        ],
      };
    },
  ];

  return templates[Math.floor(Math.random() * templates.length)]();
}

function pillarCameraTrap(db) {
  // Pick a random top camera location
  const cameras = db
    .prepare(
      `SELECT street_num, street_dir, street_name, COUNT(*) as cnt,
              CAST(SUM(fine_level1) AS INT) as revenue
       FROM tickets
       WHERE violation_desc LIKE 'SPEED%'
       GROUP BY street_num, street_dir, street_name
       ORDER BY cnt DESC
       LIMIT 20`
    )
    .all();

  const cam = cameras[Math.floor(Math.random() * Math.min(cameras.length, 10))];
  if (!cam) return pillarDataShock(db); // fallback

  const location = `${cam.street_num} ${cam.street_dir} ${cam.street_name}`;
  const millions = (cam.revenue / 1000000).toFixed(1);
  const perDay = Math.round(cam.cnt / 365 / 6); // ~6 years of data

  return {
    id: `camera-trap-${cam.street_num}-${cam.street_name}`.toLowerCase().replace(/\s+/g, "-"),
    pillar: "camera-trap",
    caption: `This one speed camera at ${location} has written ${cam.cnt.toLocaleString()} tickets. Chicago FOIA data. #chicago #speedcamera #fyp`,
    hashtags: "#chicago #speedcamera #redlightcamera #chicagodriving #fyp",
    scenes: [
      {
        type: "big-number",
        props: {
          preText: "One speed camera in Chicago",
          number: cam.cnt.toLocaleString(),
          postText: "tickets written",
          subText: location,
          color: "#ff1a1a",
          glitch: true,
        },
        durationFrames: 300,
        voScript: `One single speed camera at ${location} has written ${cam.cnt.toLocaleString()} tickets. That's ${perDay} tickets every single day, from one camera.`,
      },
      {
        type: "stat-stack",
        props: {
          stats: [
            { number: `$${millions}M`, label: "revenue from this camera", color: "#ff1a1a" },
            { number: `${perDay}/day`, label: "tickets per day", color: "#ff6b2b" },
            { number: "$35", label: "per ticket", sublabel: "doubles to $100 if you miss the notice", color: "#ffd700" },
          ],
        },
        durationFrames: 360,
        voScript: `That's ${millions} million dollars in revenue from one camera. ${perDay} tickets every single day. Each one is thirty five dollars, but if you miss the notice it doubles to a hundred.`,
      },
      {
        type: "cta",
        props: {
          headline: "We alert you before every camera",
          headlineSub: "speed cameras and red light cameras",
        },
        durationFrames: 240,
        voScript: "Autopilot America alerts you before every speed camera and red light camera in Chicago. Real time, on your phone. Seventy nine dollars a year. Link in bio.",
      },
    ],
  };
}

function pillarContestSecret(db) {
  // Pick a random violation with high win rate
  const violations = [
    { code: "EXPIRED PLATE%", name: "expired plates", winRate: "89%", fine: "$60" },
    { code: "NO CITY STICKER%", name: "no city sticker", winRate: "85%", fine: "$200" },
    { code: "EXP. METER%", name: "expired meter", winRate: "57%", fine: "$50-70" },
    { code: "RESIDENTIAL PERMIT%", name: "residential permit parking", winRate: "52%", fine: "$75" },
    { code: "DISABLED%", name: "disabled parking zone", winRate: "72%", fine: "$250" },
  ];

  const v = violations[Math.floor(Math.random() * violations.length)];

  // Get actual count from DB
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM tickets WHERE violation_desc LIKE ?`
    )
    .get(v.code);
  const count = row ? row.cnt : 0;

  return {
    id: `contest-secret-${v.name.replace(/\s+/g, "-")}`,
    pillar: "contest-secret",
    caption: `${v.winRate} of ${v.name} tickets get dismissed when contested. We FOIA'd the city and got the real numbers. #chicago #parkingticket #fyp`,
    hashtags: "#chicago #parkingticket #contest #dismissed #fyp",
    scenes: [
      {
        type: "big-number",
        props: {
          preText: `${v.name} tickets`,
          number: v.winRate,
          postText: "get dismissed when contested",
          subText: `${v.fine} fine · ${count.toLocaleString()} tickets issued`,
          color: "#00e676",
          glitch: false,
        },
        durationFrames: 300,
        voScript: `${v.winRate} of ${v.name} tickets in Chicago get dismissed when you actually contest them. That's a ${v.fine} fine, and the city has issued ${count.toLocaleString()} of them.`,
      },
      {
        type: "two-stat",
        props: {
          stat1Label: "People who just pay it",
          stat1Number: "94%",
          stat1Sub: "never even try to fight",
          stat1Color: "#ff6b2b",
          stat2Label: "People who contest and win",
          stat2Number: v.winRate,
          stat2Sub: "get their ticket dismissed",
          stat2Color: "#00e676",
          kicker: "The city is counting on you giving up.",
        },
        durationFrames: 420,
        voScript: `Ninety four percent of people just pay the ticket without trying. But ${v.winRate} of the people who actually contest ${v.name} tickets win. The city is literally counting on you giving up.`,
      },
      {
        type: "brand-reveal",
        props: {
          tagline1: "We contest your tickets automatically.",
          tagline2: "Letters drafted, printed, and mailed.",
        },
        durationFrames: 240,
        voScript: "Autopilot America contests your tickets automatically. We draft the letter, print it, and mail it to the city. You don't have to do anything.",
      },
      {
        type: "cta",
        props: {},
        durationFrames: 210,
        voScript: "Seventy nine dollars a year. First dismissal guarantee. If we don't save you money, you pay nothing. Link in bio.",
      },
    ],
  };
}

function pillarVehicleMake(db) {
  const makes = db
    .prepare(
      `SELECT vehicle_make, COUNT(*) as cnt, CAST(SUM(fine_level1) AS INT) as rev
       FROM tickets
       WHERE vehicle_make NOT IN ('OTHR', '') AND fine_level1 > 0
       GROUP BY vehicle_make
       ORDER BY cnt DESC
       LIMIT 10`
    )
    .all();

  const make = makes[Math.floor(Math.random() * Math.min(makes.length, 6))];
  if (!make) return pillarDataShock(db);

  const nameMap = {
    CHEV: "Chevy", TOYT: "Toyota", FORD: "Ford", HOND: "Honda",
    NISS: "Nissan", JEEP: "Jeep", HYUN: "Hyundai", DODG: "Dodge",
    VOLK: "Volkswagen", BMW: "BMW", MERZ: "Mercedes", LEXS: "Lexus",
    SUBA: "Subaru", KIA: "Kia", MAZD: "Mazda", ACUR: "Acura",
    BUIC: "Buick", GMC: "GMC", CADI: "Cadillac", CHRY: "Chrysler",
    LINC: "Lincoln", INFI: "Infiniti", MITS: "Mitsubishi",
  };

  const fullName = nameMap[make.vehicle_make] || make.vehicle_make;
  const millions = (make.rev / 1000000).toFixed(0);

  return {
    id: `vehicle-${fullName.toLowerCase()}`,
    pillar: "vehicle-make",
    caption: `If you drive a ${fullName} in Chicago, the city has taken $${millions}M from ${fullName} drivers in tickets. #chicago #${fullName.toLowerCase()} #parkingticket #fyp`,
    hashtags: `#chicago #${fullName.toLowerCase()} #parkingticket #fyp`,
    scenes: [
      {
        type: "big-number",
        props: {
          preText: `If you drive a ${fullName} in Chicago`,
          number: `$${millions}M`,
          postText: `in fines charged to ${fullName} drivers`,
          subText: `${make.cnt.toLocaleString()} tickets total`,
          color: "#ff1a1a",
          glitch: true,
        },
        durationFrames: 300,
        voScript: `If you drive a ${fullName} in Chicago, listen up. The city has charged ${fullName} drivers over ${millions} million dollars in parking tickets. That's ${make.cnt.toLocaleString()} tickets.`,
      },
      {
        type: "stat-stack",
        props: {
          stats: [
            { number: make.cnt.toLocaleString(), label: `${fullName} tickets issued`, color: "#ff6b2b" },
            { number: `$${millions}M`, label: "in fines", color: "#ff1a1a" },
            { number: "57%", label: "get dismissed via mail-in contest", color: "#00e676" },
          ],
        },
        durationFrames: 330,
        voScript: `${make.cnt.toLocaleString()} tickets. ${millions} million dollars. But here's the thing: fifty seven percent of mail-in contested parking tickets get dismissed. You just need to actually fight back.`,
      },
      {
        type: "cta",
        props: {
          headline: `${fullName} drivers, protect yourself`,
          headlineSub: "before the next ticket hits",
        },
        durationFrames: 240,
        voScript: `${fullName} drivers, protect yourself before the next ticket hits. Autopilot America. Seventy nine dollars a year. Link in bio.`,
      },
    ],
  };
}

// ═══════════════════════════════════════════════
// SLIDESHOW PILLARS
// ═══════════════════════════════════════════════

function slideshowContest(db) {
  const violations = [
    { code: "EXPIRED PLATE%", name: "Expired Plates", rate: "89%", fine: "$60" },
    { code: "NO CITY STICKER%", name: "No City Sticker", rate: "85%", fine: "$200" },
    { code: "DISABLED%", name: "Disabled Parking Zone", rate: "72%", fine: "$250" },
    { code: "EXP. METER%CBD", name: "Expired Meter (CBD)", rate: "68%", fine: "$70" },
    { code: "EXP. METER%NON%", name: "Expired Meter", rate: "57%", fine: "$50" },
    { code: "RESIDENTIAL PERMIT%", name: "Residential Permit", rate: "52%", fine: "$75" },
    { code: "STREET CLEANING", name: "Street Cleaning", rate: "30%", fine: "$60" },
  ];

  return {
    id: `slideshow-contest-rates-${Date.now() % 10000}`,
    pillar: "slideshow-contest",
    caption:
      "We FOIA'd the City of Chicago and got the REAL win rates for every ticket type. Most people don't know this. #chicago #parkingticket #contest #dismissed #fyp",
    hashtags: "#chicago #parkingticket #contest #dismissed #foia #fyp",
    scenes: [
      {
        type: "slideshow",
        props: {
          slides: [
            {
              text: "We FOIA'd the City of Chicago\nand got the REAL dismissal rates\nfor every parking ticket type.",
              subtext: "35.7 million ticket records. Here's what we found.",
              fontSize: 48,
            },
            ...violations.map((v) => ({
              text: `${v.name}\n${v.rate} get dismissed`,
              subtext: `${v.fine} fine · contest to win`,
              highlight: v.rate,
              fontSize: 52,
              accentColor: parseInt(v.rate) >= 60 ? "#00e676" : parseInt(v.rate) >= 40 ? "#ffd700" : "#ff6b2b",
            })),
            {
              text: "94% of people never contest.\nThe city is counting on that.",
              highlight: "94%",
              fontSize: 52,
              accentColor: "#ff1a1a",
            },
            {
              text: "We contest your tickets automatically.\n$79/year. Link in bio.",
              highlight: "$79/year",
              fontSize: 50,
              accentColor: "#00e676",
            },
          ],
          accentColor: "#00e676",
          sourceLabel: "Source: Chicago FOIA data, 35.7M records",
        },
        durationFrames: 900, // 30s — will be adjusted by VO
        voScript:
          "We filed a Freedom of Information Act request with the City of Chicago and got the actual dismissal rates for every parking ticket type. Thirty five point seven million records. " +
          violations.map((v) => `${v.name}: ${v.rate} get dismissed. That's a ${v.fine} fine.`).join(" ") +
          " Ninety four percent of people never even try to contest. The city is counting on that. We contest your tickets automatically. Seventy nine dollars a year. Link in bio.",
      },
    ],
  };
}

function slideshowFeatures(db) {
  return {
    id: `slideshow-features-${Date.now() % 10000}`,
    pillar: "slideshow-features",
    caption:
      "Here's everything Autopilot America does for Chicago drivers. Camera alerts, parking detection, automatic ticket contesting, and more. $79/year. #chicago #parkingticket #app #fyp",
    hashtags: "#chicago #parkingticket #app #carlife #fyp",
    scenes: [
      {
        type: "slideshow",
        props: {
          slides: [
            {
              text: "What does Autopilot America\nactually do?",
              subtext: "Here's everything you get for $79/year.",
              fontSize: 52,
            },
            {
              text: "Speed & Red Light Camera Alerts",
              subtext:
                "Real-time warnings before you reach every camera in Chicago. On your phone, while you drive.",
              highlight: "Camera Alerts",
              fontSize: 50,
              accentColor: "#ff1a1a",
            },
            {
              text: "Smart Parking Detection",
              subtext:
                "Knows when you park. Checks street cleaning and snow ban schedules for your exact location.",
              highlight: "Parking Detection",
              fontSize: 50,
              accentColor: "#00e5ff",
            },
            {
              text: "Ticket Radar — 2x/week plate scans",
              subtext:
                "We check the Chicago finance portal for new tickets on your plate, twice a week. You know before late fees hit.",
              highlight: "2x/week",
              fontSize: 48,
              accentColor: "#00e676",
            },
            {
              text: "Automatic Contest Letters",
              subtext:
                "When you get a ticket, we draft a contest letter, print it, and mail it to the city. You don't lift a finger.",
              highlight: "Automatic",
              fontSize: 50,
              accentColor: "#ffd700",
            },
            {
              text: "Registration & Sticker Reminders",
              subtext:
                "Never get an expired plate or city sticker ticket again. We remind you before deadlines.",
              highlight: "Reminders",
              fontSize: 50,
              accentColor: "#ff6b2b",
            },
            {
              text: "First Dismissal Guarantee",
              subtext:
                "If we don't help you avoid all tickets or get at least 1 dismissed, full refund. No questions.",
              highlight: "Guarantee",
              fontSize: 50,
              accentColor: "#00e676",
            },
            {
              text: "$79/year.\nPays for itself in 1.2 tickets.\nLink in bio.",
              highlight: "$79/year",
              fontSize: 52,
              accentColor: "#00e676",
            },
          ],
          accentColor: "#00e5ff",
          sourceLabel: "autopilotamerica.com",
        },
        durationFrames: 960,
        voScript:
          "What does Autopilot America actually do? Here's everything you get for seventy nine dollars a year. " +
          "Speed and red light camera alerts. Real time warnings before you reach every camera in Chicago. " +
          "Smart parking detection. It knows when you park and checks street cleaning schedules for your exact location. " +
          "Ticket radar. We scan the Chicago finance portal for new tickets on your plate, twice a week. You know before late fees hit. " +
          "Automatic contest letters. When you get a ticket, we draft the letter, print it, and mail it to the city. You don't lift a finger. " +
          "Registration and sticker reminders so you never get an expired plate ticket again. " +
          "First dismissal guarantee. If we don't save you money, full refund. " +
          "Seventy nine dollars a year. Pays for itself in one point two tickets. Link in bio.",
      },
    ],
  };
}

function slideshowCameraMap(db) {
  const cameras = db
    .prepare(
      `SELECT street_num, street_dir, street_name, COUNT(*) as cnt,
              CAST(SUM(fine_level1) AS INT) as revenue
       FROM tickets
       WHERE violation_desc LIKE 'SPEED%'
       GROUP BY street_num, street_dir, street_name
       ORDER BY cnt DESC
       LIMIT 8`
    )
    .all();

  const slides = [
    {
      text: "The 8 worst speed cameras\nin Chicago",
      subtext: "Ranked by total tickets issued. Real FOIA data.",
      fontSize: 52,
    },
    ...cameras.map((cam, i) => ({
      text: `#${i + 1}: ${cam.street_num} ${cam.street_dir} ${cam.street_name}`,
      subtext: `${cam.cnt.toLocaleString()} tickets · $${(cam.revenue / 1000000).toFixed(1)}M in fines`,
      highlight: cam.cnt.toLocaleString(),
      fontSize: 44,
      accentColor: "#ff1a1a",
    })),
    {
      text: "We alert you before every camera.\n$79/year. Link in bio.",
      highlight: "every camera",
      fontSize: 50,
      accentColor: "#00e676",
    },
  ];

  const totalTickets = cameras.reduce((s, c) => s + c.cnt, 0);
  const totalRev = cameras.reduce((s, c) => s + c.revenue, 0);

  return {
    id: "slideshow-top-cameras",
    pillar: "slideshow-cameras",
    caption: `The 8 worst speed cameras in Chicago. ${totalTickets.toLocaleString()} tickets and $${(totalRev / 1000000).toFixed(0)}M in fines from just these 8 cameras. #chicago #speedcamera #fyp`,
    hashtags: "#chicago #speedcamera #redlightcamera #chicagodriving #fyp",
    scenes: [
      {
        type: "slideshow",
        props: {
          slides,
          accentColor: "#ff1a1a",
          sourceLabel: "Source: Chicago FOIA data",
          particleColors: ["#ff1a1a", "#ff6b2b"],
        },
        durationFrames: 1050,
        voScript:
          "The eight worst speed cameras in Chicago, ranked by total tickets issued. " +
          cameras
            .map(
              (cam, i) =>
                `Number ${i + 1}: ${cam.street_num} ${cam.street_dir} ${cam.street_name}. ${cam.cnt.toLocaleString()} tickets. ${(cam.revenue / 1000000).toFixed(1)} million dollars in fines.`
            )
            .join(" ") +
          ` That's ${totalTickets.toLocaleString()} tickets from just eight cameras. We alert you before every camera in Chicago. Seventy nine dollars a year. Link in bio.`,
      },
    ],
  };
}

// ── Main ──
const PILLARS = {
  "data-shock": pillarDataShock,
  "camera-trap": pillarCameraTrap,
  "contest-secret": pillarContestSecret,
  "vehicle-make": pillarVehicleMake,
  "slideshow-contest": slideshowContest,
  "slideshow-features": slideshowFeatures,
  "slideshow-cameras": slideshowCameraMap,
};

const PILLAR_NAMES = Object.keys(PILLARS);

function generateIdeas(count = 3, pillarFilter = null) {
  const db = new Database(DB_PATH, { readonly: true });
  const ideas = [];
  const usedIds = new Set();

  for (let i = 0; i < count * 3 && ideas.length < count; i++) {
    const pillarName =
      pillarFilter || PILLAR_NAMES[Math.floor(Math.random() * PILLAR_NAMES.length)];
    const generator = PILLARS[pillarName];
    if (!generator) continue;

    try {
      const idea = generator(db);
      if (!usedIds.has(idea.id)) {
        usedIds.add(idea.id);
        ideas.push(idea);
      }
    } catch (e) {
      // skip failed ideas
    }
  }

  db.close();
  return ideas;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 3 : 3;
  const pillarIdx = args.indexOf("--pillar");
  const pillar = pillarIdx >= 0 ? args[pillarIdx + 1] : null;

  const ideas = generateIdeas(count, pillar);
  console.log(JSON.stringify(ideas, null, 2));
}

/**
 * Generate a balanced daily content mix.
 * Returns ideas tagged with posting time slots.
 *
 * @param {"weekday"|"weekend"} dayType
 * @returns {Array<{idea, slot: "morning"|"midday"|"evening"}>}
 */
function generateDailyMix(dayType = "weekday") {
  const db = new Database(DB_PATH, { readonly: true });
  const mix = [];
  const usedIds = new Set();

  function pick(pillarName) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const idea = PILLARS[pillarName](db);
        if (!usedIds.has(idea.id)) {
          usedIds.add(idea.id);
          return idea;
        }
      } catch {}
    }
    return null;
  }

  // Morning (7am): Data hook — shareable, big numbers
  const morningPillars = ["data-shock", "camera-trap", "vehicle-make"];
  const morningPillar = morningPillars[Math.floor(Math.random() * morningPillars.length)];
  const morning = pick(morningPillar);
  if (morning) mix.push({ idea: morning, slot: "morning" });

  // Evening (7pm): Slideshow — educational, trust-building
  const eveningPillars = ["slideshow-contest", "slideshow-features", "slideshow-cameras"];
  const eveningPillar = eveningPillars[Math.floor(Math.random() * eveningPillars.length)];
  const evening = pick(eveningPillar);
  if (evening) mix.push({ idea: evening, slot: "evening" });

  // Midday (12pm, weekdays only): Vehicle-targeted or contest secret
  if (dayType === "weekday") {
    const middayPillars = ["vehicle-make", "contest-secret"];
    const middayPillar = middayPillars[Math.floor(Math.random() * middayPillars.length)];
    const midday = pick(middayPillar);
    if (midday) mix.push({ idea: midday, slot: "midday" });
  }

  db.close();
  return mix;
}

module.exports = { generateIdeas, generateDailyMix, PILLARS, PILLAR_NAMES };
