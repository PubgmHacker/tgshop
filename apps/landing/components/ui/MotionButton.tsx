'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * React's DOM event handlers for these props clash with framer-motion's
 * gesture/animation callbacks of the same name (framer hands them a
 * `PointerEvent` + `PanInfo` instead of a React `DragEvent`). They are dropped
 * from the public prop type so `...rest` can be spread onto `motion.a` safely.
 */
type MotionConflictingProps = 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart';

interface MotionButtonProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, MotionConflictingProps> {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}

/**
 * Animated CTA button (OriginKit "shimmer button" pattern, hand-rolled):
 * subtle hover lift + tap scale, gradient background on the primary variant,
 * outlined ghost style for secondary. No animation is applied when the user
 * prefers reduced motion.
 */
export function MotionButton({ children, variant = 'primary', className = '', ...rest }: MotionButtonProps) {
  const prefersReducedMotion = useReducedMotion();

  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  const styles =
    variant === 'primary'
      ? `${base} bg-accent-gradient text-white shadow-glow hover:brightness-110`
      : `${base} border border-line text-white hover:bg-white/5`;

  return (
    <motion.a
      className={`${styles} ${className}`}
      whileHover={prefersReducedMotion ? undefined : { scale: 1.03, y: -1 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.15 }}
      {...rest}
    >
      {children}
    </motion.a>
  );
}
