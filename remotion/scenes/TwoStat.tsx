/**
 * TwoStat — Scene type: "two-stat"
 * Two big numbers revealed sequentially with a kicker line.
 * Great for contrast: "94% just pay" → "66% get dismissed"
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";
import { C, font, Particles, fadeIn } from "./shared";

export interface TwoStatProps {
  stat1Label: string;
  stat1Number: string;
  stat1Sub: string;
  stat1Color?: string;
  stat2Label: string;
  stat2Number: string;
  stat2Sub: string;
  stat2Color?: string;
  kicker?: string;
  kickerColor?: string;
}

export const TwoStat: React.FC<TwoStatProps> = ({
  stat1Label,
  stat1Number,
  stat1Sub,
  stat1Color = C.orange,
  stat2Label,
  stat2Number,
  stat2Sub,
  stat2Color = C.green,
  kicker,
  kickerColor = C.gold,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const l1 = spring({ fps, frame: frame - 15, config: { damping: 15 } });
  const l2 = spring({ fps, frame: frame - 120, config: { damping: 15 } });
  const k = fadeIn(frame, 250, 30);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={15} colors={[stat1Color, stat2Color]} />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              opacity: l1,
              transform: `translateY(${(1 - l1) * 40}px)`,
              marginBottom: 70,
            }}
          >
            <div
              style={{
                fontSize: 34,
                fontWeight: 700,
                color: C.gray,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 4,
                marginBottom: 15,
              }}
            >
              {stat1Label}
            </div>
            <div
              style={{
                fontSize: 160,
                fontWeight: 900,
                color: stat1Color,
                fontFamily: font,
                lineHeight: 1,
              }}
            >
              {stat1Number}
            </div>
            <div
              style={{
                fontSize: 42,
                fontWeight: 700,
                color: C.white,
                fontFamily: font,
                marginTop: 10,
              }}
            >
              {stat1Sub}
            </div>
          </div>

          <div
            style={{
              opacity: l2,
              transform: `translateY(${(1 - l2) * 40}px)`,
              marginBottom: 50,
            }}
          >
            <div
              style={{
                fontSize: 34,
                fontWeight: 700,
                color: C.gray,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 4,
                marginBottom: 15,
              }}
            >
              {stat2Label}
            </div>
            <div
              style={{
                fontSize: 160,
                fontWeight: 900,
                color: stat2Color,
                fontFamily: font,
                lineHeight: 1,
              }}
            >
              {stat2Number}
            </div>
            <div
              style={{
                fontSize: 42,
                fontWeight: 700,
                color: C.white,
                fontFamily: font,
                marginTop: 10,
              }}
            >
              {stat2Sub}
            </div>
          </div>

          {kicker && (
            <div
              style={{
                opacity: k,
                transform: `scale(${0.85 + k * 0.15})`,
                marginTop: 20,
              }}
            >
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  color: kickerColor,
                  fontFamily: font,
                  letterSpacing: 1,
                  lineHeight: 1.5,
                }}
              >
                {kicker}
              </div>
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
