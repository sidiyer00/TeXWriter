// Menus: the title-bar menu bar, dropdown/context menus with submenus and keyboard support.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setState, useStore, type MenuItem } from '../store';
import { editMenu, fileMenu, helpMenu, insertMenu, runMenu, viewMenu } from '../commands';
import { Check, Right } from './Icons';

/** Viewport position for a floating menu; `flipX` is where its right edge goes if it would overflow (submenus). */
export interface Anchor { x: number; y: number; alignRight?: boolean; flipX?: number }

/**
 * A popup rendered into document.body at fixed viewport coordinates, so no ancestor's
 * overflow (title bar, scrolling parent menu) can clip it. Nudged to stay on screen.
 */
export function Floating({ at, children, className = 'menu', elRef, ...rest }: { at: Anchor; children: React.ReactNode; className?: string; elRef?: React.RefObject<HTMLDivElement | null> } & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const own = useRef<HTMLDivElement>(null);
  const ref = elRef ?? own;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let left = at.alignRight ? at.x - w : at.x;
    if (left + w > W - 4) left = at.flipX !== undefined ? at.flipX - w : W - w - 4;
    setPos({ left: Math.max(4, left), top: Math.max(4, Math.min(at.y, H - h - 4)) });
  }, [at.x, at.y, at.alignRight, at.flipX]);
  return createPortal(
    <div {...rest} className={className} ref={ref} style={{ position: 'fixed', zIndex: 70, left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? 'visible' : 'hidden' }}>{children}</div>,
    document.body,
  );
}

/** Anchor just below an element (menu bar buttons, toolbar dropdowns). */
export const below = (el: HTMLElement, alignRight = false): Anchor => {
  const r = el.getBoundingClientRect();
  return { x: alignRight ? r.right : r.left, y: r.bottom + 4, alignRight };
};

export function MenuList({ items, onDone, onBack, at, autoFocus = true, className = '' }: { items: MenuItem[]; onDone: () => void; onBack?: () => void; at: Anchor; autoFocus?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState(-1);
  const [sub, setSub] = useState<{ i: number; at: Anchor } | null>(null);
  const enabled = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, []);
  // submenus open on click (or Enter / ArrowRight), never on hover
  const openSub = (i: number, toggle: boolean) => {
    if (toggle && sub?.i === i) { setSub(null); return; }
    const r = (ref.current?.children[i] as HTMLElement | undefined)?.getBoundingClientRect();
    if (r) setSub({ i, at: { x: r.right + 2, y: r.top - 5, flipX: r.left - 2 } });
  };
  const run = (it: MenuItem, i: number, toggle = true) => {
    if (it.disabled || it.separator) return;
    if (it.submenu) { setHi(i); openSub(i, toggle); return; }
    onDone();
    it.run?.();
  };
  return (
    <>
      <Floating at={at} elRef={ref} className={`menu ${className}`} role="menu" tabIndex={-1}
        onKeyDown={(e) => {
          const k = e.key;
          if (k === 'ArrowDown') setHi((h) => enabled[(enabled.indexOf(h) + 1) % enabled.length] ?? -1);
          else if (k === 'ArrowUp') setHi((h) => enabled[(enabled.indexOf(h) - 1 + enabled.length) % enabled.length] ?? -1);
          else if (k === 'Enter' && hi >= 0) run(items[hi], hi, false);
          else if (k === 'ArrowRight' && hi >= 0 && items[hi].submenu) openSub(hi, false);
          else if (k === 'Escape' || (k === 'ArrowLeft' && onBack)) (onBack ?? onDone)();
          else return;
          // handled keys must not also reach a parent menu (React events bubble through portals)
          e.preventDefault(); e.stopPropagation();
        }}>
        {items.map((it, i) => it.separator
          ? <div key={i} className="msep" role="separator" />
          : (
            <div key={i} onMouseEnter={() => setHi(i)}>
              <button role="menuitem" className={`mitem ${hi === i || sub?.i === i ? 'hi' : ''} ${it.danger ? 'danger' : ''}`} disabled={it.disabled} aria-haspopup={it.submenu ? 'menu' : undefined} aria-expanded={it.submenu ? sub?.i === i : undefined}
                onMouseDown={(e) => e.preventDefault()} onClick={() => run(it, i)}>
                <span className={`mcheck ${it.icon ? 'micon' : ''} ${it.icon && it.checked ? 'on' : ''}`}>{it.swatch ? <i className="mswatch" style={{ background: it.swatch }} /> : it.icon ? it.icon : it.checked ? <Check size={12} strokeWidth={2.6} /> : null}</span>
                <span className="grow">{it.label}</span>
                {it.shortcut && <span className="mkey">{it.shortcut}</span>}
                {it.submenu && <Right size={12} />}
              </button>
            </div>
          ))}
      </Floating>
      {sub && items[sub.i]?.submenu && <MenuList items={items[sub.i].submenu!} onDone={onDone} onBack={() => { setSub(null); ref.current?.focus(); }} at={sub.at} className={className} />}
    </>
  );
}

export function ContextMenu() {
  const cm = useStore((s) => s.contextMenu);
  const spell = useStore((s) => s.spell);
  useEffect(() => {
    if (!cm) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.menu')) setState({ contextMenu: null }); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setState({ contextMenu: null }); };
    const blur = () => setState({ contextMenu: null });
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', k);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', k); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, [cm]);
  if (!cm) return null;
  let items = cm.items;
  // spelling suggestions arrive from the main process right after the right-click
  if (spell && spell.word && Date.now() - spell.at < 3000 && items.some((i) => i.label === 'Cut')) {
    const sug: MenuItem[] = spell.suggestions.slice(0, 5).map((w) => ({ label: w, run: () => void window.texwriter.replaceMisspelling(w) }));
    items = [
      ...(sug.length ? sug : [{ label: 'No spelling suggestions', disabled: true }]),
      { label: `Add “${spell.word}” to dictionary`, run: () => void window.texwriter.addToDictionary(spell.word) },
      { separator: true },
      ...items,
    ];
  }
  return (
    <MenuList items={items} onDone={() => setState({ contextMenu: null, spell: null })} at={{ x: cm.x, y: cm.y }} className="ctx" />
  );
}

const MENUS: { label: string; items: () => MenuItem[] }[] = [
  { label: 'File', items: () => fileMenu() },
  { label: 'Edit', items: () => editMenu() },
  { label: 'Insert', items: () => insertMenu() },
  { label: 'View', items: () => viewMenu() },
  { label: 'Run', items: () => runMenu() },
  { label: 'Help', items: () => helpMenu() },
];

export function MenuBar() {
  const [open, setOpen] = useState<{ i: number; at: Anchor } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const show = (i: number, el: HTMLElement) => setOpen({ i, at: below(el) });
  useEffect(() => {
    if (open === null) return;
    const h = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!ref.current?.contains(t) && !t.closest?.('.menu')) setOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menubar no-drag" ref={ref} role="menubar" aria-label="Application menu">
      {MENUS.map((m, i) => (
        <div key={m.label}>
          <button role="menuitem" className={`mbtn ${open?.i === i ? 'open' : ''}`} aria-haspopup="menu" aria-expanded={open?.i === i}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => (open?.i === i ? setOpen(null) : show(i, e.currentTarget))} onMouseEnter={(e) => { if (open && open.i !== i) show(i, e.currentTarget); }}>{m.label}</button>
          {open?.i === i && <MenuList items={m.items()} onDone={() => setOpen(null)} at={open.at} />}
        </div>
      ))}
    </div>
  );
}
