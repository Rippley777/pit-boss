import type { ReactNode } from "react";
// Only SGR foreground colors are rendered. OSC links, cursor movement and controls
// are discarded; output is always React text, never HTML or executable markup.
export function terminalText(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[^0-9;m]/g, "")
    .replace(/[^\n]*\r(?!\n)/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, "");
}
export function plainText(raw: string): string {
  return terminalText(raw)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b/g, "");
}
export function coloredLine(line: string): ReactNode[] {
  const pieces = line.split(/(\x1b\[[0-9;]*m)/g);
  let color = "";
  return pieces.map((piece, i) => {
    if (piece.startsWith("\x1b[")) {
      for (const code of piece.slice(2, -1).split(";").map(Number)) {
        if (code === 0 || code === 39) color = "";
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
          color = `ansi-${code % 10}`;
      }
      return null;
    }
    return (
      <span className={color} key={i}>
        {piece.replace(/\x1b/g, "")}
      </span>
    );
  });
}
