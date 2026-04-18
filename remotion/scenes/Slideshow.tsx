/**
 * Slideshow — Scene type: "slideshow"
 * TikTok-style text slides with smooth transitions.
 * Each slide fades/slides in, holds, then transitions to next.
 * Supports 3-8 slides with customizable colors and a title slide.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { C, font, Particles } from "./shared";

export interface SlideConfig {
  text: string;
  subtext?: string;
  highlight?: string; // word/phrase to highlight in accent color
  fontSize?: number;
  color?: string;
  accentColor?: string;
}

export interface SlideshowProps {
  slides: SlideConfig[];
  /** Duration per slide in frames (default auto-calculated) */
  framesPerSlide?: number;
  bgColor?: string;
  accentColor?: string;
  particleColors?: string[];
  /** Optional small label shown on every slide */
  sourceLabel?: string;
}

const SlideContent: React.FC<{
  slide: SlideConfig;
  progress: number; // 0-1 how far into this slide
  accentColor: string;
}> = ({ slide, progress, accentColor }) => {
  const enterProgress = Math.min(1, progress * 5); // first 20%
  const exitStart = 0.85;
  const exitProgress =
    progress > exitStart ? (progress - exitStart) / (1 - exitStart) : 0;

  const opacity = enterProgress * (1 - exitProgress);
  const translateY = (1 - enterProgress) * 60 + exitProgress * -40;
  const scale = 1 - exitProgress * 0.05;

  const textColor = slide.color || C.white;
  const accent = slide.accentColor || accentColor;
  const size = slide.fontSize || 52;

  // Highlight specific words
  let textContent: React.ReactNode = slide.text;
  if (slide.highlight) {
    const parts = slide.text.split(new RegExp(`(${slide.highlight})`, "gi"));
    textContent = parts.map((part, i) =>
      part.toLowerCase() === slide.highlight!.toLowerCase() ? (
        <span key={i} style={{ color: accent, fontWeight: 900 }}>
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        padding: "0 80px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: size,
            fontWeight: 800,
            color: textColor,
            fontFamily: font,
            lineHeight: 1.35,
            letterSpacing: 1,
          }}
        >
          {textContent}
        </div>
        {slide.subtext && (
          <div
            style={{
              fontSize: Math.round(size * 0.55),
              fontWeight: 600,
              color: C.dim,
              fontFamily: font,
              marginTop: 25,
              lineHeight: 1.4,
            }}
          >
            {slide.subtext}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const Slideshow: React.FC<SlideshowProps> = ({
  slides,
  framesPerSlide,
  bgColor = C.bg,
  accentColor = C.cyan,
  particleColors = [C.cyan, C.green],
  sourceLabel,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const perSlide =
    framesPerSlide || Math.floor(durationInFrames / slides.length);

  // Progress bar at bottom
  const totalProgress = frame / durationInFrames;

  return (
    <AbsoluteFill style={{ background: bgColor, overflow: "hidden" }}>
      <Particles count={15} colors={particleColors} />

      {/* Slides */}
      {slides.map((slide, i) => {
        const slideStart = i * perSlide;
        const slideEnd = (i + 1) * perSlide;

        if (frame < slideStart - 10 || frame > slideEnd + 10) return null;

        const progress = (frame - slideStart) / perSlide;
        return (
          <SlideContent
            key={i}
            slide={slide}
            progress={Math.max(0, Math.min(1, progress))}
            accentColor={accentColor}
          />
        );
      })}

      {/* Slide counter */}
      <div
        style={{
          position: "absolute",
          top: 80,
          right: 60,
          fontSize: 24,
          fontWeight: 600,
          color: C.dim,
          fontFamily: font,
        }}
      >
        {Math.min(
          slides.length,
          Math.floor(frame / perSlide) + 1
        )}{" "}
        / {slides.length}
      </div>

      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          bottom: 120,
          left: 60,
          right: 60,
          height: 4,
          background: `${C.white}15`,
          borderRadius: 2,
        }}
      >
        <div
          style={{
            width: `${totalProgress * 100}%`,
            height: "100%",
            background: accentColor,
            borderRadius: 2,
          }}
        />
      </div>

      {/* Source label */}
      {sourceLabel && (
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 20,
            fontWeight: 500,
            color: C.dim,
            fontFamily: font,
          }}
        >
          {sourceLabel}
        </div>
      )}
    </AbsoluteFill>
  );
};
