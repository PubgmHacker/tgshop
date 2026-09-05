'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Container } from '../ui/Container';
import { MotionButton } from '../ui/MotionButton';
import type { LandingCopy } from '../../lib/i18n';

export function Hero({ copy, botLink }: { copy: LandingCopy; botLink: string }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div aria-hidden className="absolute inset-0 -z-10 bg-radial-fade" />
      <motion.div
        aria-hidden
        className="absolute -top-24 right-1/4 -z-10 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
        animate={prefersReducedMotion ? undefined : { y: [0, 16, 0] }}
        transition={prefersReducedMotion ? undefined : { duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />

      <Container className="flex flex-col items-center text-center">
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl"
        >
          {copy.hero.headline}{' '}
          <span className="text-accent">{copy.hero.headlineAccent}</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
        >
          {copy.hero.subheadline}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row"
        >
          <MotionButton href={botLink} target="_blank" rel="noopener noreferrer">
            {copy.hero.ctaPrimary}
          </MotionButton>
          <MotionButton href="#showcase" variant="secondary">
            {copy.hero.ctaSecondary}
          </MotionButton>
        </motion.div>

      </Container>
    </section>
  );
}
