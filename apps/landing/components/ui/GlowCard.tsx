import type { ReactNode } from 'react';

/**
 * OriginKit-style "glow card" (hand-rolled): a bordered card on the dark
 * surface with a soft accent glow on hover, used for feature/product tiles.
 */
export function GlowCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`group relative rounded-2xl border border-line bg-bg-card p-6 transition-shadow duration-300 hover:shadow-glow ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-radial-fade opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative">{children}</div>
    </div>
  );
}
