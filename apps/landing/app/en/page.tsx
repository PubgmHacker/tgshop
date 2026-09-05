import type { Metadata } from 'next';
import { getCopy } from '../../lib/i18n';
import { getCatalog } from '../../lib/catalog';
import { botDeepLink } from '../../lib/env';
import { StickyNav } from '../../components/ui/StickyNav';
import { Hero } from '../../components/sections/Hero';
import { TrustBar } from '../../components/sections/TrustBar';
import { HowItWorks } from '../../components/sections/HowItWorks';
import { Showcase } from '../../components/sections/Showcase';
import { WhyUs } from '../../components/sections/WhyUs';
import { Faq } from '../../components/sections/Faq';
import { FinalCta } from '../../components/sections/FinalCta';
import { Footer } from '../../components/sections/Footer';
import { JsonLd } from '../../components/seo/JsonLd';

export const revalidate = 300;

const copy = getCopy('en');

export const metadata: Metadata = {
  title: copy.meta.title,
  description: copy.meta.description,
  openGraph: {
    title: copy.meta.ogTitle,
    description: copy.meta.ogDescription,
  },
  alternates: {
    canonical: '/en/',
  },
};

export default async function EnglishHomePage() {
  const locale = 'en';
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
        localeSwitcherHref="/"
        localeSwitcherLabel="RU"
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
