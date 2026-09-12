'use client';

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
 * Animated CTA link with a subtle hover lift and tap scale. The primary
 * variant uses a filled background,
 * outlined ghost style for secondary. No animation is applied when the user
 * prefers reduced motion.
 */
export function MotionButton({ children, variant = 'primary', className = '', ...rest }: MotionButtonProps) {

  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  const styles =
    variant === 'primary'
      ? `${base} bg-white text-bg hover:bg-white/90`
      : `${base} border border-line text-white hover:bg-white/5`;

  return (
    <a
      className={`${styles} ${className}`}
      {...rest}
    >
      {children}
    </a>
  );
}
