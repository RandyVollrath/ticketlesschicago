/**
 * BigNumberSlam — Scene type: "big-number"
 * Shows a big number with optional subtitle and context lines.
 * Great for "$420M", "5.25M tickets", "94%", etc.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { C, font, Particles, GlitchText, slideUp } from "./shared";

export interface BigNumberProps {
  preText?: string;
  number: string;
  postText?: string;
  subText?: string;
  color?: string;
  glitch?: boolean;
  particleColors?: string[];
}

export const BigNumberSlam: React.FC<BigNumberProps> = ({
  preText,
  number,
  postText,
  subText,
  color = C.red,
  glitch = false,
  particleColors = [C.red, C.orange],
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slam = spring({
    fps,
    frame: frame - 10,
    config: { damping: 9, stiffness: 350, mass: 0.4 },
  });

  const shakeI = frame < 25 ? Math.max(0, 12 - (frame - 8)) : 0;
  const shakeX = Math.sin(frame * 6) * shakeI;
  const shakeY = Math.cos(frame * 9) * shakeI * 0.4;

  const flash = frame < 12 ? Math.max(0, 1 - frame / 12) : 0;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Particles count={20} colors={particleColors} />
      <AbsoluteFill style={{ background: C.white, opacity: flash }} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          transform: `translate(${shakeX}px, ${shakeY}px)`,
        }}
      >
        <div style={{ textAlign: "center" }}>
          {preText && (
            <div
              style={{
                ...slideUp(frame, 35, 25),
                fontSize: 46,
                fontWeight: 800,
                color: C.white,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 8,
                marginBottom: 35,
              }}
            >
              {preText}
            </div>
          )}

          <div style={{ transform: `scale(${slam})` }}>
            {glitch ? (
              <GlitchText text={number} fontSize={200} color={color} />
            ) : (
              <div
                style={{
                  fontSize: 200,
                  fontWeight: 900,
                  color,
                  fontFamily: font,
                  lineHeight: 1,
                }}
              >
                {number}
              </div>
            )}
          </div>

          {postText && (
            <div
              style={{
                ...slideUp(frame, 60, 25),
                fontSize: 42,
                fontWeight: 700,
                color: C.orange,
                fontFamily: font,
                textTransform: "uppercase",
                letterSpacing: 5,
                marginTop: 35,
              }}
            >
              {postText}
            </div>
          )}

          {subText && (
            <div
              style={{
                ...slideUp(frame, 90, 25),
                fontSize: 34,
                fontWeight: 600,
                color: C.dim,
                fontFamily: font,
                marginTop: 60,
              }}
            >
              {subText}
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
