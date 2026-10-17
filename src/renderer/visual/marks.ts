// Text colour and highlight marks, serialized as \textcolor and \texwriterhl.
import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: { setTextColor: (color: string) => ReturnType; unsetTextColor: () => ReturnType };
    texwriterHighlight: { setHighlightColor: (color: string) => ReturnType; unsetHighlightColor: () => ReturnType };
  }
}

export const cssColor = (c: string | null | undefined) => (!c ? '' : /^[0-9A-Fa-f]{6}$/.test(c) ? `#${c}` : c);

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() { return { color: { default: null } }; },
  parseHTML() {
    return [{ tag: 'span[data-color]', getAttrs: (el) => ({ color: (el as HTMLElement).dataset.color }) }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-color': mark.attrs.color, style: `color:${cssColor(mark.attrs.color)}` }), 0];
  },
  addCommands() {
    return {
      setTextColor: (color: string) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

export const TeXWriterHighlight = Mark.create({
  name: 'highlight',
  addAttributes() { return { color: { default: 'FFF176' } }; },
  parseHTML() {
    return [{ tag: 'mark', getAttrs: (el) => ({ color: (el as HTMLElement).dataset.color ?? 'FFF176' }) }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { 'data-color': mark.attrs.color, style: `background:${cssColor(mark.attrs.color)}` }), 0];
  },
  addCommands() {
    return {
      setHighlightColor: (color: string) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetHighlightColor: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => (this.editor.isActive(this.name) ? this.editor.commands.unsetHighlightColor() : this.editor.commands.setHighlightColor('FFF176')) };
  },
});

export const TEXT_COLORS: { name: string; hex: string }[] = [
  { name: 'Ink', hex: '1A1917' }, { name: 'Grey', hex: '68635B' }, { name: 'Blue', hex: '1E4290' }, { name: 'Teal', hex: '0F6E6E' },
  { name: 'Green', hex: '23623E' }, { name: 'Amber', hex: '8A5300' }, { name: 'Red', hex: '9C2E1A' }, { name: 'Purple', hex: '5B3C8C' },
];

export const HIGHLIGHTS: { name: string; hex: string }[] = [
  { name: 'Yellow', hex: 'FFF176' }, { name: 'Green', hex: 'C8E6C9' }, { name: 'Blue', hex: 'BBDEFB' },
  { name: 'Pink', hex: 'F8BBD0' }, { name: 'Orange', hex: 'FFE0B2' }, { name: 'Grey', hex: 'E0DDD7' },
];

/** Table cell fills: one column per hue, light to strong (light enough for black text). */
export const CELL_FILL_HUES = ['Grey', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple'] as const;
export const CELL_FILLS: { name: string; hex: string }[][] = [
  [{ name: 'Light grey', hex: 'F2F0EC' }, { name: 'Light red', hex: 'FBE4E0' }, { name: 'Light orange', hex: 'FDEBD8' }, { name: 'Light yellow', hex: 'FFF6CC' }, { name: 'Light green', hex: 'E3F2E6' }, { name: 'Light teal', hex: 'DDF1EF' }, { name: 'Light blue', hex: 'E1EBFA' }, { name: 'Light purple', hex: 'ECE4F6' }],
  [{ name: 'Grey', hex: 'DEDAD3' }, { name: 'Red', hex: 'F5BFB5' }, { name: 'Orange', hex: 'F9CFA2' }, { name: 'Yellow', hex: 'FFE98A' }, { name: 'Green', hex: 'BFE0C6' }, { name: 'Teal', hex: 'B2DFDA' }, { name: 'Blue', hex: 'BCD1F2' }, { name: 'Purple', hex: 'D3C2EC' }],
  [{ name: 'Dark grey', hex: 'BDB7AD' }, { name: 'Strong red', hex: 'EC9283' }, { name: 'Strong orange', hex: 'F3AE68' }, { name: 'Strong yellow', hex: 'F7D547' }, { name: 'Strong green', hex: '93C99E' }, { name: 'Strong teal', hex: '7FC8C0' }, { name: 'Strong blue', hex: '93B3E8' }, { name: 'Strong purple', hex: 'B79CDF' }],
];
