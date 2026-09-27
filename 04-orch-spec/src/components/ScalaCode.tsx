// Scala-Vorschau mit leichter Einfärbung — zum Lesen, nicht zum Bearbeiten.
//
// Kein Parser, ein Zeilen-Tokenizer: Kommentare und `@description` gedämpft
// und kursiv, Schlüsselwörter gedämpft, Typnamen (Grossbuchstabe) in der
// Klassenfarbe, Zeichenketten in Bernstein. Alles andere bleibt Text.
import type { ReactNode } from 'react';

const KEYWORDS = new Set(['case', 'class', 'enum', 'object', 'given', 'lazy', 'val', 'def', 'type', 'end', 'extends', 'import', 'package', 'derives', 'new']);
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(@\w+)|(`[^`]+`)|([A-Za-z_][\w]*)|(\s+)|(.)/g;

export default function ScalaCode({ code, isDark, className }: { code: string; isDark: boolean; className?: string }) {
  const kw = isDark ? 'text-white/45' : 'text-black/45';
  const cm = isDark ? 'text-white/35 italic' : 'text-black/35 italic';
  const ty = isDark ? 'text-sky-300' : 'text-sky-800';
  const st = isDark ? 'text-amber-300/90' : 'text-amber-700';
  const an = isDark ? 'text-violet-300/80 italic' : 'text-violet-700/80 italic';
  const lines = code.split('\n').map((line, i) => {
    const parts: ReactNode[] = [];
    let k = 0;
    for (const m of line.matchAll(TOKEN)) {
      const [text, comment, string, annotation, backticked, word] = m;
      const key = `${i}-${k++}`;
      if (comment) parts.push(<span key={key} className={cm}>{text}</span>);
      else if (string) parts.push(<span key={key} className={st}>{text}</span>);
      else if (annotation) parts.push(<span key={key} className={an}>{text}</span>);
      else if (backticked) parts.push(<span key={key} className={ty}>{text}</span>);
      else if (word && KEYWORDS.has(word)) parts.push(<span key={key} className={kw}>{text}</span>);
      else if (word && /^[A-Z]/.test(word)) parts.push(<span key={key} className={ty}>{text}</span>);
      else parts.push(text);
    }
    return <div key={i}>{parts.length ? parts : '\u00a0'}</div>;
  });
  return <pre className={className}>{lines}</pre>;
}
