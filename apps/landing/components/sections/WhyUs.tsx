import { Container } from '../ui/Container';
import { RevealOnScroll } from '../ui/RevealOnScroll';
import { GlowCard } from '../ui/GlowCard';
import type { LandingCopy } from '../../lib/i18n';

export function WhyUs({ copy }: { copy: LandingCopy }) {
  return (
    <section id="why-us" className="py-20 sm:py-28">
      <Container>
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">{copy.whyUs.title}</h2>
          <p className="mt-4 text-muted">{copy.whyUs.subtitle}</p>
        </RevealOnScroll>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {copy.whyUs.items.map((item, index) => (
            <RevealOnScroll key={item.title} delay={(index % 4) * 0.08}>
              <GlowCard className="h-full">
                <h3 className="text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
              </GlowCard>
            </RevealOnScroll>
          ))}
        </div>
      </Container>
    </section>
  );
}
