import { useEffect, useRef, useState } from "react";
import type { DeksDocument, DeksFileAsset } from "@deks-js/document";

/**
 * Traduce los assets del documento a URLs que el webview puede pintar. El
 * documento sólo guarda identidad y tipo —nunca una ruta absoluta— y los bytes
 * llegan dentro del mismo `.deks`. La URL se arma aquí y muere con el host.
 *
 * Las `blob:` son del host y hay que revocarlas: sin eso cada reapertura dejaría
 * los bytes de la imagen retenidos para siempre.
 */
export function useAssetUrls(document: DeksDocument, assets: readonly DeksFileAsset[]) {
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
          const bytes = assets.find(({ id }) => id === asset.id)?.bytes;
          if (!bytes) continue;
          if (cancelled) return;
          const stable = new Uint8Array(bytes.byteLength);
          stable.set(bytes);
          const url = URL.createObjectURL(new Blob([stable.buffer], { type: asset.mediaType }));
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
  }, [assets, document.assets]);

  useEffect(() => {
    const held = cache.current;
    return () => {
      for (const url of held.values()) URL.revokeObjectURL(url);
      held.clear();
    };
  }, []);

  return urls;
}
