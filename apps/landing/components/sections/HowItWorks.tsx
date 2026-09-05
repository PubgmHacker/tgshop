import { Container } from '../ui/Container';
import { RevealOnScroll } from '../ui/RevealOnScroll';
import { GlowCard } from '../ui/GlowCard';
import type { LandingCopy } from '../../lib/i18n';

export function HowItWorks({ copy }: { copy: LandingCopy }) {
  return (
    <section id="how-it-works" className="py-20 sm:py-28">
      <Container>
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">{copy.howItWorks.title}</h2>
          <p className="mt-4 text-muted">{copy.howItWorks.subtitle}</p>
        </RevealOnScroll>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {copy.howItWorks.steps.map((step, index) => (
            <RevealOnScroll key={step.title} delay={index * 0.1}>
              <GlowCard className="h-full">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-gradient text-sm font-bold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
              </GlowCard>
            </RevealOnScroll>
          ))}
        </div>
      </Container>
    </section>
  );
}
