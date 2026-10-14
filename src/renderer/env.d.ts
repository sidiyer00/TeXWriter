import type { TeXWriterApi } from '../shared/types';
declare global {
  interface Window { texwriter: TeXWriterApi }
}
export {};
