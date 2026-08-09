import { Container } from '../ui/Container';
import { Marquee } from '../ui/Marquee';
import type { LandingCopy } from '../../lib/i18n';

export function TrustBar({ copy }: { copy: LandingCopy }) {
  return (
    <section aria-label={copy.trust.label} className="border-y border-line bg-bg-soft py-8">
      <Container>
        <p className="mb-5 text-center text-xs font-medium uppercase tracking-widest text-muted">
          {copy.trust.label}
        </p>
        <Marquee>
          {copy.trust.items.concat(copy.trust.items).map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="whitespace-nowrap px-6 text-lg font-semibold text-white/70"
            >
              {item}
            </span>
          ))}
        </Marquee>
      </Container>
    </section>
  );
}
