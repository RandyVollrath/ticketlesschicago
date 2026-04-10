import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  staticFile,
  Html5Audio,
} from "remotion";

// ── Design system ──
const C = {
  bg: "#050508",
  red: "#ff1a1a",
  orange: "#ff6b2b",
  gold: "#ffd700",
  white: "#ffffff",
  offWhite: "#e8e8e8",
  gray: "#aaaaaa",
  dim: "#666666",
  dark: "#111114",
  green: "#00e676",
  cyan: "#00e5ff",
  blue: "#2979ff",
};

const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ── Scene timing (frames at 30fps) ──
const T = {
  s1: 255,   // 8.5s — $420M hook
  s2: 345,   // 11.5s — stats machine
  s3: 240,   // 8s — are you next
  s4: 420,   // 14s — opportunity (94%/66%)
  s5: 300,   // 10s — reveal
  s6: 420,   // 14s — value stack
  s7: 420,   // 14s — offer
  s8: 240,   // 8s — CTA
};

// cumulative starts
const S = {
  s1: 0,
  s2: T.s1,
  s3: T.s1 + T.s2,
  s4: T.s1 + T.s2 + T.s3,
  s5: T.s1 + T.s2 + T.s3 + T.s4,
  s6: T.s1 + T.s2 + T.s3 + T.s4 + T.s5,
  s7: T.s1 + T.s2 + T.s3 + T.s4 + T.s5 + T.s6,
  s8: T.s1 + T.s2 + T.s3 + T.s4 + T.s5 + T.s6 + T.s7,
};

// ── Particles ──
const Particles: React.FC<{ count?: number; colors?: string[] }> = ({
  count = 25,
  colors = [C.cyan, C.green, C.gold],
}) => {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const seed = i * 137.508;
        const x = (seed * 7.3) % 1080;
        const baseY = (seed * 3.7) % 1920;
        const y = (baseY - frame * (0.6 + (i % 3) * 0.3)) % 2200;
        const size = 2 + (i % 3);
        const color = colors[i % colors.length];
        const pulse = 0.3 + 0.3 * Math.sin(frame * 0.03 + i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y < -20 ? y + 2200 : y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              opacity: pulse,
            }}
          />
        );
      })}
    </>
  );
};

// ── Scan line ──
const ScanLine: React.FC<{ color?: string }> = ({ color = C.cyan }) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame % 100, [0, 100], [-100, 2100]);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: y,
        height: 2,
        background: `linear-gradient(90deg, transparent 5%, ${color}80 50%, transparent 95%)`,
        opacity: 0.35,
      }}
    />
  );
};

// ── Glitch text ──
const GlitchText: React.FC<{ text: string; fontSize: number; color: string }> = ({
  text,
  fontSize,
  color,
}) => {
  const frame = useCurrentFrame();
  const active = frame % 40 < 3;
  const offset = active ? Math.sin(frame * 50) * 5 : 0;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {active && (
        <div style={{ position: "absolute", fontSize, fontWeight: 900, color: C.red, fontFamily: font, opacity: 0.5, transform: `translateX(${offset * 1.5}px)` }}>
          {text}
        </div>
      )}
      {active && (
        <div style={{ position: "absolute", fontSize, fontWeight: 900, color: C.cyan, fontFamily: font, opacity: 0.5, transform: `translateX(${-offset}px)` }}>
          {text}
        </div>
      )}
      <div style={{ fontSize, fontWeight: 900, color, fontFamily: font, position: "relative" }}>
        {text}
      </div>
    </div>
  );
};

