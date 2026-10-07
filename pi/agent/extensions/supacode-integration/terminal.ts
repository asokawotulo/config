import { openSync, writeSync, closeSync } from "node:fs";

let lastWarnedAt = 0;
const WARN_INTERVAL_MS = 60_000;

/**
 * Writes an OSC sequence to the controlling terminal. The extension runs
 * inside the Pi TUI process, which owns the terminal, so /dev/tty resolves.
 * Best-effort, but a systematically-failing tty is logged at most once per
 * `WARN_INTERVAL_MS` to stderr so a broken write path is distinguishable
 * from "not a Supacode surface" without spamming the log on every emit.
 */
export function writeToTerminal(sequence: string): void {
  try {
    const fd = openSync("/dev/tty", "w");
    try {
      // Loop until the full byte length lands: a short write would leave a
      // half OSC 3008 with no ST (ESC\) and corrupt the terminal parser.
      const bytes = Buffer.from(sequence, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        try {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (written <= 0) {
            throw new Error(`short write (${offset}/${bytes.length} bytes)`);
          }
          offset += written;
        } catch (writeErr) {
          // Retry interrupted / non-blocking transient errors; abort on anything else.
          const code = (writeErr as NodeJS.ErrnoException).code;
          if (code === "EINTR" || code === "EAGAIN") continue;
          throw writeErr;
        }
      }
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    const now = Date.now();
    if (now - lastWarnedAt > WARN_INTERVAL_MS) {
      lastWarnedAt = now;
      const e = err as NodeJS.ErrnoException;
      const code = e.code ?? "";
      const errno = e.errno ?? "";
      const message = e.message ?? String(err);
      process.stderr.write(
        `supacode: OSC emit failed: code=${code} errno=${errno} message=${message}\n`,
      );
    }
  }
}

