import type { MetadataRoute } from 'next'
import { getPublicSiteOrigin, getPublicSiteUrl } from '@/lib/public-site/url'

// The immutable image is built without deployment URLs. Resolve the canonical
// host from the runtime environment instead of baking localhost into metadata.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    host: getPublicSiteOrigin(),
    sitemap: getPublicSiteUrl('/sitemap.xml'),
  }
}
