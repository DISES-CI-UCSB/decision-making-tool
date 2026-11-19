import type { Page } from '@playwright/test';
import { expect, test } from '../../../../support/browser/vercel-preview-bypass.ts';
import { observeLiveNetwork } from '../../../../support/network/live-network-telemetry.ts';
import { approvedExternalDisruptionEvidence } from '../../../../support/network/live-release-evidence.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/**
 * The four regional (SIRAP) layers in the 3.7.1 layer manifest, by Spanish and English label.
 * Orinoquía: Sabanas de la Orinoquía, Congriales. Eje Cafetero: Humedales del Eje Cafetero, ECC.
 */
const regionalLayerLabels = [
  'Sabanas de la Orinoquía',
  'Orinoquía Savannas',
  'Congriales',
  'Humedales del Eje Cafetero',
  'Eje Cafetero Wetlands',
  'Estrategias Complementarias de Conservación',
  'Complementary Conservation Strategies',
];
const regionalText = /Orinoqu|Eje Cafetero|Congriales|Estrategias Complementarias|Complementary Conservation Strategies/i;
/**
 * Regional files: anything under a SIRAP release (its manifest, rasters, metrics) or keyed by an
 * Orinoquía or Eje Cafetero layer. The public SIRAP boundary outlines (siraps_*) are national layers.
 */
const regionalRequestPath = /\/releases\/sirap-|orinoqu|eje[-_]cafetero/i;

function requestPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = `${url.origin}${url.pathname}`;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function recordRegionalRequests(page: Page): string[] {
  const regionalRequests: string[] = [];
  page.on('request', (request) => {
    const path = requestPath(request.url());
    if (regionalRequestPath.test(path)) regionalRequests.push(path);
  });
  return regionalRequests;
}

test.describe('FBT-029', () => {
  test(
    'A signed-out visitor sees national public layers but no regional layers, regional downloads, or admin tools.',
    async ({ page }) => {
      test.setTimeout(60_000);
      await narrateCatalogTest('FBT-029');
      const regionalRequests = recordRegionalRequests(page);
      const networkSummary = observeLiveNetwork(page);
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      /** A readiness step that fails during an approved external-service outage is inconclusive, not failed. */
      async function whenServicesRespond(action: () => Promise<void>): Promise<void> {
        try {
          await action();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const evidence = approvedExternalDisruptionEvidence({
            message,
            pageErrors,
            network: networkSummary(),
          });
          if (evidence) throw new Error(`INCONCLUSIVE: ${evidence}\n${message}`);
          throw error;
        }
      }

      const signInButton = page.getByRole('button', {
        name: /Iniciar sesión \/ Registrarse|Login \/ Register/,
      });
      const finder = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('radiogroup', { name: /Dominio de planificación|Planning domain/ }) });
      const layerPanel = page
        .getByRole('complementary')
        .filter({ has: page.getByRole('heading', { name: /Capas del mapa|Map Layers/i }) });

      try {
        await test.step('A signed-out visitor opens the app, closes the welcome video, and is offered sign-in', async () => {
          await whenServicesRespond(async () => {
            await page.goto('/');
            await page
              .getByRole('dialog', { name: /Vea el recorrido|Watch the walkthrough/ })
              .getByRole('button', { name: /^(Cerrar|Close)$/ })
              .click();
            await expect(signInButton).toBeVisible();
          });
        });

        await test.step('The header shows no SIRAP access, admin console, or sign-out control', async () => {
          await expect(page.getByRole('button', { name: /Acceso SIRAP|SIRAP access/i })).toHaveCount(0);
          await expect(
            page.getByRole('button', { name: /Consola de administración|Admin console/i }),
          ).toHaveCount(0);
          await expect(page.getByRole('button', { name: /Cerrar sesión|Log ?out/i })).toHaveCount(0);
        });

        await test.step('The scenario finder offers land scenarios with no SIRAP scope or SIRAP region choice', async () => {
          await whenServicesRespond(async () => {
            await page.getByRole('button', { name: /Seleccionar escenario|Select scenario/ }).click();
            await expect(finder.getByRole('radio', { name: /^(Terrestre|Land)$/ })).toBeChecked();
          });
          await expect(
            finder.getByRole('radiogroup', { name: /Alcance de escenarios|Scenario scope/i }),
          ).toHaveCount(0);
          await expect(finder.getByRole('radio', { name: /^SIRAP$/ })).toHaveCount(0);
          await expect(finder.getByRole('option', { name: regionalText })).toHaveCount(0);
        });

        await test.step('Loading the default national scenario lists national public layers', async () => {
          await whenServicesRespond(async () => {
            await finder.getByRole('button', { name: /^(Ver mapa|View map)$/ }).click();
            await expect(
              layerPanel.getByRole('heading', { name: /Escenario activo|Active Scenario/i }),
            ).toBeVisible();
            await expect(layerPanel.getByText(/RUNAP 2023/).first()).toBeVisible();
            await expect(layerPanel.getByText(/RAMSAR/i).first()).toBeVisible();
          });
        });

        await test.step('The ecosystem layers and a layer search show no Orinoquía or Eje Cafetero layer', async () => {
          const ecosystemGroup = layerPanel.getByRole('button', {
            name: /^(Ecosistemas|Ecosystems) \d+ (capas?|layers?)$/,
          });
          if ((await ecosystemGroup.getAttribute('aria-expanded')) !== 'true') await ecosystemGroup.click();
          await expect(ecosystemGroup).toHaveAttribute('aria-expanded', 'true');
          await expect(layerPanel.getByText(regionalText)).toHaveCount(0);

          const layerSearch = layerPanel.getByRole('textbox', {
            name: /Buscar capas disponibles|Search available layers/,
          });
          const searchResultCount = layerPanel.getByText(/\b(coincidencias?|match(es)?)\b/);
          for (const label of regionalLayerLabels) {
            // A national match first, so a count of 0 below comes from this search and not an earlier one.
            await layerSearch.fill('RAMSAR');
            await expect(searchResultCount).toHaveText(/^\s*[1-9]/);
            await expect(layerPanel.getByText(/RAMSAR/i).first()).toBeVisible();
            await layerSearch.fill(label);
            await expect(searchResultCount, `searching for "${label}"`).toHaveText(/^\s*0\s/);
            await expect(layerPanel.getByText(label), `searching for "${label}"`).toHaveCount(0);
          }
          await layerSearch.fill('');
        });

        await test.step('No download control on the page names a regional layer or region', async () => {
          const downloadControls = page
            .getByRole('button', { name: /descarg|download/i })
            .or(page.getByRole('link', { name: /descarg|download/i }));
          for (const control of await downloadControls.all()) {
            const name = (await control.getAttribute('aria-label')) ?? (await control.innerText());
            expect(name, 'download control name').not.toMatch(regionalText);
          }
        });
      } finally {
        await test.info().attach('live network summary', {
          body: JSON.stringify(networkSummary(), null, 2),
          contentType: 'application/json',
        });
      }

      await test.step("The visitor's browser requested no regional file or SIRAP manifest", async () => {
        expect(
          [...new Set(regionalRequests)],
          'regional file requests from a signed-out visitor',
        ).toEqual([]);
      });
    },
  );
});
