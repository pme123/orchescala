// One line per event, with time and level - no content of a request, never a key.
export type Log = { info(text: string): void; warn(text: string): void; error(text: string): void };

const line = (level: string, text: string) => `${new Date().toISOString()} ${level} ${text}`;

export const consoleLog: Log = {
  info: (text) => console.log(line('INFO', text)),
  warn: (text) => console.warn(line('WARN', text)),
  error: (text) => console.error(line('ERROR', text)),
};

/** For the tests: the lines it got. */
export function memoryLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (text) => lines.push(`INFO ${text}`),
    warn: (text) => lines.push(`WARN ${text}`),
    error: (text) => lines.push(`ERROR ${text}`),
  };
}
