import { Container } from '../ui/Container';
import { RevealOnScroll } from '../ui/RevealOnScroll';
import { GlowCard } from '../ui/GlowCard';
import type { LandingCopy } from '../../lib/i18n';

function Stars({ rating }: { rating: number }) {
  return (
    <div aria-hidden className="flex gap-0.5 text-accent-to">
      {Array.from({ length: 5 }).map((_, index) => (
        <span key={index} className={index < rating ? 'opacity-100' : 'opacity-20'}>
          ★
        </span>
      ))}
    </div>
  );
}

export function Reviews({ copy }: { copy: LandingCopy }) {
  return (
    <section id="reviews" className="py-20 sm:py-28">
      <Container>
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-to">{copy.reviews.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">{copy.reviews.title}</h2>
          <p className="mt-4 text-muted">{copy.reviews.subtitle}</p>
        </RevealOnScroll>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {copy.reviews.items.map((review, index) => (
            <RevealOnScroll key={review.handle} delay={index * 0.1}>
              <GlowCard className="h-full">
                <Stars rating={review.rating} />
                <p className="mt-4 text-sm leading-relaxed text-white/90">&ldquo;{review.text}&rdquo;</p>
                <p className="mt-5 text-sm font-semibold text-white">{review.name}</p>
                <p className="text-xs text-muted">{review.handle}</p>
              </GlowCard>
            </RevealOnScroll>
          ))}
        </div>
      </Container>
    </section>
  );
}
