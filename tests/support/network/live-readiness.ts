import type { Page } from '@playwright/test';
import { observeLiveNetwork, type LiveNetworkSummary } from './live-network-telemetry.ts';
import { approvedExternalDisruptionEvidence } from './live-release-evidence.ts';

export interface LiveReadiness {
  networkSummary: () => LiveNetworkSummary;
  /**
   * Runs a readiness step. A failure that coincides with approved external disruption (HTTP 429 or 5xx, or a
   * network, DNS, TLS, or graphics failure) is reported INCONCLUSIVE; any other failure stays a failure.
   * Wrap only steps that wait for services, never the behavior assertions themselves.
   */
  whenServicesRespond: (action: () => Promise<void>) => Promise<void>;
}

export function observeLiveReadiness(page: Page): LiveReadiness {
  const networkSummary = observeLiveNetwork(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  async function whenServicesRespond(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const evidence = approvedExternalDisruptionEvidence({ message, pageErrors, network: networkSummary() });
      if (evidence) throw new Error(`INCONCLUSIVE: ${evidence}\n${message}`, { cause: error });
      throw error;
    }
  }

  return { networkSummary, whenServicesRespond };
}
