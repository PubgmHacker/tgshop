import { Container } from '../ui/Container';
import { MotionButton } from '../ui/MotionButton';
import type { LandingCopy } from '../../lib/i18n';

export function Hero({ copy, botLink }: { copy: LandingCopy; botLink: string }) {

  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      <Container className="flex flex-col items-center text-center">
        <h1
          className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl"
        >
          {copy.hero.headline}{' '}
          <span className="text-white">{copy.hero.headlineAccent}</span>
        </h1>

        <p
          className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
        >
          {copy.hero.subheadline}
        </p>

        <div
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row"
        >
          <MotionButton href={botLink} target="_blank" rel="noopener noreferrer">
            {copy.hero.ctaPrimary}
          </MotionButton>
          <MotionButton href="#showcase" variant="secondary">
            {copy.hero.ctaSecondary}
          </MotionButton>
        </div>

      </Container>
    </section>
  );
}
