import { Container } from '../ui/Container';
import { RevealOnScroll } from '../ui/RevealOnScroll';
import { MotionButton } from '../ui/MotionButton';
import type { LandingCopy } from '../../lib/i18n';

export function FinalCta({ copy, botLink }: { copy: LandingCopy; botLink: string }) {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <RevealOnScroll>
          <div className="relative overflow-hidden rounded-3xl border border-line bg-bg-card px-6 py-16 text-center sm:px-12">
            <div aria-hidden className="absolute inset-0 -z-10 bg-radial-fade" />
            <h2 className="mx-auto max-w-xl text-3xl font-bold text-white sm:text-4xl">{copy.finalCta.title}</h2>
            <p className="mx-auto mt-4 max-w-md text-muted">{copy.finalCta.subtitle}</p>
            <div className="mt-8 flex justify-center">
              <MotionButton href={botLink} target="_blank" rel="noopener noreferrer">
                {copy.finalCta.cta}
              </MotionButton>
            </div>
          </div>
        </RevealOnScroll>
      </Container>
    </section>
  );
}
