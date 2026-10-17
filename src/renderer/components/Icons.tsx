// Stroke icons used across the UI. Decorative by default (aria-hidden).
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, props: P) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...props,
});

export const Check = ({ size = 12, ...p }: P) => <svg {...base(size, p)}><path d="M20 6 9 17l-5-5" /></svg>;
export const X = ({ size = 12, ...p }: P) => <svg {...base(size, p)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const Warn = ({ size = 12, ...p }: P) => <svg {...base(size, p)}><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v4M12 17.5v.5" /></svg>;
export const Minus = ({ size = 12, ...p }: P) => <svg {...base(size, p)}><path d="M5 12h14" /></svg>;
/** Paint bucket (cell fill). */
export const Bucket = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11Z" /><path d="m5 2 5 5" /><path d="M2 13h15" /><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" /></svg>;
export const Down = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><path d="m6 9 6 6 6-6" /></svg>;
export const Right = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><path d="m9 6 6 6-6 6" /></svg>;
export const Left = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><path d="m15 6-6 6 6 6" /></svg>;
export const Back = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const Undo = ({ size = 16, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>;
export const Redo = ({ size = 16, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>;
export const Play = ({ size = 12, ...p }: P) => <svg {...base(size, { fill: 'currentColor', stroke: 'none', ...p })}><path d="M7 4v16l13-8z" /></svg>;
export const Refresh = ({ size = 13, ...p }: P) => <svg {...base(size, p)}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;
export const Link = ({ size = 12, ...p }: P) => <svg {...base(size, p)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>;
export const Download = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>;
export const Search = ({ size = 14, ...p }: P) => <svg {...base(size, p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const Panel = ({ size = 15, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>;
export const Lock = ({ size = 11, ...p }: P) => <svg {...base(size, p)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
export const List = ({ size = 15, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></svg>;
/** Numbered list: real digits so it reads as "1, 2" next to the bulleted list's dots. */
export const OList = ({ size = 16, ...p }: P) => (
  <svg {...base(size, { strokeWidth: 1.8, ...p })}>
    <path d="M12 7.5h9M12 16.5h9" />
    <text x="5" y="11.4" fontSize="11" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" style={{ fontFamily: 'var(--ui), sans-serif' }}>1</text>
    <text x="5" y="20.4" fontSize="11" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" style={{ fontFamily: 'var(--ui), sans-serif' }}>2</text>
  </svg>
);
export const Trash = ({ size = 13, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const Menu = ({ size = 16, ...p }: P) => <svg {...base(size, { strokeWidth: 1.9, ...p })}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
export const Outdent = ({ size = 15, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M11 6h9M11 12h9M4 18h16" /><path d="m7 6-3 3 3 3" /></svg>;
export const Indent = ({ size = 15, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M11 6h9M11 12h9M4 18h16" /><path d="m4 6 3 3-3 3" /></svg>;
export const Folder = ({ size = 16, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M3 7h7l2 2h9v10H3z" /></svg>;
export const Doc = ({ size = 16, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><path d="M5 4h11l3 3v13H5z" /><path d="M9 10h6M9 14h6" /></svg>;
export const Gear = ({ size = 16, ...p }: P) => <svg {...base(size, { strokeWidth: 1.8, ...p })}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;

export function StatusIcon({ status, size = 11 }: { status: string; size?: number }) {
  if (status === 'passed') return <Check size={size} strokeWidth={2.6} />;
  if (status === 'failed') return <X size={size} strokeWidth={2.6} />;
  if (status === 'warning') return <Warn size={size} strokeWidth={2.4} />;
  if (status === 'running') return <Refresh size={size} strokeWidth={2.4} />;
  return <Minus size={size} strokeWidth={2.6} />;
}

const LABEL: Record<string, string> = { passed: 'Passed', failed: 'Failed', warning: 'Warning', skipped: 'Skipped', running: 'Running' };
const CLS: Record<string, string> = { passed: 'pass', failed: 'fail', warning: 'warn', skipped: 'skip', running: 'run' };

export function StatusPill({ status, small, label }: { status: string; small?: boolean; label?: string }) {
  return <span className={`st ${CLS[status] ?? 'skip'} ${small ? 'st-sm' : ''}`}><StatusIcon status={status} />{label ?? LABEL[status] ?? status}</span>;
}

// table toolbar glyphs: a cell block plus the action (+ add, x delete, arrows for merge/split)
const TI = { strokeWidth: 1.7 };
export const RowAbove = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="12" width="18" height="9" rx="1.5" /><path d="M12 12v9M12 2.5v6M9 5.5h6" /></svg>;
export const RowBelow = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="3" width="18" height="9" rx="1.5" /><path d="M12 3v9M12 15.5v6M9 18.5h6" /></svg>;
export const RowDelete = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="7" width="18" height="10" rx="1.5" /><path d="m9.5 9.5 5 5M14.5 9.5l-5 5" /></svg>;
export const ColLeft = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="12" y="3" width="9" height="18" rx="1.5" /><path d="M12 12h9M2.5 12h6M5.5 9v6" /></svg>;
export const ColRight = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="3" width="9" height="18" rx="1.5" /><path d="M3 12h9M15.5 12h6M18.5 9v6" /></svg>;
export const ColDelete = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="7" y="3" width="10" height="18" rx="1.5" /><path d="m9.5 9.5 5 5M14.5 9.5l-5 5" /></svg>;
export const CellsMerge = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M5.5 12h4M8 9.5l2 2.5-2 2.5M18.5 12h-4M16 9.5 14 12l2 2.5" /></svg>;
export const CellSplit = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14M9.5 12h-4M7.5 9.5 5.5 12l2 2.5M14.5 12h4M16.5 9.5l2 2.5-2 2.5" /></svg>;
export const AlignL = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></svg>;
export const AlignC = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></svg>;
export const AlignR = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></svg>;
export const HeaderCells = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9.5h18M9 9.5V20M15 9.5V20" /><rect x="3" y="4" width="18" height="5.5" rx="1.5" fill="currentColor" stroke="none" /></svg>;
export const HeaderLevel = ({ size = 18, ...p }: P) => <svg {...base(size, { ...TI, ...p })}><rect x="3" y="9" width="18" height="12" rx="1.5" /><path d="M3 14h18M12 14v7" /><rect x="3" y="9" width="18" height="5" rx="1.5" fill="currentColor" stroke="none" /><path d="M12 1.5v6M9 4.5h6" /></svg>;

// insert toolbar glyphs
const II = { strokeWidth: 1.8 };
export const Sigma = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><path d="M18 6.5V4H6l6.5 8L6 20h12v-2.5" /></svg>;
export const TableIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.5h18M3 14.75h18M9.5 9.5V20M15 9.5V20" /></svg>;
export const ImageIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m21 15.5-4.5-4.5L7 20" /></svg>;
export const CommentIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><path d="M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /><path d="M12 7.5v6M9 10.5h6" /></svg>;
export const FootnoteIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><path d="M3 9h10M3 14h15M3 19h9" /><path d="m16.5 4.5 2-1.5v6" /></svg>;
export const CodeBlockIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 9.5-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" /></svg>;
export const CalloutIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16" /><path d="M11 9h6M11 13h6M11 17h3" /></svg>;
export const PageBreakIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><path d="M6 3v5h12V3M6 21v-5h12v5" /><path d="M2.5 12h2.5M8 12h2.5M13.5 12h2.5M19 12h2.5" /></svg>;
export const TocIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><path d="M3 5h11M7 10h11M7 15h11M3 20h11" /><path d="M19 5h2M21 10h0M21 15h0M19 20h2" strokeWidth={2.4} /></svg>;
export const ListsIcon = ({ size = 17, ...p }: P) => <svg {...base(size, { ...II, ...p })}><rect x="3" y="4" width="6" height="5" rx="1" /><path d="M3 6.5h6M6 4v5" /><rect x="3" y="14" width="6" height="5" rx="1" /><path d="m3.5 18.5 2-2 3 2.5" /><path d="M12 6.5h9M12 16.5h9" /></svg>;
