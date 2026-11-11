import { expect, test } from '@playwright/test';
import { mapWithConcurrency } from '../../../../support/downloads/bounded-concurrency.ts';
import {
  loadRegionalFileInventory,
  ManifestsUnavailableError,
  type RegionalFileInventory,
  type RegionalOnlyFile,
} from '../../../../support/downloads/regional-files.ts';
import {
  fetchFirstBytes,
  headStatus,
  plainBucketAddress,
  publicBlobAddress,
  requestSignedUrl,
  type SignedUrlReply,
} from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

type Verdict = 'passed' | 'failed' | 'inconclusive';
interface Outcome {
  verdict: Verdict;
  /** Status codes and refusal reasons only. Never a signed link. */
  detail: string;
}
type ServiceReply = SignedUrlReply | { error: string };
type CheckName = 'publicBlobClosed' | 'plainBucketRefused' | 'noGrantRefused' | 'catalogTag';

const checkTitles: Record<CheckName, string> = {
  publicBlobClosed: 'old public Vercel Blob address returns 404 or 403',
  plainBucketRefused: 'plain bucket address returns 401 or 403',
  noGrantRefused: 'an active user without a region grant is refused a link',
  catalogTag: 'the download catalog tags the file with its own region',
};
const sampleKeysShown = 5;

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function hasLink(reply: SignedUrlReply): boolean {
  return reply.body?.url !== undefined || reply.rawText.includes('X-Goog-Signature');
}

function describeReply(reply: ServiceReply): string {
  if ('error' in reply) return `no reply (${reply.error})`;
  if (hasLink(reply)) return `${reply.status} link issued`;
  return `${reply.status} ${reply.body?.detail?.status ?? 'no reason'}`;
}

function transientReply(reply: ServiceReply): boolean {
  return 'error' in reply || isTransientStatus(reply.status);
}

function refusalReason(reply: ServiceReply): string | undefined {
  return 'error' in reply ? undefined : reply.body?.detail?.status;
}

function classifyAddress(status: number | string, closedStatuses: number[]): Outcome {
  if (typeof status === 'string') return { verdict: 'inconclusive', detail: `no reply (${status})` };
  if (closedStatuses.includes(status)) return { verdict: 'passed', detail: String(status) };
  if (isTransientStatus(status)) return { verdict: 'inconclusive', detail: String(status) };
  return { verdict: 'failed', detail: String(status) };
}

function classifyNoGrantRefusal(reply: ServiceReply): Outcome {
  if (transientReply(reply)) return { verdict: 'inconclusive', detail: describeReply(reply) };
  const refused = !('error' in reply) && !hasLink(reply) && (reply.status === 403 || reply.status === 404);
  return { verdict: refused ? 'passed' : 'failed', detail: describeReply(reply) };
}

/**
 * The service shows no catalog, so its decisions reveal the tag: a user with no grant is refused with
 * layer_forbidden only for a regional tag, and a user granted region R gets a link only for a national or R tag.
 */
function classifyCatalogTag(noGrant: ServiceReply, granted: ServiceReply): Outcome {
  if (transientReply(noGrant) || transientReply(granted)) {
    return { verdict: 'inconclusive', detail: `${describeReply(noGrant)} / ${describeReply(granted)}` };
  }
  const noGrantReply = noGrant as SignedUrlReply;
  const grantedReply = granted as SignedUrlReply;
  if (hasLink(noGrantReply)) return { verdict: 'failed', detail: 'tagged national' };
  if (refusalReason(noGrant) === 'object_not_in_catalog' || refusalReason(granted) === 'object_not_in_catalog') {
    return { verdict: 'failed', detail: 'missing from the catalog' };
  }
  if (refusalReason(noGrant) === 'layer_forbidden' && hasLink(grantedReply)) {
    return { verdict: 'passed', detail: 'tagged with its region' };
  }
  if (refusalReason(noGrant) === 'layer_forbidden' && refusalReason(granted) === 'layer_forbidden') {
    return { verdict: 'failed', detail: 'tagged with another region' };
  }
  return { verdict: 'failed', detail: `unexpected: ${describeReply(noGrant)} / ${describeReply(granted)}` };
}

