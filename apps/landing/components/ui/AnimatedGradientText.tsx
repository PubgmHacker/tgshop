'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * OriginKit-style "animated gradient text" (hand-rolled): a text-clipped
 * accent gradient that slowly animates its position. Falls back to a static
 * gradient (no keyframe animation) when the user prefers reduced motion.
 */
export function AnimatedGradientText({ children, className = '' }: { children: ReactNode; className?: string }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.span
      className={`bg-accent-gradient bg-[length:200%_200%] bg-clip-text text-transparent ${className}`}
      animate={prefersReducedMotion ? undefined : { backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
      transition={prefersReducedMotion ? undefined : { duration: 8, repeat: Infinity, ease: 'linear' }}
    >
      {children}
    </motion.span>
  );
}
