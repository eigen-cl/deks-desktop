import { useEffect, useRef, useState } from "react";
import type { DeksDocument } from "@deks-js/document";
import { readAsset } from "../desktop-api";

/**
 * Traduce los assets del documento a URLs que el webview puede pintar. El
 * documento sólo guarda identidad y tipo —nunca una ruta absoluta— así que la
 * carpeta se puede mover o comprimir entera sin romper nada; la ruta se arma
 * aquí, en el host, y muere con él.
 *
 * Las `blob:` son del host y hay que revocarlas: sin eso cada reapertura dejaría
 * los bytes de la imagen retenidos para siempre.
 */
export function useAssetUrls(document: DeksDocument, projectPath: string) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    const wanted = document.assets.filter((asset) => asset.kind === "embedded");

    void (async () => {
      let changed = false;
      for (const asset of wanted) {
        if (cache.current.has(asset.id)) continue;
        try {
          const bytes = await readAsset(projectPath, asset.id, asset.mediaType);
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: asset.mediaType }));
          cache.current.set(asset.id, url);
          changed = true;
        } catch {
          // Un asset ilegible no rompe la edición: el renderer dibuja su
          // placeholder accesible y el resto de la slide sigue viva.
        }
      }
      // Un asset borrado del documento libera sus bytes en el acto.
      const live = new Set(wanted.map((asset) => asset.id));
      for (const [id, url] of cache.current) {
        if (live.has(id)) continue;
        URL.revokeObjectURL(url);
        cache.current.delete(id);
        changed = true;
      }
      if (changed && !cancelled) setUrls(Object.fromEntries(cache.current));
    })();

    return () => { cancelled = true; };
  }, [document.assets, projectPath]);

  useEffect(() => {
    const held = cache.current;
    return () => {
      for (const url of held.values()) URL.revokeObjectURL(url);
      held.clear();
    };
  }, []);

  return urls;
}
