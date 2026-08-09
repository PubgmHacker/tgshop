import type { LandingCopy } from '../../lib/i18n';
import { LANDING_URL } from '../../lib/env';

export function JsonLd({ copy }: { copy: LandingCopy }) {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: copy.nav.brand,
    url: LANDING_URL,
    logo: `${LANDING_URL}/favicon.svg`,
    sameAs: [] as string[],
  };

  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.faq.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage) }} />
    </>
  );
}
