'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, useState } from 'react';

export interface AccordionItemData {
  question: string;
  answer: string;
}

/**
 * Single-open FAQ accordion with animated height/opacity expand. Height
 * animation is skipped in favor of an
 * instant toggle when the user prefers reduced motion.
 */
export function Accordion({ items }: { items: AccordionItemData[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const prefersReducedMotion = useReducedMotion();
  const baseId = useId();

  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-bg-card">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-button-${index}`;

        return (
          <div key={item.question}>
            <button
              id={buttonId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left text-base font-medium text-white sm:px-6"
            >
              <span>{item.question}</span>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line transition-transform duration-200 ${
                  isOpen ? 'rotate-45' : ''
                }`}
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={prefersReducedMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0.1 : 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted sm:px-6">{item.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
