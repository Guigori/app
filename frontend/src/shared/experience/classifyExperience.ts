export type ExperienceMode = "app" | "dashboard";
export type DisplayProfile = {
  width: number;
  height: number;
  touch: boolean;
  coarsePointer: boolean;
  tabletHint?: boolean;
};

/** Pure policy: no financial logic, no React, no browser globals. */
export function classifyExperience(profile: DisplayProfile): ExperienceMode {
  const { width, height, touch, coarsePointer, tabletHint = false } = profile;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const landscape = width > height;
  // Phones remain App even when rotated. Touch-enabled laptops remain Dashboard.
  const touchPrimary = touch && coarsePointer;
  const tablet = touchPrimary && (tabletHint || (shortSide >= 600 && longSide >= 700));
  if (tablet) return landscape ? "dashboard" : "app";
  if (touchPrimary && shortSide < 600) return "app";
  return "dashboard";
}
