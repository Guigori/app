import { useSyncExternalStore } from "react";

export type ExperienceMode = "app" | "dashboard";

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
  const isLandscape = width > height;
  const hasTouch = navigator.maxTouchPoints > 0;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  // Tablet-class touch displays, including iPadOS desktop-style user agents.
  // A laptop with a touchscreen and a fine pointer remains a dashboard.
  const isTablet = hasTouch && coarsePointer && Math.max(width, height) >= 700 && Math.min(width, height) >= 600;
  if (isTablet) return isLandscape ? "dashboard" : "app";
  const isPhone = hasTouch && coarsePointer && Math.min(width, height) < 600;
  return isPhone ? "app" : "dashboard";
}

export function useExperienceMode(): ExperienceMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "app");
}
