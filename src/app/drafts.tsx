'use client';

import { useEffect, useState } from 'react';

/**
 * Hors réseau, minimum (relecture P02) : les champs marqués data-draft d'un formulaire sont gardés
 * sur l'appareil à chaque frappe, restaurés à la réouverture, et effacés seulement quand le formulaire
 * part avec du réseau. Les photos et l'envoi hors réseau ne sont pas couverts (à venir).
 */
export function DraftKeeper({
  formId, storageKey, restoredLabel, clearOnFormId,
}: {
  formId: string; storageKey: string; restoredLabel: string;
  /** Formulaire dont l'envoi efface le brouillon (par défaut, celui des champs). */
  clearOnFormId?: string;
}) {
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const key = `brouillon:${storageKey}`;
    const fields = () => [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-draft]')];
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, string> | null;
      if (saved) {
        let any = false;
        for (const f of fields()) {
          const v = saved[f.name];
          if (v && v !== f.value) {
            // Passe par le setter natif pour que React voie le changement (champs contrôlés).
            Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), 'value')?.set?.call(f, v);
            f.dispatchEvent(new Event('input', { bubbles: true }));
            any = true;
          }
        }
        setRestored(any);
      }
    } catch {
      /* stockage indisponible (navigation privée) : rien à restaurer */
    }
    const save = () => {
      try {
        const values = Object.fromEntries(fields().map((f) => [f.name, f.value]));
        if (Object.values(values).some(Boolean)) localStorage.setItem(key, JSON.stringify(values));
      } catch {
        /* stockage plein ou refusé : le formulaire reste utilisable */
      }
    };
    const clearTarget = clearOnFormId ?? formId;
    const clear = (e: Event) => {
      if ((e.target as HTMLElement | null)?.id !== clearTarget || !navigator.onLine) return;
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    };
    form.addEventListener('input', save);
    document.addEventListener('submit', clear, true);
    return () => {
      form.removeEventListener('input', save);
      document.removeEventListener('submit', clear, true);
    };
  }, [formId, storageKey, clearOnFormId]);
  return restored ? <p className="note info" role="status">{restoredLabel}</p> : null;
}

/** Bandeau visible quand l'appareil n'a plus de réseau. */
export function NetworkStatus({ offlineLabel }: { offlineLabel: string }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online ? null : <p className="note warn" role="status" style={{ margin: '8px 16px 0' }}>{offlineLabel}</p>;
}
