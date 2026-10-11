// Keyboard modifiers. Quire's shortcuts use Ctrl on Windows/Linux and Cmd on macOS. The
// Windows key belongs to the OS (Win+S search, Win+Shift+S snipping, Win+1… taskbar,
// Win+Up maximize), so a combination that includes it is never treated as a shortcut.

const IS_MAC = typeof window !== 'undefined' && window.quire?.platform === 'darwin';

type Mods = { ctrlKey: boolean; metaKey: boolean };

/** The platform's command modifier is held (Ctrl, or Cmd on macOS) — and not the Windows key. */
export function isMod(e: Mods): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** A key combination that belongs to the operating system rather than to Quire. */
export function isSystemCombo(e: KeyboardEvent): boolean {
  if (!IS_MAC && e.metaKey) return true; // Windows key held
  // AltGr reaches the page as Ctrl+Alt on Windows; it types characters (€, @, {, …)
  return e.getModifierState?.('AltGraph') ?? false;
}
