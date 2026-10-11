// Menus: the title-bar menu bar, dropdown/context menus with submenus and keyboard support.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setState, useStore, type MenuItem } from '../store';
import { editMenu, fileMenu, helpMenu, insertMenu, runMenu, viewMenu } from '../commands';
import { Check, Right } from './Icons';

export function MenuList({ items, onDone, style, autoFocus = true }: { items: MenuItem[]; onDone: () => void; style?: React.CSSProperties; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState(-1);
  const [sub, setSub] = useState<number | null>(null);
  const [pos, setPos] = useState<React.CSSProperties>(style ?? {});
  const enabled = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
  useLayoutEffect(() => {
    // keep the menu on screen
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next: React.CSSProperties = { ...style };
    if (r.right > window.innerWidth - 4) next.left = Math.max(4, (Number(style?.left) || 0) - (r.right - window.innerWidth) - 8);
    if (r.bottom > window.innerHeight - 4) next.top = Math.max(4, (Number(style?.top) || 0) - (r.bottom - window.innerHeight) - 8);
    setPos(next);
  }, [style?.left, style?.top]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, []);
  const run = (it: MenuItem, i: number) => {
    if (it.disabled || it.separator) return;
    if (it.submenu) { setSub(i); return; }
    onDone();
    it.run?.();
  };
  return (
    <div className="menu" role="menu" ref={ref} tabIndex={-1} style={pos}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => enabled[(enabled.indexOf(h) + 1) % enabled.length] ?? -1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => enabled[(enabled.indexOf(h) - 1 + enabled.length) % enabled.length] ?? -1); }
        else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); run(items[hi], hi); }
        else if (e.key === 'ArrowRight' && hi >= 0 && items[hi].submenu) { e.preventDefault(); setSub(hi); }
        else if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onDone(); }
      }}>
      {items.map((it, i) => it.separator
        ? <div key={i} className="msep" role="separator" />
        : (
          <div key={i} style={{ position: 'relative' }} onMouseEnter={() => { setHi(i); setSub(it.submenu ? i : null); }}>
            <button role="menuitem" className={`mitem ${hi === i ? 'hi' : ''} ${it.danger ? 'danger' : ''}`} disabled={it.disabled} aria-haspopup={it.submenu ? 'menu' : undefined}
              onMouseDown={(e) => e.preventDefault()} onClick={() => run(it, i)}>
              <span className="mcheck">{it.checked ? <Check size={12} strokeWidth={2.6} /> : null}</span>
              <span className="grow">{it.label}</span>
              {it.shortcut && <span className="mkey">{it.shortcut}</span>}
              {it.submenu && <Right size={12} />}
            </button>
            {sub === i && it.submenu && <MenuList items={it.submenu} onDone={onDone} autoFocus={false} style={{ left: '100%', top: -5 }} />}
          </div>
        ))}
    </div>
  );
}

export function ContextMenu() {
  const cm = useStore((s) => s.contextMenu);
  const spell = useStore((s) => s.spell);
  useEffect(() => {
    if (!cm) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.ctx-root')) setState({ contextMenu: null }); };
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
    const sug: MenuItem[] = spell.suggestions.slice(0, 5).map((w) => ({ label: w, run: () => void window.quire.replaceMisspelling(w) }));
    items = [
      ...(sug.length ? sug : [{ label: 'No spelling suggestions', disabled: true }]),
      { label: `Add “${spell.word}” to dictionary`, run: () => void window.quire.addToDictionary(spell.word) },
      { separator: true },
      ...items,
    ];
  }
  return (
    <div className="ctx-root" style={{ position: 'fixed', left: 0, top: 0, zIndex: 80 }}>
      <MenuList items={items} onDone={() => setState({ contextMenu: null, spell: null })} style={{ left: cm.x, top: cm.y, position: 'fixed' }} />
    </div>
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
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menubar no-drag" ref={ref} role="menubar" aria-label="Application menu">
      {MENUS.map((m, i) => (
        <div key={m.label} style={{ position: 'relative' }}>
          <button role="menuitem" className={`mbtn ${open === i ? 'open' : ''}`} aria-haspopup="menu" aria-expanded={open === i}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => { if (open !== null) setOpen(i); }}>{m.label}</button>
          {open === i && <MenuList items={m.items()} onDone={() => setOpen(null)} style={{ left: 0, top: 30 }} />}
        </div>
      ))}
    </div>
  );
}
