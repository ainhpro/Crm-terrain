'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Dictée dans le navigateur (Web Speech API) quand elle existe ; sinon, le micro du clavier du téléphone.
 * La transcription serveur (service vocal européen) remplacera ceci quand il sera choisi.
 */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
};

export function Dictation({ lang, onText, labels }: { lang: string; onText: (s: string) => void; labels: { start: string; stop: string; unavailable: string } }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  // Le rappel change à chaque rendu : on le garde dans une référence pour ne pas recréer la reconnaissance.
  const callback = useRef(onText);
  callback.current = onText;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSupported(Boolean(Ctor));
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) callback.current(res[0].transcript.trim());
      }
    };
    r.onend = () => setListening(false);
    rec.current = r;
    return () => r.stop();
  }, [lang]);

  if (supported === false) return <p className="faint">{labels.unavailable}</p>;
  return (
    <button
      type="button"
      className="btn block"
      aria-pressed={listening}
      onClick={() => {
        if (!rec.current) return;
        if (listening) rec.current.stop();
        else {
          rec.current.start();
          setListening(true);
        }
      }}
    >
      {listening ? `■ ${labels.stop}` : `● ${labels.start}`}
    </button>
  );
}