async function safeRequestSignedUrl(
  request: Parameters<typeof requestSignedUrl>[0],
  objectName: string,
  idToken: string,
): Promise<ServiceReply> {
  try {
    return await requestSignedUrl(request, objectName, idToken);
  } catch (error) {
    return { error: (error as Error).message.split('\n')[0] };
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

test.describe('FBT-021', () => {
  let factory: TestAccountFactory;
  let inventory: RegionalFileInventory;
  let userWithoutRegionGrant: TestAccount;
  const grantedUserByRegion = new Map<string, TestAccount>();

  test.beforeAll(async () => {
    test.setTimeout(150_000);
    try {
      inventory = await loadRegionalFileInventory();
    } catch (error) {
      if (error instanceof ManifestsUnavailableError) {
        throw new Error(`INCONCLUSIVE: the published manifests could not be read. ${error.message}`);
      }
      throw error;
    }
    const regions = [...new Set(inventory.files.map((file) => file.sirapId))].sort();
    factory = createTestAccountFactory();
    const [withoutGrant, ...granted] = await Promise.all([
      factory.create({ status: 'active', role: 'user', allowedSirapIds: [], authenticator: true }),
      ...regions.map((sirapId) =>
        factory.create({ status: 'active', role: 'sirap-user', allowedSirapIds: [sirapId], authenticator: true }),
      ),
    ]);
    userWithoutRegionGrant = withoutGrant;
    regions.forEach((sirapId, index) => grantedUserByRegion.set(sirapId, granted[index]));
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    'Every file the app shows only to regional users can be opened only through a signed link.',
    async ({ request }) => {
      test.setTimeout(150_000);
      await narrateCatalogTest('FBT-021');
      const regions = [...grantedUserByRegion.keys()];

      await test.step(
        `The published manifests list files used only by regional layers, solutions, and metrics`,
        async () => {
          test.info().annotations.push({
            type: 'Regional-only files',
            description:
              `${inventory.files.length} files across ${regions.join(', ')}; left out: ` +
              `${inventory.sharedWithNational.length} also used by national records, ` +
              `${inventory.colombiaWide.length} Colombia-wide, ` +
              `${inventory.usedByMoreThanOneRegion.length} used by more than one region.`,
          });
          expect(inventory.files.length, 'regional-only files found in the published manifests').toBeGreaterThan(0);
        },
      );

      const outcomes = new Map<CheckName, Array<{ file: RegionalOnlyFile; outcome: Outcome }>>(
        (Object.keys(checkTitles) as CheckName[]).map((name) => [name, []]),
      );
      const grantedReplies = new Map<string, ServiceReply>();
      const concurrency = serviceConfig.bulkCheckConcurrency;

      await test.step(
        'Every regional file is opened at its old public Vercel Blob address, at its plain bucket address, and through the signing service as a user without the grant and as a user granted its region',
        async () => {
          await Promise.all([
            mapWithConcurrency(inventory.files, concurrency, async (file) => {
              const status = await headStatus(request, publicBlobAddress(file.objectName));
              outcomes.get('publicBlobClosed')!.push({ file, outcome: classifyAddress(status, [403, 404]) });
            }),
            mapWithConcurrency(inventory.files, concurrency, async (file) => {
              const status = await headStatus(request, plainBucketAddress(file.objectName));
              outcomes.get('plainBucketRefused')!.push({ file, outcome: classifyAddress(status, [401, 403]) });
            }),
            mapWithConcurrency(inventory.files, concurrency, async (file) => {
              const noGrant = await safeRequestSignedUrl(request, file.objectName, userWithoutRegionGrant.idToken);
              const granted = await safeRequestSignedUrl(
                request,
                file.objectName,
                grantedUserByRegion.get(file.sirapId)!.idToken,
              );
              grantedReplies.set(file.objectName, granted);
              outcomes.get('noGrantRefused')!.push({ file, outcome: classifyNoGrantRefusal(noGrant) });
              outcomes.get('catalogTag')!.push({ file, outcome: classifyCatalogTag(noGrant, granted) });
            }),
          ]);
        },
      );

      let definiteFailures = 0;
      const inconclusiveReasons: string[] = [];
      const report: Record<string, unknown> = {
        manifests: inventory.manifestUrls,
        regionalOnlyFileCount: inventory.files.length,
        excluded: {
          sharedWithNational: inventory.sharedWithNational,
          colombiaWide: inventory.colombiaWide,
          usedByMoreThanOneRegion: inventory.usedByMoreThanOneRegion,
        },
      };

      for (const [name, title] of Object.entries(checkTitles) as Array<[CheckName, string]>) {
        const results = outcomes.get(name)!.sort((a, b) => a.file.objectName.localeCompare(b.file.objectName));
        const failed = results.filter(({ outcome }) => outcome.verdict === 'failed');
        const inconclusive = results.filter(({ outcome }) => outcome.verdict === 'inconclusive');
        report[name] = {
          title,
          passed: results.length - failed.length - inconclusive.length,
          failed: failed.map(({ file, outcome }) => ({ ...file, detail: outcome.detail })),
          inconclusive: inconclusive.map(({ file, outcome }) => ({ ...file, detail: outcome.detail })),
        };
        await test.step(`For every regional file, the ${title}`, async () => {
          definiteFailures += failed.length;
          if (inconclusive.length > 0) {
            inconclusiveReasons.push(
              `${title}: ${inconclusive.length} files (${JSON.stringify(countBy(inconclusive.map(({ outcome }) => outcome.detail)))})`,
            );
          }
          const message =
            `${failed.length} of ${results.length} regional files fail: ${title}. ` +
            `By result: ${JSON.stringify(countBy(failed.map(({ outcome }) => outcome.detail)))}. ` +
            `First keys: ${failed
              .slice(0, sampleKeysShown)
              .map(({ file }) => file.objectName)
              .join(', ')}`;
          expect.soft(failed.length, message).toBe(0);
        });
      }

      await test.step("One file per region downloads through a granted user's temporary link", async () => {
        const samples: Record<string, unknown> = {};
        for (const sirapId of regions) {
          const sample = inventory.files.find((file) => {
            const reply = grantedReplies.get(file.objectName);
            return file.sirapId === sirapId && reply !== undefined && !('error' in reply) && reply.body?.url;
          });
          if (sample === undefined) {
            const regionReplies = inventory.files
              .filter((file) => file.sirapId === sirapId)
              .map((file) => grantedReplies.get(file.objectName)!);
            samples[sirapId] = { detail: 'no granted link was issued for any file in this region' };
            if (regionReplies.every(transientReply)) {
              inconclusiveReasons.push(`${sirapId} sample download: the signing service never replied without 429 or 5xx`);
              continue;
            }
            definiteFailures += 1;
            expect.soft(sample, `no granted link was issued for any ${sirapId} file`).toBeDefined();
            continue;
          }
          const reply = grantedReplies.get(sample.objectName) as SignedUrlReply;
          let download: { status: number; byteLength: number } | { error: string };
          try {
            download = await fetchFirstBytes(request, reply.body!.url!);
          } catch (error) {
            download = { error: (error as Error).message.split('\n')[0].replace(/https:\/\/\S+/g, '[link]') };
          }
          if ('error' in download || isTransientStatus(download.status)) {
            inconclusiveReasons.push(`${sirapId} sample download: ${'error' in download ? download.error : download.status}`);
            samples[sirapId] = { objectName: sample.objectName, ...download };
            continue;
          }
          samples[sirapId] = { objectName: sample.objectName, ...download };
          const downloaded = [200, 206].includes(download.status) && download.byteLength > 0;
          if (!downloaded) definiteFailures += 1;
          expect
            .soft(
              downloaded,
              `${sample.objectName} via a granted link returned ${download.status} with ${download.byteLength} bytes`,
            )
            .toBe(true);
        }
        report.sampleDownloads = samples;
      });

      await test.info().attach('FBT-021 findings (object keys only)', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      if (definiteFailures === 0 && inconclusiveReasons.length > 0) {
        throw new Error(`INCONCLUSIVE: rate limited or unreachable. ${inconclusiveReasons.join('; ')}`);
      }
    },
  );
});
