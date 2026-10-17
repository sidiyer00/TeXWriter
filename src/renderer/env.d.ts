import type { TeXWriterApi } from '../shared/types';
declare global {
  interface Window { texwriter: TeXWriterApi }
}
declare module '*.png' { const src: string; export default src; }
export {};
