import React, { useEffect, useRef, useState } from 'react';

/**
 * Shared pieces for the landing page: frames around real product imagery,
 * a video that only plays while it is on screen, and the stepper that drives
 * the animated explainers.
 *
 * Everything here honours prefers-reduced-motion: videos do not autoplay and
 * explainers show their final state without moving.
 */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** True while the element is on screen. */
export function useInView<T extends Element>(threshold = 0.35): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}

/**
 * Steps through `count` stages while on screen, looping. Stops when off
 * screen, when the reader picks a step themselves, or when the reader has
 * asked for less motion (then it rests on the last step).
 */
export function useStepper(count: number, ms: number, holdLast = ms * 1.8) {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = count - 1;

  useEffect(() => { if (reduced) setStep(last); }, [reduced, last]);

  useEffect(() => {
    if (reduced || paused || !inView) return;
    const t = window.setTimeout(
      () => setStep((s) => (s >= last ? 0 : s + 1)),
      step === last ? holdLast : ms,
    );
    return () => window.clearTimeout(t);
  }, [step, reduced, paused, inView, ms, holdLast, last]);

  return {
    ref,
    step,
    reduced,
    paused,
    playing: !reduced && !paused && inView,
    go: (s: number) => { setPaused(true); setStep(Math.max(0, Math.min(last, s))); },
    toggle: () => setPaused((p) => !p),
  };
}

/* ── Frames ─────────────────────────────────────────────────────────── */

export function BrowserFrame({ children, label, className = '' }: {
  children: React.ReactNode; label?: string; className?: string;
}) {
  return (
    <div className={`lp-frame ${className}`}>
      <div className="lp-frame-bar" aria-hidden="true">
        <span /><span /><span />
        {label && <em>{label}</em>}
      </div>
      <div className="lp-frame-body">{children}</div>
    </div>
  );
}

export function PhoneFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`lp-phone ${className}`}>
      <div className="lp-phone-screen">{children}</div>
    </div>
  );
}

/** A real screenshot. Width and height are the file's own, so nothing jumps as it loads. */
export function Shot({ name, alt, w, h, eager = false }: {
  name: string; alt: string; w: number; h: number; eager?: boolean;
}) {
  return (
    <img
      src={`/landing/${name}.webp`} alt={alt} width={w} height={h}
      loading={eager ? 'eager' : 'lazy'} decoding="async"
    />
  );
}

/**
 * A short silent loop of real screens. Nothing is downloaded until it nears
 * the screen; it plays only while visible, and not at all for readers who
 * asked for less motion (they get the poster and the browser's own controls).
 */
export function DemoVideo({ name, label, w, h }: { name: string; label: string; w: number; h: number }) {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLVideoElement>(0.25);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (inView && !reduced && !stopped) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay refused: the poster stays */ });
    } else {
      v.pause();
    }
  }, [inView, reduced, stopped, ref]);

  return (
    <div className="lp-video">
      <video
        ref={ref} width={w} height={h} poster={`/landing/${name}-poster.webp`}
        muted playsInline loop preload="none" controls={reduced} aria-label={label}
      >
        <source src={`/landing/${name}.webm`} type="video/webm" />
        <source src={`/landing/${name}.mp4`} type="video/mp4" />
      </video>
      {!reduced && (
        <button
          type="button" className="lp-video-toggle" onClick={() => setStopped((s) => !s)}
          aria-label={stopped ? `Play: ${label}` : `Pause: ${label}`}
        >
          {stopped ? 'Play' : 'Pause'}
        </button>
      )}
    </div>
  );
}
