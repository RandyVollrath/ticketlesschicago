/**
 * PriceCompare — Scene type: "price-compare"
 * Shows cost of problem vs cost of solution with strikethrough.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { C, font, Particles, fadeIn } from "./shared";

export interface PriceCompareProps {
  problemLabel?: string;
  problemAmount?: string;
  problemSub?: string;
  solutionLabel?: string;
  solutionAmount?: string;
  solutionSub?: string;
  solutionDetail?: string;
  guaranteeText?: string;
}

export const PriceCompare: React.FC<PriceCompareProps> = ({
  problemLabel = "Right now you're losing",
  problemAmount = "$250",
  problemSub = "per year to tickets",
  solutionLabel = "Full protection",
  solutionAmount = "$79",
  solutionSub = "PER YEAR",
  solutionDetail = "That's 22 cents a day.",
  guaranteeText = "First Dismissal Guarantee.\nIf we don't save you money, you pay nothing.",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const topEnter = spring({
    fps,
    frame: frame - 10,
    config: { damping: 15 },
  });
  const cross = interpolate(frame, [80, 95], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bottomEnter = spring({
    fps,
    frame: frame - 130,
    config: { damping: 15 },
  });
  const guarantee = fadeIn(frame, 260, 30);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={18} colors={[C.green, C.gold]} />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              opacity: topEnter,
              transform: `translateY(${(1 - topEnter) * 40}px)`,
              marginBottom: 30,
              position: "relative",
            }}
          >
            <div
              style={{
                fontSize: 30,
                fontWeight: 600,
                color: C.gray,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 6,
                marginBottom: 15,
              }}
            >
              {problemLabel}
            </div>
            <div
              style={{
                fontSize: 155,
                fontWeight: 900,
                color: C.red,
                fontFamily: font,
                lineHeight: 1,
                position: "relative",
                display: "inline-block",
              }}
            >
              {problemAmount}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "-5%",
                  width: `${cross * 110}%`,
                  height: 8,
                  background: C.white,
                  transform: "rotate(-8deg)",
                }}
              />
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: C.offWhite,
                fontFamily: font,
                marginTop: 10,
              }}
            >
              {problemSub}
            </div>
          </div>

          <div
            style={{
              opacity: bottomEnter,
              transform: `translateY(${(1 - bottomEnter) * 40}px)`,
              marginTop: 30,
            }}
          >
            <div
              style={{
                fontSize: 30,
                fontWeight: 600,
                color: C.gray,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 6,
                marginBottom: 15,
              }}
            >
              {solutionLabel}
            </div>
            <div
              style={{
                fontSize: 190,
                fontWeight: 900,
                color: C.green,
                fontFamily: font,
                lineHeight: 1,
              }}
            >
              {solutionAmount}
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                color: C.green,
                fontFamily: font,
                letterSpacing: 4,
                marginTop: 5,
              }}
            >
              {solutionSub}
            </div>
            {solutionDetail && (
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 600,
                  color: C.gray,
                  fontFamily: font,
                  marginTop: 15,
                }}
              >
                {solutionDetail}
              </div>
            )}
          </div>

          {guaranteeText && (
            <div
              style={{
                marginTop: 50,
                opacity: guarantee,
                transform: `scale(${0.85 + guarantee * 0.15})`,
              }}
            >
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: C.gold,
                  fontFamily: font,
                  letterSpacing: 1,
                  lineHeight: 1.5,
                  whiteSpace: "pre-line",
                }}
              >
                {guaranteeText}
              </div>
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
