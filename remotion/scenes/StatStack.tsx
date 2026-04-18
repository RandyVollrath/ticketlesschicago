/**
 * StatStack — Scene type: "stat-stack"
 * Shows 2-4 stats stacked vertically, each slamming in with delay.
 * Great for rapid-fire data: "5.25M tickets", "14,384/day", "$83 avg"
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";
import { C, font, Particles, ScanLine } from "./shared";

export interface StatItem {
  number: string;
  label: string;
  sublabel?: string;
  color?: string;
}

export interface StatStackProps {
  stats: StatItem[];
  scanColor?: string;
  particleColors?: string[];
}

const StatSlam: React.FC<
  StatItem & { delay: number; totalStats: number }
> = ({ number, label, sublabel, color = C.red, delay, totalStats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    fps,
    frame: frame - delay,
    config: { damping: 11, stiffness: 250, mass: 0.5 },
  });
  const shk =
    frame - delay < 12 && frame - delay > 0
      ? Math.sin((frame - delay) * 7) * Math.max(0, 7 - (frame - delay))
      : 0;

  // Scale font size based on number of stats
  const numSize = totalStats <= 2 ? 120 : totalStats === 3 ? 105 : 90;
  const labelSize = totalStats <= 2 ? 38 : 34;

  return (
    <div
      style={{
        textAlign: "center",
        transform: `scale(${enter}) translateX(${shk}px)`,
        opacity: enter,
        marginBottom: totalStats <= 2 ? 80 : 55,
      }}
    >
      <div
        style={{
          fontSize: numSize,
          fontWeight: 900,
          color,
          fontFamily: font,
          lineHeight: 1,
        }}
      >
        {number}
      </div>
      <div
        style={{
          fontSize: labelSize,
          fontWeight: 700,
          color: C.white,
          fontFamily: font,
          marginTop: 10,
          textTransform: "uppercase",
          letterSpacing: 3,
        }}
      >
        {label}
      </div>
      {sublabel && (
        <div
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: C.dim,
            fontFamily: font,
            marginTop: 6,
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
};

export const StatStack: React.FC<StatStackProps> = ({
  stats,
  scanColor = C.red,
  particleColors = [C.red],
}) => {
  // Space delays evenly across the scene
  const delayPerStat = Math.floor(200 / Math.max(stats.length, 1));

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <ScanLine color={scanColor} />
      <Particles count={15} colors={particleColors} />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        {stats.map((stat, i) => (
          <StatSlam
            key={i}
            {...stat}
            delay={15 + i * delayPerStat}
            totalStats={stats.length}
          />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
