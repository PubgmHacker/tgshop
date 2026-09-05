import { getCopy } from '../lib/i18n';
import { getCatalog } from '../lib/catalog';
import { botDeepLink } from '../lib/env';
import { StickyNav } from '../components/ui/StickyNav';
import { Hero } from '../components/sections/Hero';
import { TrustBar } from '../components/sections/TrustBar';
import { HowItWorks } from '../components/sections/HowItWorks';
import { Showcase } from '../components/sections/Showcase';
import { WhyUs } from '../components/sections/WhyUs';
import { Faq } from '../components/sections/Faq';
import { FinalCta } from '../components/sections/FinalCta';
import { Footer } from '../components/sections/Footer';
import { JsonLd } from '../components/seo/JsonLd';

// Revalidate the page shell periodically so the ISR-fetched catalog data
// (see lib/catalog.ts, revalidate 300) is reflected without a full redeploy.
export const revalidate = 300;

export default async function HomePage() {
  const locale = 'ru';
  const copy = getCopy(locale);
  const botLink = botDeepLink('web');
  const { products, isFallback } = await getCatalog(copy);

  return (
    <main>
      <JsonLd copy={copy} />
      <StickyNav
        brand={copy.nav.brand}
        links={copy.nav.links}
        ctaLabel={copy.nav.cta}
        ctaHref={botLink}
        localeSwitcherHref="/en/"
        localeSwitcherLabel="EN"
      />
      <Hero copy={copy} botLink={botLink} />
      <TrustBar copy={copy} />
      <HowItWorks copy={copy} />
      <Showcase copy={copy} locale={locale} products={products} isFallback={isFallback} />
      <WhyUs copy={copy} />
      <Faq copy={copy} />
      <FinalCta copy={copy} botLink={botLink} />
      <Footer copy={copy} />
    </main>
  );
}
