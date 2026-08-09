import { Container } from '../ui/Container';
import type { LandingCopy } from '../../lib/i18n';

export function Footer({ copy }: { copy: LandingCopy }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line py-14">
      <Container>
        <div className="grid gap-10 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="text-lg font-bold text-white">{copy.nav.brand}</p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">{copy.footer.tagline}</p>
          </div>

          {copy.footer.columns.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-semibold text-white">{column.title}</p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href + link.label}>
                    <a href={link.href} className="text-sm text-muted transition-colors hover:text-white">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {copy.nav.brand}. {copy.footer.copyright}
          </p>
          <div className="flex flex-wrap gap-4">
            {copy.footer.legalLinks.map((link) => (
              <a key={link.href} href={link.href} className="transition-colors hover:text-white">
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
