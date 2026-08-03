import type { Theme } from "@earendil-works/pi-coding-agent";
import type { DiffBackgroundColorKey } from "./types.ts";

const BACKGROUND_RESET = "\x1b[49m";
const FULL_SGR_RESET = /\x1b\[0m/g;

export function foregroundAnsiToBackground(ansi: string): string | undefined {
  const background = ansi.replace("[38;", "[48;");
  return background === ansi ? undefined : background;
}

function fallbackBackground(theme: Theme, key: DiffBackgroundColorKey): string {
  return key === "toolDiffAddedBg"
    ? theme.getBgAnsi("toolSuccessBg")
    : theme.getBgAnsi("toolErrorBg");
}

export function getDiffBackgroundAnsi(theme: Theme, key: DiffBackgroundColorKey): string {
  try {
    const foreground = theme.getFgAnsi(key as Parameters<Theme["getFgAnsi"]>[0]);
    return foregroundAnsiToBackground(foreground) ?? fallbackBackground(theme, key);
  } catch {
    return fallbackBackground(theme, key);
  }
}

export function applyDiffBackground(
  theme: Theme,
  key: DiffBackgroundColorKey,
  text: string,
): string {
  const background = getDiffBackgroundAnsi(theme, key);
  const stableText = text.replace(FULL_SGR_RESET, `\x1b[0m${background}`);
  return `${background}${stableText}${BACKGROUND_RESET}`;
}
