// Kleine Icons für die beiden Abgleiche in der Werkzeugleiste — was abgeglichen
// wird, als Mini-Diagramm: der **Ablauf** (BPMN: Start → Aufgabe → Ende) bzw.
// die **Datenstruktur** (UML: Klasse mit Feldern, verbunden mit einer zweiten).
// Der kleine Kreispfeil unten rechts sagt «abgleichen». In Strichfarbe
// (`currentColor`), damit sie hell wie dunkel zur Schaltfläche passen.

interface IconProps { size?: number; className?: string }

/** Der Kreispfeil des Abgleichs — unten rechts, mit Hintergrund-Aussparung */
function SyncBadge() {
  return (
    <g>
      <circle cx="17" cy="13" r="3.6" fill="var(--sync-icon-bg, transparent)" stroke="none" />
      <path d="M14.6 12.4a2.5 2.5 0 0 1 4.4-1.3" />
      <path d="M19.4 13.6a2.5 2.5 0 0 1-4.4 1.3" />
      <path d="M19.2 9.9v1.4h-1.4" />
      <path d="M14.8 16.1v-1.4h1.4" />
    </g>
  );
}

/** Mit BPMN abgleichen — der Ablauf */
export function SyncProcessIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size * 1.25} height={size} viewBox="0 0 20 16" fill="none" stroke="currentColor"
      strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* Start → Aufgabe → Ende — ohne Pfeilspitzen, die wären bei 14 px nur Pixel */}
      <circle cx="2.1" cy="5.4" r="1.6" />
      <path d="M3.7 5.4h2" />
      <rect x="5.7" y="2.4" width="5.6" height="6" rx="1.3" />
      <path d="M11.3 5.4h2" />
      <circle cx="14.9" cy="5.4" r="1.6" strokeWidth="1.8" />
      <SyncBadge />
    </svg>
  );
}

/** Mit Domain abgleichen — die Datenstruktur */
export function SyncDataIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size * 1.25} height={size} viewBox="0 0 20 16" fill="none" stroke="currentColor"
      strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* Klasse: Name, darunter zwei Felder */}
      <rect x="1" y="1" width="7.5" height="9.5" rx="0.8" />
      <path d="M1 3.8h7.5" />
      <path d="M2.6 6h4.3M2.6 8.2h3.2" />
      {/* Verbindung zu einer zweiten, kleineren Klasse */}
      <path d="M8.5 5.2h2.4" />
      <rect x="10.9" y="2.6" width="5" height="5.2" rx="0.8" />
      <path d="M10.9 4.5h5" />
      <SyncBadge />
    </svg>
  );
}
