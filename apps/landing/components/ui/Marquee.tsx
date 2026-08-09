import type { ReactNode } from 'react';

/**
 * OriginKit-style "marquee" (hand-rolled): an infinitely scrolling row of
 * items via a duplicated track + CSS keyframe animation (defined in
 * tailwind.config.js as `animate-marquee`), paused entirely when the user
 * prefers reduced motion via the `motion-reduce:` utility.
 */
export function Marquee({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`group relative flex overflow-hidden ${className}`}>
      <div className="flex min-w-full shrink-0 animate-marquee items-center gap-12 motion-reduce:animate-none">
        {children}
      </div>
      <div
        aria-hidden
        className="flex min-w-full shrink-0 animate-marquee items-center gap-12 motion-reduce:animate-none"
      >
        {children}
      </div>
    </div>
  );
}
