import type { MetadataRoute } from 'next';
import { LANDING_URL } from '../lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${LANDING_URL}/sitemap.xml`,
  };
}
