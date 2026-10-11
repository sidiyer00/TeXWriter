import type { Editor } from '@tiptap/react';
/** The live visual editor (null when not mounted). */
export const editorRef: { current: Editor | null; lastFocus: 'visual' | 'source' } = { current: null, lastFocus: 'visual' };