// ── Fade helper ──
function fadeIn(frame: number, start: number, dur = 20) {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function slideUp(frame: number, start: number, dur = 20) {
  const o = fadeIn(frame, start, dur);
  return { opacity: o, transform: `translateY(${(1 - o) * 30}px)` };
}

// ═══════════════════════════════════════════════
// SCENE 1: $420M HOOK (8.5s)
// ═══════════════════════════════════════════════
const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const flash = interpolate(frame, [0, 4, 12], [1, 0.5, 0], { extrapolateRight: "clamp" });
  const slam = spring({ fps, frame: frame - 8, config: { damping: 9, stiffness: 350, mass: 0.4 } });
  const shakeI = interpolate(frame, [8, 30], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shakeX = Math.sin(frame * 6) * shakeI;
  const shakeY = Math.cos(frame * 9) * shakeI * 0.4;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={20} colors={[C.red, C.orange]} />
      <AbsoluteFill style={{ background: C.white, opacity: flash }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `translate(${shakeX}px, ${shakeY}px)` }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ ...slideUp(frame, 40, 25), fontSize: 46, fontWeight: 800, color: C.white, fontFamily: font, textTransform: "uppercase", letterSpacing: 8, marginBottom: 35 }}>
            The city of Chicago took
          </div>
          <div style={{ transform: `scale(${slam})` }}>
            <GlitchText text="$420M" fontSize={200} color={C.red} />
          </div>
          <div style={{ ...slideUp(frame, 70, 25), fontSize: 42, fontWeight: 700, color: C.orange, fontFamily: font, textTransform: "uppercase", letterSpacing: 5, marginTop: 35 }}>
            from drivers just like you
          </div>
          <div style={{ ...slideUp(frame, 110, 25), fontSize: 34, fontWeight: 600, color: C.dim, fontFamily: font, marginTop: 60 }}>
            Last year alone.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 2: STATS MACHINE (11.5s)
// ═══════════════════════════════════════════════
const StatSlam: React.FC<{ number: string; label: string; sub?: string; color: string; delay: number }> = ({
  number, label, sub, color, delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ fps, frame: frame - delay, config: { damping: 11, stiffness: 250, mass: 0.5 } });
  const shk = frame - delay < 12 && frame - delay > 0 ? Math.sin((frame - delay) * 7) * Math.max(0, 7 - (frame - delay)) : 0;

  return (
    <div style={{ textAlign: "center", transform: `scale(${enter}) translateX(${shk}px)`, opacity: enter, marginBottom: 60 }}>
      <div style={{ fontSize: 105, fontWeight: 900, color, fontFamily: font, lineHeight: 1 }}>{number}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: C.white, fontFamily: font, marginTop: 10, textTransform: "uppercase", letterSpacing: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 24, fontWeight: 500, color: C.dim, fontFamily: font, marginTop: 6 }}>{sub}</div>}
    </div>
  );
};

const Scene2: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <ScanLine color={C.red} />
      <Particles count={15} colors={[C.red]} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <StatSlam number="5.25M" label="tickets issued in 2025" sub="that's not a typo" color={C.red} delay={15} />
        <StatSlam number="14,384" label="tickets every single day" color={C.orange} delay={80} />
        <StatSlam number="$83" label="average ticket with late fees" sub="and most people don't even know they got one" color={C.gold} delay={150} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 3: ARE YOU NEXT? (8s)
// ═══════════════════════════════════════════════
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ fps, frame: frame - 12, config: { damping: 9, stiffness: 220, mass: 0.6 } });
  const pulse = 0.92 + 0.08 * Math.sin(frame * 0.12);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={15} colors={[C.red]} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center", transform: `scale(${scale * pulse})` }}>
          <div style={{ fontSize: 100, fontWeight: 900, color: C.white, fontFamily: font, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 10 }}>
            ARE YOU
          </div>
          <GlitchText text="NEXT?" fontSize={170} color={C.red} />
        </div>
        <div style={{ position: "absolute", bottom: 500, textAlign: "center", ...slideUp(frame, 50, 30) }}>
          <div style={{ fontSize: 36, fontWeight: 600, color: C.gray, fontFamily: font, lineHeight: 1.6 }}>
            3 tickets per car, per year.
            <br />
            $250 out of your pocket. Every year.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 4: THE OPPORTUNITY — 94% / 66% (14s)
