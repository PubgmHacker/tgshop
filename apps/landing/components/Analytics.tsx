import Script from 'next/script';
import { ANALYTICS_DOMAIN, ANALYTICS_PROVIDER, ANALYTICS_SCRIPT_URL } from '../lib/env';

/**
 * Env-gated analytics loader for Plausible or Umami. Renders nothing unless
 * NEXT_PUBLIC_ANALYTICS_PROVIDER is set to "plausible" or "umami" together
 * with a script URL / domain, so the landing page never ships tracking
 * scripts by default.
 */
export function Analytics() {
  if (!ANALYTICS_PROVIDER || !ANALYTICS_SCRIPT_URL) {
    return null;
  }

  if (ANALYTICS_PROVIDER === 'plausible') {
    return <Script defer data-domain={ANALYTICS_DOMAIN} src={ANALYTICS_SCRIPT_URL} strategy="afterInteractive" />;
  }

  if (ANALYTICS_PROVIDER === 'umami') {
    return (
      <Script
        defer
        data-website-id={ANALYTICS_DOMAIN}
        src={ANALYTICS_SCRIPT_URL}
        strategy="afterInteractive"
      />
    );
  }

  return null;
}
