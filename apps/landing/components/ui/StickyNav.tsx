'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Container } from './Container';
import { MotionButton } from './MotionButton';

export interface NavLink {
  label: string;
  href: string;
}

/**
 * OriginKit-style "sticky nav" (hand-rolled): fixed header that gains a
 * translucent blurred background once the page is scrolled, plus a mobile
 * slide-down menu.
 */
export function StickyNav({
  brand,
  links,
  ctaLabel,
  ctaHref,
  localeSwitcherHref,
  localeSwitcherLabel,
}: {
  brand: string;
  links: NavLink[];
  ctaLabel: string;
  ctaHref: string;
  localeSwitcherHref: string;
  localeSwitcherLabel: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled ? 'border-b border-line bg-bg/80 backdrop-blur-lg' : 'bg-transparent'
      }`}
    >
      <Container className="flex h-16 items-center justify-between">
        <a href="#top" className="text-lg font-bold tracking-tight text-white">
          {brand}
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-sm text-muted transition-colors hover:text-white">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <a href={localeSwitcherHref} className="text-sm text-muted transition-colors hover:text-white">
            {localeSwitcherLabel}
          </a>
          <MotionButton href={ctaHref} target="_blank" rel="noopener noreferrer" className="px-5 py-2 text-sm">
            {ctaLabel}
          </MotionButton>
        </div>

        <button
          type="button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-white md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          {menuOpen ? '✕' : '☰'}
        </button>
      </Container>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-b border-line bg-bg/95 backdrop-blur-lg md:hidden"
          >
            <Container className="flex flex-col gap-4 py-6">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="text-base text-white"
                >
                  {link.label}
                </a>
              ))}
              <a href={localeSwitcherHref} className="text-base text-muted">
                {localeSwitcherLabel}
              </a>
              <MotionButton href={ctaHref} target="_blank" rel="noopener noreferrer" className="mt-2 w-full">
                {ctaLabel}
              </MotionButton>
            </Container>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
