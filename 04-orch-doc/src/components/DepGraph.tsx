// Project dependency graph as plain SVG — no mermaid, no CDN.
//
// Layout: one band per project group; bands are ordered by how "high" their
// projects sit in the dependency chain (things nobody depends on come first).
// Inside a band, nodes are ordered by the centre of their dependents, which
// keeps most edges short. Hover highlights a project's in- and outgoing edges;
// click opens its dependency page.
import { useMemo, useState } from 'react';
import { href } from '../router';
import type { CompanyDocs } from '../types';
import { groupColor } from '../ui';

const NODE_H = 28, PAD_X = 14, GAP_X = 18, BAND_PAD = 36, BAND_GAP = 54, LABEL_W = 0;

interface Node { name: string; x: number; y: number; w: number; color: string; group: string; version?: string }

function textWidth(s: string) { return s.length * 6.6 + PAD_X * 2; }

export default function DepGraph({ docs, isDark, focus, width = 960, onSelect }: {
  docs: CompanyDocs; isDark: boolean; focus?: string; width?: number; onSelect?: (project: string) => void;
}) {
  const [hover, setHover] = useState<string | undefined>();
  const active = hover ?? focus;

  const { nodes, edges, bands, height } = useMemo(() => {
    // direct edges from the generator; fall back to the (transitive) dependency pages
    const edges = docs.graph?.length
      ? docs.graph.filter(e => docs.projects.some(p => p.name === e.from) && docs.projects.some(p => p.name === e.to))
      : docs.dependencies.flatMap(d => d.dependsOn
        .filter(u => docs.projects.some(p => p.name === u.project))
        .map(u => ({ from: d.project, to: u.project })));
    const names = docs.projects.map(p => p.name);
    const dependents = new Map<string, string[]>();
    edges.forEach(e => dependents.set(e.to, [...(dependents.get(e.to) ?? []), e.from]));
    // rank = longest chain of dependents above; memoised with cycle guard
    const rank = new Map<string, number>();
    const rankOf = (n: string, seen = new Set<string>()): number => {
      if (rank.has(n)) return rank.get(n)!;
      if (seen.has(n)) return 0;
      seen.add(n);
      const r = 1 + Math.max(-1, ...(dependents.get(n) ?? []).map(d => rankOf(d, seen)));
      rank.set(n, r);
      return r;
    };
    names.forEach(n => rankOf(n));

    const groups = docs.groups.map(g => g.name).filter(g => docs.projects.some(p => p.group === g));
    const meanRank = (g: string) => {
      const rs = docs.projects.filter(p => p.group === g).map(p => rank.get(p.name) ?? 0);
      return rs.reduce((a, b) => a + b, 0) / Math.max(1, rs.length);
    };
    const ordered = [...groups].sort((a, b) => meanRank(a) - meanRank(b));

    const nodes: Node[] = [];
    const bands: { name: string; y: number; h: number; color: string }[] = [];
    let y = BAND_PAD;
    const posX = new Map<string, number>();
    for (const g of ordered) {
      let members = docs.projects.filter(p => p.group === g);
      // barycenter ordering by the dependents already placed
      members = members.map(p => {
        const ds = (dependents.get(p.name) ?? []).map(d => posX.get(d)).filter((v): v is number => v !== undefined);
        return { p, key: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : Number.POSITIVE_INFINITY };
      }).sort((a, b) => a.key - b.key || a.p.name.localeCompare(b.p.name)).map(m => m.p);
      const widths = members.map(p => textWidth(p.name));
      const total = widths.reduce((a, b) => a + b, 0) + GAP_X * (members.length - 1);
      let x = Math.max(LABEL_W + 20, (width - total) / 2);
      members.forEach((p, i) => {
        nodes.push({ name: p.name, x, y: y + 22, w: widths[i], color: p.color, group: g, version: p.version });
        posX.set(p.name, x + widths[i] / 2);
        x += widths[i] + GAP_X;
      });
      const gh = NODE_H + 22 + 14;
      bands.push({ name: g, y, h: gh, color: docs.groups.find(x => x.name === g)?.color ?? 'gray' });
      y += gh + BAND_GAP;
    }
    return { nodes, edges, bands, height: y - BAND_GAP + 10 };
  }, [docs, width]);

  const byName = new Map(nodes.map(n => [n.name, n]));
  const related = new Set<string>();
  if (active) {
    related.add(active);
    edges.forEach(e => { if (e.from === active) related.add(e.to); if (e.to === active) related.add(e.from); });
  }
  const stroke = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
  const strokeHi = isDark ? '#6ccbe6' : '#0f6e8c';
  const textColor = isDark ? '#e8e8e8' : '#1a1a1a';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, display: 'block', fontFamily: 'inherit' }}
      onMouseLeave={() => setHover(undefined)}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
        </marker>
        <marker id="arrHi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={strokeHi} />
        </marker>
      </defs>
      {/* group bands */}
      {bands.map(b => (
        <g key={b.name}>
          <rect x={8} y={b.y} width={width - 16} height={b.h} rx={8}
            fill={isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)'}
            stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} />
          <text x={20} y={b.y + 14} fontSize={9} fill={groupColor(b.color, isDark)} opacity={0.8} letterSpacing={1.5} style={{ textTransform: 'uppercase' }}>
            {b.name.toUpperCase()}
          </text>
        </g>
      ))}
      {/* edges */}
      {edges.map((e, i) => {
        const a = byName.get(e.from), b = byName.get(e.to);
        if (!a || !b) return null;
        const hi = !!active && (e.from === active || e.to === active);
        const dim = !!active && !hi;
        const down = b.y > a.y;
        const x1 = a.x + a.w / 2, y1 = down ? a.y + NODE_H : a.y;
        const x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + NODE_H;
        const dy = (y2 - y1) / 2;
        const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke={hi ? strokeHi : stroke} strokeWidth={hi ? 1.8 : 1}
          opacity={dim ? 0.25 : 1} markerEnd={`url(#${hi ? 'arrHi' : 'arr'})`} />;
      })}
      {/* nodes */}
      {nodes.map(n => {
        const dim = !!active && !related.has(n.name);
        const isFocus = n.name === active;
        const fill = n.color === 'white' ? (isDark ? '#16171a' : '#ffffff')
          : isDark ? `color-mix(in srgb, ${n.color} 22%, #16171a)` : n.color;
        return (
          <a key={n.name} href={href.dependencies(docs.company, n.name)}
            onClick={onSelect ? (ev) => { ev.preventDefault(); onSelect(n.name); } : undefined}
            onMouseEnter={() => setHover(n.name)} style={{ cursor: 'pointer' }}>
            <g opacity={dim ? 0.35 : 1}>
              <rect x={n.x} y={n.y} width={n.w} height={NODE_H} rx={6} fill={fill}
                stroke={isFocus ? strokeHi : isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)'} strokeWidth={isFocus ? 2 : 1} />
              <text x={n.x + n.w / 2} y={n.y + NODE_H / 2 + 3.5} textAnchor="middle" fontSize={11} fontWeight={600}
                fill={isDark && n.color !== 'white' ? '#e8e8e8' : n.color === 'white' ? textColor : '#1a1a1a'}>
                {n.name}
              </text>
            </g>
          </a>
        );
      })}
    </svg>
  );
}
