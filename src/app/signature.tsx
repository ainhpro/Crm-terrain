'use client';

import { useEffect, useRef } from 'react';

/** Signature au doigt sur un canevas ; transmise en PNG (data URL) au serveur, qui la stocke en privé. */
export function SignaturePad({ onChange, labels }: { onChange: (dataUrl: string) => void; labels: { hint: string; clear: string } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#101828';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <canvas
        ref={canvas}
        className="sig"
        aria-label={labels.hint}
        role="img"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (dirty.current) onChange(e.currentTarget.toDataURL('image/png'));
        }}
      />
      <div className="row">
        <span className="faint grow">{labels.hint}</span>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            const c = canvas.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            dirty.current = false;
            onChange('');
          }}
        >
          {labels.clear}
        </button>
      </div>
    </div>
  );
}