// ═══════════════════════════════════════════════
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const l1 = spring({ fps, frame: frame - 15, config: { damping: 15 } });
  const l2 = spring({ fps, frame: frame - 120, config: { damping: 15 } });
  const kicker = fadeIn(frame, 250, 30);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={15} colors={[C.gold, C.green]} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          {/* 94% */}
          <div style={{ opacity: l1, transform: `translateY(${(1 - l1) * 40}px)`, marginBottom: 70 }}>
            <div style={{ fontSize: 34, fontWeight: 700, color: C.gray, fontFamily: font, textTransform: "uppercase", letterSpacing: 4, marginBottom: 15 }}>
              Here's the crazy part
            </div>
            <div style={{ fontSize: 160, fontWeight: 900, color: C.orange, fontFamily: font, lineHeight: 1 }}>94%</div>
            <div style={{ fontSize: 42, fontWeight: 700, color: C.white, fontFamily: font, marginTop: 10 }}>
              of people just pay it
            </div>
          </div>

          {/* 66% */}
          <div style={{ opacity: l2, transform: `translateY(${(1 - l2) * 40}px)`, marginBottom: 50 }}>
            <div style={{ fontSize: 34, fontWeight: 700, color: C.gray, fontFamily: font, textTransform: "uppercase", letterSpacing: 4, marginBottom: 15 }}>
              But when you actually fight back
            </div>
            <div style={{ fontSize: 160, fontWeight: 900, color: C.green, fontFamily: font, lineHeight: 1 }}>66%</div>
            <div style={{ fontSize: 42, fontWeight: 700, color: C.white, fontFamily: font, marginTop: 10 }}>
              get dismissed
            </div>
          </div>

          {/* Kicker */}
          <div style={{ opacity: kicker, transform: `scale(${0.85 + kicker * 0.15})`, marginTop: 20 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: C.gold, fontFamily: font, letterSpacing: 1, lineHeight: 1.5 }}>
              You're not bad at parking.
              <br />
              You just don't have a system.
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 5: AUTOPILOT AMERICA REVEAL (10s)
// ═══════════════════════════════════════════════
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoEnter = spring({ fps, frame: frame - 20, config: { damping: 11, stiffness: 180, mass: 0.6 } });
  const ringAngle = frame * 0.5;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={35} colors={[C.cyan, C.green, C.blue]} />
      <ScanLine color={C.cyan} />

      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute", left: "50%", top: "45%",
            width: 440 + i * 100, height: 440 + i * 100,
            marginLeft: -(220 + i * 50), marginTop: -(220 + i * 50),
            borderRadius: "50%",
            border: `1px solid ${[C.cyan, C.green, C.blue][i]}25`,
            transform: `rotate(${ringAngle * (i % 2 === 0 ? 1 : -1) + i * 40}deg) scale(${logoEnter})`,
          }}
        />
      ))}

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center", transform: `scale(${logoEnter})` }}>
          <div style={{ fontSize: 92, fontWeight: 900, color: C.white, fontFamily: font, letterSpacing: 6 }}>AUTOPILOT</div>
          <div style={{ fontSize: 58, fontWeight: 800, color: C.cyan, fontFamily: font, letterSpacing: 22, marginTop: -5 }}>AMERICA</div>
        </div>

        <div style={{ position: "absolute", bottom: 460, textAlign: "center" }}>
          <div style={{ ...slideUp(frame, 80, 25), fontSize: 42, fontWeight: 700, color: C.green, fontFamily: font, letterSpacing: 2, marginBottom: 15 }}>
            We built the system for you.
          </div>
          <div style={{ ...slideUp(frame, 110, 25), fontSize: 34, fontWeight: 600, color: C.gray, fontFamily: font }}>
            Prevention. Detection. Automatic contesting.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 6: VALUE STACK (14s)
// ═══════════════════════════════════════════════
const StackRow: React.FC<{ icon: string; title: string; value: string; color: string; index: number }> = ({
  icon, title, value, color, index,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = 20 + index * 40;
  const enter = spring({ fps, frame: frame - delay, config: { damping: 13, stiffness: 130 } });
  const slideX = interpolate(enter, [0, 1], [index % 2 === 0 ? -500 : 500, 0]);

  return (
    <div style={{
      transform: `translateX(${slideX}px)`, opacity: enter,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "28px 40px", background: C.dark, borderRadius: 20,
      borderLeft: `4px solid ${color}`, marginBottom: 18, width: "88%",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ fontSize: 46, width: 56, textAlign: "center", flexShrink: 0 }}>{icon}</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: C.white, fontFamily: font }}>{title}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: font }}>{value}</div>
    </div>
  );
};

