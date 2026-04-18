/**
 * BrandReveal — Scene type: "brand-reveal"
 * Autopilot America logo with spinning rings and taglines.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";
import { C, font, Particles, ScanLine, slideUp } from "./shared";

export interface BrandRevealProps {
  tagline1?: string;
  tagline2?: string;
}

export const BrandReveal: React.FC<BrandRevealProps> = ({
  tagline1 = "We built the system for you.",
  tagline2 = "Prevention. Detection. Automatic contesting.",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoEnter = spring({
    fps,
    frame: frame - 15,
    config: { damping: 11, stiffness: 180, mass: 0.6 },
  });
  const ringAngle = frame * 0.5;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={35} colors={[C.cyan, C.green, C.blue]} />
      <ScanLine color={C.cyan} />

      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: "50%",
            top: "45%",
            width: 440 + i * 100,
            height: 440 + i * 100,
            marginLeft: -(220 + i * 50),
            marginTop: -(220 + i * 50),
            borderRadius: "50%",
            border: `1px solid ${[C.cyan, C.green, C.blue][i]}25`,
            transform: `rotate(${ringAngle * (i % 2 === 0 ? 1 : -1) + i * 40}deg) scale(${logoEnter})`,
          }}
        />
      ))}

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div
          style={{
            textAlign: "center",
            transform: `scale(${logoEnter})`,
          }}
        >
          <div
            style={{
              fontSize: 92,
              fontWeight: 900,
              color: C.white,
              fontFamily: font,
              letterSpacing: 6,
            }}
          >
            AUTOPILOT
          </div>
          <div
            style={{
              fontSize: 58,
              fontWeight: 800,
              color: C.cyan,
              fontFamily: font,
              letterSpacing: 22,
              marginTop: -5,
            }}
          >
            AMERICA
          </div>
        </div>

        <div
          style={{ position: "absolute", bottom: 460, textAlign: "center" }}
        >
          <div
            style={{
              ...slideUp(frame, 80, 25),
              fontSize: 42,
              fontWeight: 700,
              color: C.green,
              fontFamily: font,
              letterSpacing: 2,
              marginBottom: 15,
            }}
          >
            {tagline1}
          </div>
          <div
            style={{
              ...slideUp(frame, 110, 25),
              fontSize: 34,
              fontWeight: 600,
              color: C.gray,
              fontFamily: font,
            }}
          >
            {tagline2}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
