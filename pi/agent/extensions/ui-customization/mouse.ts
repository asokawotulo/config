export type ScrollInput = "page-up" | "page-down" | "wheel-up" | "wheel-down";

export interface MouseCoordinates {
  /** One-based terminal column from an SGR mouse report. */
  column: number;
  /** One-based terminal row from an SGR mouse report. */
  row: number;
}

interface SgrMouseInput extends MouseCoordinates {
  button: number;
  release: boolean;
}

const SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

function parseSgrMouseInput(data: string): SgrMouseInput | undefined {
  const match = data.match(SGR_MOUSE_PATTERN);
  if (!match) return undefined;
  return {
    button: Number.parseInt(match[1]!, 10),
    column: Number.parseInt(match[2]!, 10),
    row: Number.parseInt(match[3]!, 10),
    release: match[4] === "m",
  };
}

export function isMouseInput(data: string): boolean {
  return SGR_MOUSE_PATTERN.test(data);
}

/** Parse an SGR left-button press, retaining its one-based coordinates. */
export function parseLeftClick(data: string): MouseCoordinates | undefined {
  const input = parseSgrMouseInput(data);
  if (
    !input ||
    input.release ||
    // Ignore motion and wheel reports while allowing keyboard modifier bits.
    (input.button & (3 | 32 | 64)) !== 0
  ) {
    return undefined;
  }
  return { column: input.column, row: input.row };
}

export function parseScrollInput(data: string): ScrollInput | undefined {
  if (data === "\x1b[5;2~") return "page-up";
  if (data === "\x1b[6;2~") return "page-down";

  const input = parseSgrMouseInput(data);
  if (!input || (input.button & 64) === 0) return undefined;
  return (input.button & 1) === 0 ? "wheel-up" : "wheel-down";
}

export const ENABLE_MOUSE_REPORTING = "\x1b[?1000h\x1b[?1006h";
export const DISABLE_MOUSE_REPORTING = "\x1b[?1006l\x1b[?1000l";
