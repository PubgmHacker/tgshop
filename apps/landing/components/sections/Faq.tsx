import { Container } from '../ui/Container';
import { RevealOnScroll } from '../ui/RevealOnScroll';
import { Accordion } from '../ui/Accordion';
import type { LandingCopy } from '../../lib/i18n';

export function Faq({ copy }: { copy: LandingCopy }) {
  return (
    <section id="faq" className="py-20 sm:py-28">
      <Container className="max-w-3xl">
        <RevealOnScroll className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-to">{copy.faq.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">{copy.faq.title}</h2>
          <p className="mt-4 text-muted">{copy.faq.subtitle}</p>
        </RevealOnScroll>

        <RevealOnScroll className="mt-12">
          <Accordion items={copy.faq.items} />
        </RevealOnScroll>
      </Container>
    </section>
  );
}