const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const totalReveal = fadeIn(frame, 260, 30);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={12} colors={[C.cyan, C.green]} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <div style={{
          ...slideUp(frame, 5, 20),
          fontSize: 38, fontWeight: 900, color: C.white, fontFamily: font,
          textTransform: "uppercase", letterSpacing: 6, marginBottom: 35,
        }}>
          Here's what you get
        </div>

        <StackRow icon={"\u{1F6A8}"} title="Live Camera Alerts" value="Priceless" color={C.red} index={0} />
        <StackRow icon={"\u{1F17F}\uFE0F"} title="Smart Parking Guard" value="$50+ saved" color={C.cyan} index={1} />
        <StackRow icon={"\u{1F50E}"} title="Ticket Radar (2x/week)" value="$83+ saved" color={C.green} index={2} />
        <StackRow icon={"\u{2709}\uFE0F"} title="Auto Contest Letters" value="$150+ saved" color={C.gold} index={3} />
        <StackRow icon={"\u{1F514}"} title="Street Cleaning Alerts" value="$60+ saved" color={C.orange} index={4} />

        <div style={{ opacity: totalReveal, transform: `scale(${0.8 + totalReveal * 0.2})`, marginTop: 30, textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: C.dim, fontFamily: font, textTransform: "uppercase", letterSpacing: 4, marginBottom: 8 }}>
            Total value
          </div>
          <div style={{ fontSize: 88, fontWeight: 900, color: C.green, fontFamily: font, lineHeight: 1 }}>$343+</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: C.dim, fontFamily: font, marginTop: 5 }}>per year in protection</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 7: THE OFFER (14s)
