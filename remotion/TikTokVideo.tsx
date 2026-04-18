/**
 * TikTokVideo — Dynamic composition driven by JSON config.
 * Each scene in the config maps to a reusable scene component.
 * Used by the pipeline: scripts/tiktok/generate.js writes config → Remotion renders this.
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Html5Audio,
  staticFile,
  getInputProps,
} from "remotion";
import { BigNumberSlam } from "./scenes/BigNumberSlam";
import { StatStack } from "./scenes/StatStack";
import { TwoStat } from "./scenes/TwoStat";
import { CTA } from "./scenes/CTA";
import { BrandReveal } from "./scenes/BrandReveal";
import { PriceCompare } from "./scenes/PriceCompare";
import { Slideshow } from "./scenes/Slideshow";
import { C } from "./scenes/shared";

// ── Types ──
interface SceneConfig {
  type: string;
  props: Record<string, any>;
  durationFrames: number;
  voFile?: string; // e.g. "audio/tiktok/abc123/vo-0.mp3"
  voDelay?: number; // frames to delay VO start (default 10)
}

interface VideoConfig {
  scenes: SceneConfig[];
  musicFile?: string; // e.g. "audio/bg-music.mp3"
  musicVolume?: number;
}

// ── Scene registry ──
const SCENE_MAP: Record<string, React.FC<any>> = {
  "big-number": BigNumberSlam,
  "stat-stack": StatStack,
  "two-stat": TwoStat,
  cta: CTA,
  "brand-reveal": BrandReveal,
  "price-compare": PriceCompare,
  slideshow: Slideshow,
};

export const TikTokVideo: React.FC = () => {
  const inputProps = getInputProps() as VideoConfig;
  const config: VideoConfig = inputProps?.scenes
    ? inputProps
    : { scenes: [] };

  const { scenes, musicFile, musicVolume = 0.12 } = config;

  // Calculate cumulative start frames
  let cursor = 0;
  const sceneStarts = scenes.map((s) => {
    const start = cursor;
    cursor += s.durationFrames;
    return start;
  });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* Background music */}
      {musicFile && (
        <Html5Audio loop volume={musicVolume} src={staticFile(musicFile)} />
      )}

      {/* Scenes */}
      {scenes.map((scene, i) => {
        const Component = SCENE_MAP[scene.type];
        if (!Component) return null;

        return (
          <Sequence
            key={i}
            from={sceneStarts[i]}
            durationInFrames={scene.durationFrames}
          >
            <Component {...scene.props} />
            {scene.voFile && (
              <Sequence from={scene.voDelay ?? 10}>
                <Html5Audio
                  volume={0.9}
                  src={staticFile(scene.voFile)}
                />
              </Sequence>
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
