'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Container } from './Container';
import { MotionButton } from './MotionButton';

export interface NavLink {
  label: string;
  href: string;
}

/**
 * Fixed header that gains a translucent blurred background once the page is
 * scrolled, plus a mobile slide-down menu.
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuLabel = localeSwitcherLabel === 'EN' ? 'Меню' : 'Menu';
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled ? 'border-b border-line bg-bg/80 backdrop-blur-lg' : 'bg-transparent'
      }`}
    >
      <Container className="flex h-16 items-center justify-between">
        <Link href="/#top" className="text-lg font-bold tracking-tight text-white">
          {brand}
        </Link>

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
          ref={menuButton}
          aria-label={menuLabel}
          aria-controls="mobile-navigation"
          aria-expanded={menuOpen}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-white md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
        </button>
      </Container>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-navigation"
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
                  className="flex min-h-11 items-center text-base text-white"
                >
                  {link.label}
                </a>
              ))}
              <a href={localeSwitcherHref} className="flex min-h-11 items-center text-base text-muted">
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
