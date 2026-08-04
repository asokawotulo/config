export type ScrollInput = "page-up" | "page-down" | "wheel-up" | "wheel-down";

const SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

export function isMouseInput(data: string): boolean {
  return SGR_MOUSE_PATTERN.test(data);
}

export function parseScrollInput(data: string): ScrollInput | undefined {
  if (data === "\x1b[5;2~") return "page-up";
  if (data === "\x1b[6;2~") return "page-down";

  const match = data.match(SGR_MOUSE_PATTERN);
  if (!match) return undefined;

  const button = Number.parseInt(match[1]!, 10);
  if ((button & 64) === 0) return undefined;
  return (button & 1) === 0 ? "wheel-up" : "wheel-down";
}

export const ENABLE_MOUSE_REPORTING = "\x1b[?1000h\x1b[?1006h";
export const DISABLE_MOUSE_REPORTING = "\x1b[?1006l\x1b[?1000l";
