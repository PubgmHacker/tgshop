import { Container } from '../ui/Container';
import type { LandingCopy } from '../../lib/i18n';

export function TrustBar({ copy }: { copy: LandingCopy }) {
  return (
    <section aria-label={copy.trust.label} className="border-y border-line bg-bg-soft py-8">
      <Container>
        <p className="mb-4 text-center text-sm text-muted">
          {copy.trust.label}
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {copy.trust.items.map((item) => (
            <li
              key={item}
              className="text-base font-medium text-white"
            >
              {item}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
