import type { ReactNode } from 'react';

/**
 * Bordered card on the dark surface with a restrained accent hover state,
 * used for feature and product tiles.
 */
export function GlowCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`group relative rounded-2xl border border-line bg-bg-card p-6 transition-colors duration-200 hover:border-white/25 ${className}`}
    >
      {children}
    </div>
  );
}
