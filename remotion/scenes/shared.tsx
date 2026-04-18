import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

// ── Color palette ──
export const C = {
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

export const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ── Helpers ──
export function fadeIn(frame: number, start: number, dur = 20) {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function slideUp(frame: number, start: number, dur = 20) {
  const o = fadeIn(frame, start, dur);
  return { opacity: o, transform: `translateY(${(1 - o) * 30}px)` };
}

// ── Particles ──
export const Particles: React.FC<{ count?: number; colors?: string[] }> = ({
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
export const ScanLine: React.FC<{ color?: string }> = ({ color = C.cyan }) => {
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
export const GlitchText: React.FC<{
  text: string;
  fontSize: number;
  color: string;
}> = ({ text, fontSize, color }) => {
  const frame = useCurrentFrame();
  const active = frame % 40 < 3;
  const offset = active ? Math.sin(frame * 50) * 5 : 0;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {active && (
        <div
          style={{
            position: "absolute",
            fontSize,
            fontWeight: 900,
            color: C.red,
            fontFamily: font,
            opacity: 0.5,
            transform: `translateX(${offset * 1.5}px)`,
          }}
        >
          {text}
        </div>
      )}
      {active && (
        <div
          style={{
            position: "absolute",
            fontSize,
            fontWeight: 900,
            color: C.cyan,
            fontFamily: font,
            opacity: 0.5,
            transform: `translateX(${-offset}px)`,
          }}
        >
          {text}
        </div>
      )}
      <div
        style={{
          fontSize,
          fontWeight: 900,
          color,
          fontFamily: font,
          position: "relative",
        }}
      >
        {text}
      </div>
    </div>
  );
};