// ═══════════════════════════════════════════════
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const topEnter = spring({ fps, frame: frame - 10, config: { damping: 15 } });
  const cross = interpolate(frame, [80, 95], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bottomEnter = spring({ fps, frame: frame - 130, config: { damping: 15 } });
  const guarantee = fadeIn(frame, 260, 30);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={18} colors={[C.green, C.gold]} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          {/* What you're losing */}
          <div style={{ opacity: topEnter, transform: `translateY(${(1 - topEnter) * 40}px)`, marginBottom: 30, position: "relative" }}>
            <div style={{ fontSize: 30, fontWeight: 600, color: C.gray, fontFamily: font, textTransform: "uppercase", letterSpacing: 6, marginBottom: 15 }}>
              Right now you're losing
            </div>
            <div style={{ fontSize: 155, fontWeight: 900, color: C.red, fontFamily: font, lineHeight: 1, position: "relative", display: "inline-block" }}>
              $250
              <div style={{
                position: "absolute", top: "50%", left: "-5%",
                width: `${cross * 110}%`, height: 8, background: C.white,
                transform: "rotate(-8deg)",
              }} />
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: C.offWhite, fontFamily: font, marginTop: 10 }}>per year to tickets</div>
          </div>

          {/* Autopilot price */}
          <div style={{ opacity: bottomEnter, transform: `translateY(${(1 - bottomEnter) * 40}px)`, marginTop: 30 }}>
            <div style={{ fontSize: 30, fontWeight: 600, color: C.gray, fontFamily: font, textTransform: "uppercase", letterSpacing: 6, marginBottom: 15 }}>
              Full protection
            </div>
            <div style={{ fontSize: 190, fontWeight: 900, color: C.green, fontFamily: font, lineHeight: 1 }}>$99</div>
            <div style={{ fontSize: 40, fontWeight: 700, color: C.green, fontFamily: font, letterSpacing: 4, marginTop: 5 }}>PER YEAR</div>
            <div style={{ fontSize: 30, fontWeight: 600, color: C.gray, fontFamily: font, marginTop: 15 }}>That's 27 cents a day.</div>
          </div>

          {/* Guarantee */}
          <div style={{ marginTop: 50, opacity: guarantee, transform: `scale(${0.85 + guarantee * 0.15})` }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: C.gold, fontFamily: font, letterSpacing: 1, lineHeight: 1.5 }}>
              First Dismissal Guarantee.
              <br />
              If we don't save you money, you pay nothing.
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// SCENE 8: CTA (8s)
// ═══════════════════════════════════════════════
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ fps, frame, config: { damping: 13, stiffness: 160 } });
  const buttonPulse = 1 + 0.04 * Math.sin(frame * 0.15);
  const shimmerX = interpolate(frame % 55, [0, 55], [-200, 700]);
  const arrowBounce = Math.sin(frame * 0.12) * 10;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={25} colors={[C.green, C.cyan, C.gold]} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center", transform: `scale(${enter})` }}>
          <div style={{ fontSize: 42, fontWeight: 800, color: C.white, fontFamily: font, textTransform: "uppercase", letterSpacing: 4, marginBottom: 12 }}>
            Every day you wait
          </div>
          <div style={{ ...slideUp(frame, 20, 25), fontSize: 42, fontWeight: 800, color: C.red, fontFamily: font, textTransform: "uppercase", letterSpacing: 4, marginBottom: 55 }}>
            is another ticket you'll pay for
          </div>

          {/* CTA Button */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 12,
            background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`,
            borderRadius: 100, padding: "34px 65px",
            transform: `scale(${buttonPulse})`, position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: 0, left: shimmerX, width: 100, height: "100%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
              transform: "skewX(-20deg)",
            }} />
            <span style={{ fontSize: 44, fontWeight: 900, color: C.bg, fontFamily: font, letterSpacing: 3, position: "relative" }}>
              GET PROTECTED
            </span>
            <span style={{ fontSize: 44, position: "relative", transform: `translateX(${arrowBounce}px)`, color: C.bg }}>
              {"\u2192"}
            </span>
          </div>

          <div style={{ ...slideUp(frame, 50, 25), fontSize: 30, fontWeight: 600, color: C.dim, fontFamily: font, marginTop: 35 }}>
            $99/year  ·  First Dismissal Guarantee
          </div>

          <div style={{ ...slideUp(frame, 60, 25), fontSize: 36, fontWeight: 700, color: C.gold, fontFamily: font, marginTop: 25, letterSpacing: 1 }}>
            autopilotamerica.com
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════
// MAIN COMPOSITION
// ═══════════════════════════════════════════════
export const TicketlessAd: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* Background music — loops, low volume */}
      <Html5Audio loop volume={0.12} src={staticFile("audio/bg-music.mp3")} />

      {/* Scene 1 + VO */}
      <Sequence from={S.s1} durationInFrames={T.s1}>
        <Scene1 />
        <Sequence from={10}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene1.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 2 + VO */}
      <Sequence from={S.s2} durationInFrames={T.s2}>
        <Scene2 />
        <Sequence from={10}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene2.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 3 + VO */}
      <Sequence from={S.s3} durationInFrames={T.s3}>
        <Scene3 />
        <Sequence from={10}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene3.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 4 + VO */}
      <Sequence from={S.s4} durationInFrames={T.s4}>
        <Scene4 />
        <Sequence from={10}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene4.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 5 + VO */}
      <Sequence from={S.s5} durationInFrames={T.s5}>
        <Scene5 />
        <Sequence from={15}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene5.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 6 + VO */}
      <Sequence from={S.s6} durationInFrames={T.s6}>
        <Scene6 />
        <Sequence from={10}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene6.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 7 + VO */}
      <Sequence from={S.s7} durationInFrames={T.s7}>
        <Scene7 />
        <Sequence from={10}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene7.mp3")} />
        </Sequence>
      </Sequence>

      {/* Scene 8 + VO */}
      <Sequence from={S.s8} durationInFrames={T.s8}>
        <Scene8 />
        <Sequence from={5}>
          <Html5Audio volume={0.9} src={staticFile("audio/vo-scene8.mp3")} />
        </Sequence>
      </Sequence>
    </AbsoluteFill>
  );
};
