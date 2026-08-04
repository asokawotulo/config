import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarRenderer } from "./layout.ts";
import type { SidebarMetadata } from "./metadata.ts";

export class SidebarComponent implements SidebarRenderer {
  constructor(
    private readonly getMetadata: () => SidebarMetadata,
    private readonly getTheme: () => Theme,
  ) {}

  render(width: number, height: number): string[] {
    const metadata = this.getMetadata();
    const theme = this.getTheme();
    const contentWidth = Math.max(1, width - 3);
    const rows: string[] = [];

    const empty = () => rows.push("");
    const heading = (text: string) =>
      rows.push(theme.bold(theme.fg("accent", text)));
    const value = (text: string) =>
      rows.push(theme.fg("muted", truncateToWidth(text, contentWidth, "…")));

    empty();
    heading("Directory");
    value(metadata.directory);
    value(metadata.branchWorktree);
    empty();
    heading("Session");
    value(metadata.sessionName);
    empty();
    heading("Context");
    value(`${metadata.contextTokens}/${metadata.contextWindow}`);
    value(metadata.contextPercent);
    value(`$${metadata.cost.toFixed(3)}`);
    empty();
    heading("Model");
    value(metadata.modelName);
    value(metadata.thinkingLevel);

    const visibleRows = rows.slice(0, height);
    while (visibleRows.length < height) visibleRows.push("");

    return visibleRows.map((content) => {
      const clipped = truncateToWidth(content, contentWidth, "");
      const padded = ` ${clipped}${" ".repeat(
        Math.max(0, contentWidth - visibleWidth(clipped)),
      )} `;
      return (
        theme.fg("borderMuted", "│") +
        theme.bg("customMessageBg", truncateToWidth(padded, width - 1, ""))
      );
    });
  }
}
