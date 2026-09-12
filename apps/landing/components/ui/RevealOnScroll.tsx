import type { ReactNode } from 'react';

export type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

interface RevealOnScrollProps {
  children: ReactNode;
  className?: string;
  direction?: RevealDirection;
  delay?: number;
  duration?: number;
  once?: boolean;
  amount?: number;
}

/** Keep section content visible in SSR, with JavaScript disabled, and in reduced motion. */
export function RevealOnScroll({ children, className }: RevealOnScrollProps) {
  return <div className={className}>{children}</div>;
}
