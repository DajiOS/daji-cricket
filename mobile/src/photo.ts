import { createContext, useContext, useEffect, useState } from 'react';
import { api, API_URL } from './api';
import type { Mode } from './theme';

interface LibItem { kind: 'image' | 'video'; tag: string; url: string; thumb?: string | null; poster?: string | null }
let cached: string | null | undefined;
/** The ground's own photo for the banners: the first hero or gallery picture (or a drone video's still) uploaded in the desk. null when there is none. */
export function useGroundPhoto(): string | null {
  const [pic, setPic] = useState<string | null>(cached ?? null);
  useEffect(() => {
    if (cached !== undefined) return;
    api<{ items: LibItem[] }>('/api/library/public').then((r) => {
      const it = ['hero', 'gallery'].flatMap((tag) => r.items.filter((x) => x.tag === tag).reverse()).map((x) => (x.kind === 'video' ? x.poster || x.thumb : x.url)).find(Boolean);
      cached = it ? (/^https:\/\//.test(it) ? it : API_URL + it) : null;
      setPic(cached);
    }).catch(() => { /* the green band is enough */ });
  }, []);
  return pic;
}

/** Light or dark, and the switch for it. The switch lives in Profile (and on the sign-in screen), not floating over the screens. */
export const Appearance = createContext<{ mode: Mode; flip: () => void }>({ mode: 'light', flip: () => {} });
export const useAppearance = () => useContext(Appearance);
