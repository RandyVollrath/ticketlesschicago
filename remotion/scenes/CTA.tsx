/**
 * CTA — Scene type: "cta"
 * Call-to-action with button animation and URL.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { C, font, Particles, slideUp } from "./shared";

export interface CTAProps {
  headline?: string;
  headlineSub?: string;
  buttonText?: string;
  price?: string;
  guarantee?: string;
  url?: string;
}

export const CTA: React.FC<CTAProps> = ({
  headline = "Every day you wait",
  headlineSub = "is another ticket you'll pay for",
  buttonText = "GET PROTECTED",
  price = "$79/year  ·  First Dismissal Guarantee",
  guarantee,
  url = "autopilotamerica.com",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    fps,
    frame,
    config: { damping: 13, stiffness: 160 },
  });
  const buttonPulse = 1 + 0.04 * Math.sin(frame * 0.15);
  const shimmerX = interpolate(frame % 55, [0, 55], [-200, 700]);
  const arrowBounce = Math.sin(frame * 0.12) * 10;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={25} colors={[C.green, C.cyan, C.gold]} />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div style={{ textAlign: "center", transform: `scale(${enter})` }}>
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              color: C.white,
              fontFamily: font,
              textTransform: "uppercase",
              letterSpacing: 4,
              marginBottom: 12,
            }}
          >
            {headline}
          </div>
          {headlineSub && (
            <div
              style={{
                ...slideUp(frame, 20, 25),
                fontSize: 42,
                fontWeight: 800,
                color: C.red,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 4,
                marginBottom: 55,
              }}
            >
              {headlineSub}
            </div>
          )}

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`,
              borderRadius: 100,
              padding: "34px 65px",
              transform: `scale(${buttonPulse})`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: shimmerX,
                width: 100,
                height: "100%",
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
                transform: "skewX(-20deg)",
              }}
            />
            <span
              style={{
                fontSize: 44,
                fontWeight: 900,
                color: C.bg,
                fontFamily: font,
                letterSpacing: 3,
                position: "relative",
              }}
            >
              {buttonText}
            </span>
            <span
              style={{
                fontSize: 44,
                position: "relative",
                transform: `translateX(${arrowBounce}px)`,
                color: C.bg,
              }}
            >
              {"\u2192"}
            </span>
          </div>

          {price && (
            <div
              style={{
                ...slideUp(frame, 50, 25),
                fontSize: 30,
                fontWeight: 600,
                color: C.dim,
                fontFamily: font,
                marginTop: 35,
              }}
            >
              {price}
            </div>
          )}

          {url && (
            <div
              style={{
                ...slideUp(frame, 60, 25),
                fontSize: 36,
                fontWeight: 700,
                color: C.gold,
                fontFamily: font,
                marginTop: 25,
                letterSpacing: 1,
              }}
            >
              {url}
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
