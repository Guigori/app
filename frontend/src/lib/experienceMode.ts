import { useSyncExternalStore } from "react";
import { classifyExperience, type ExperienceMode } from "@/shared/experience/classifyExperience";

export type { ExperienceMode };

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  const pointer = window.matchMedia("(pointer: coarse)");
  pointer.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
    pointer.removeEventListener("change", onChange);
  };
}

function getSnapshot(): ExperienceMode {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const touch = navigator.maxTouchPoints > 0;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const ua = navigator.userAgent;
  // iPadOS can advertise itself as Macintosh. This is a hint, not sole detection.
  const tabletHint = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touch && coarsePointer);
  return classifyExperience({ width, height, touch, coarsePointer, tabletHint });
}

export function useExperienceMode(): ExperienceMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "app");
}
