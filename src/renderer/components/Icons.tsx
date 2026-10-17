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
