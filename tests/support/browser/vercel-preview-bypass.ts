import { test as base } from '@playwright/test';

/**
 * Vercel Deployment Protection sends automated browsers on preview deployments to Vercel's login page.
 * With VERCEL_AUTOMATION_BYPASS_SECRET set, every request to the app's own origin carries Vercel's bypass header.
 * The header never goes to another origin: the secret must not leak to third parties, and a custom header on a
 * cross-origin request would add a CORS preflight that Firebase, ArcGIS, or Vercel Blob might refuse.
 */
export const test = base.extend<{ vercelPreviewBypass: void }>({
  vercelPreviewBypass: [
    async ({ context, baseURL }, use) => {
      const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      if (secret && baseURL) {
        const appOrigin = new URL(baseURL).origin;
        await context.route(
          (url) => url.origin === appOrigin,
          (route) => route.continue({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': secret } }),
        );
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
