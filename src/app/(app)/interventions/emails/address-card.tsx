'use client';

import { useState } from 'react';

/** Adresse de réception du compte, à copier (puis à mettre dans une règle de transfert de la messagerie). */
export function AddressCard({ address, labels }: { address: string; labels: { title: string; hint: string; copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers refusé : l'adresse reste sélectionnable à la main */
    }
  };
  return (
    <div className="card pad stack">
      <span className="label">{labels.title}</span>
      <div className="row">
        <code className="grow" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{address}</code>
        <button type="button" className="btn small" onClick={copy}>{copied ? labels.copied : labels.copy}</button>
      </div>
      <p className="faint">{labels.hint}</p>
    </div>
  );
}
