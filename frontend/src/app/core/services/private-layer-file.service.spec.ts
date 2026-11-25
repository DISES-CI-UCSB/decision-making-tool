import { TestBed } from '@angular/core/testing';
import { FirebaseClientService } from './firebase-client.service';
import {
  PrivateFileRefusal,
  PrivateLayerFileService,
  objectKeyFromBucketUrl,
  refusalReasonFor,
} from './private-layer-file.service';

const bucketUrl = 'https://storage.googleapis.com/pnn-priorizando-la-naturaleza/';
const savannasUrl = `${bucketUrl}inputs/reference/orinoquia_savannas/v0.1.0/orinoquia_savannas.geojson`;
const savannasKey = 'inputs/reference/orinoquia_savannas/v0.1.0/orinoquia_savannas.geojson';
const linkLifeMs = 15 * 60_000;

function signedLinkResponse(objectKey: string, signature: string, lifeMs = linkLifeMs): Response {
  return new Response(
    JSON.stringify({
      url: `${bucketUrl}${objectKey}?X-Goog-Signature=${signature}`,
      expires_at: new Date(Date.now() + lifeMs).toISOString(),
      object_name: objectKey,
      method: 'GET',
    }),
    { status: 200 },
  );
}

function refusalResponse(status: number, reason: string): Response {
  return new Response(JSON.stringify({ detail: { status: reason, message: reason } }), { status });
}

function signingRequestKeys(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(
    ([, init]) => JSON.parse(String((init as RequestInit).body)).object_name,
  );
}

describe('PrivateLayerFileService', () => {
  const firebase = {
    currentUser: null as { uid: string; getIdToken: () => Promise<string> } | null,
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: PrivateLayerFileService;

  const signInAs = (uid: string) => {
    firebase.currentUser = { uid, getIdToken: async () => `token-${uid}` };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    signInAs('regional-user');
    let signature = 0;
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const { object_name } = JSON.parse(String(init?.body));
      signature += 1;
      return signedLinkResponse(object_name, `sig${signature}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseClientService, useValue: firebase }],
    });
    service = TestBed.inject(PrivateLayerFileService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reads a bucket file through the same-origin proxy with a signed link from the signing service', async () => {
    const readable = await service.readableUrl(savannasUrl);

    expect(readable).toBe(`${location.origin}/private-files/${savannasKey}?X-Goog-Signature=sig1`);
    const [signingUrl, init] = fetchMock.mock.calls[0];
    expect(signingUrl).toBe('/metrics-api/downloads/signed-url');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-regional-user',
    });
    expect(signingRequestKeys(fetchMock)).toEqual([savannasKey]);
  });

  it('rewrites a public Vercel Blob address onto the public file bucket and asks the signing service for nothing', async () => {
    const publicUrl =
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/reference/ramsar/v0.1.0/ramsar.geojson?download=1';
    const publicBucketUrl =
      'https://storage.googleapis.com/pnn-priorizando-la-naturaleza-public/inputs/reference/ramsar/v0.1.0/ramsar.geojson?download=1';

    await expect(service.readableUrl(publicUrl)).resolves.toBe(publicBucketUrl);
    expect(service.isPrivateFile(publicBucketUrl)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a link while more than two minutes of its life remain', async () => {
    await service.readableUrl(savannasUrl);
    vi.setSystemTime(Date.now() + linkLifeMs - 2 * 60_000 - 1_000);

    await expect(service.readableUrl(savannasUrl)).resolves.toContain('sig1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks for a new link once two minutes or less of its life remain', async () => {
    await service.readableUrl(savannasUrl);
    vi.setSystemTime(Date.now() + linkLifeMs - 2 * 60_000);

    await expect(service.readableUrl(savannasUrl)).resolves.toContain('sig2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renews a short link once a quarter of its life remains', async () => {
    const shortLifeMs = 2 * 60_000;
    fetchMock.mockImplementationOnce(async () =>
      signedLinkResponse(savannasKey, 'short', shortLifeMs),
    );
    await service.readableUrl(savannasUrl);

    vi.setSystemTime(Date.now() + shortLifeMs * 0.75 - 1_000);
    await expect(service.readableUrl(savannasUrl)).resolves.toContain('short');
    vi.setSystemTime(Date.now() + 1_000);
    await expect(service.readableUrl(savannasUrl)).resolves.not.toContain('short');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one signing request between reads of the same file that start together', async () => {
    const reads = await Promise.all([
      service.readableUrl(savannasUrl),
      service.readableUrl(savannasUrl),
    ]);

    expect(reads[0]).toBe(reads[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never gives one signed-in user another user's link", async () => {
    await service.readableUrl(savannasUrl);
    signInAs('other-user');

    await expect(service.readableUrl(savannasUrl)).resolves.toContain('sig2');
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer token-other-user',
    });
  });

  it('asks the signing service again for every download, even with a fresh link on hand', async () => {
    await service.readableUrl(savannasUrl);

    await service.downloadUrl(savannasUrl);
    await service.downloadUrl(savannasUrl);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses without a request when nobody is signed in', async () => {
    firebase.currentUser = null;

    await expect(service.downloadUrl(savannasUrl)).rejects.toMatchObject({
      reason: 'needs-sign-in',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a signing-service refusal into its reason and keeps no link', async () => {
    fetchMock.mockResolvedValueOnce(refusalResponse(403, 'mfa_required'));

    const refusal = await service.readableUrl(savannasUrl).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(PrivateFileRefusal);
    expect(refusal).toMatchObject({ reason: 'needs-authenticator', httpStatus: 403 });
    await expect(service.readableUrl(savannasUrl)).resolves.toContain('sig');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the service as unavailable when the signing request cannot be sent', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(service.downloadUrl(savannasUrl)).rejects.toMatchObject({
      reason: 'service-unavailable',
    });
  });
});

describe('refusalReasonFor', () => {
  it('maps each signing-service refusal to the explanation the layer panel shows', () => {
    expect(refusalReasonFor(401, 'invalid_token')).toBe('needs-sign-in');
    expect(refusalReasonFor(403, 'mfa_required')).toBe('needs-authenticator');
    expect(refusalReasonFor(403, 'layer_forbidden')).toBe('needs-region-access');
    expect(refusalReasonFor(403, 'account_inactive')).toBe('account-inactive');
    expect(refusalReasonFor(404, 'object_not_in_catalog')).toBe('file-unavailable');
    expect(refusalReasonFor(503, 'broker_not_configured')).toBe('service-unavailable');
    expect(refusalReasonFor(500, null)).toBe('service-unavailable');
  });
});

describe('objectKeyFromBucketUrl', () => {
  it('decodes the path after the bucket and drops any query', () => {
    expect(
      objectKeyFromBucketUrl(
        `${bucketUrl}releases/sirap/solutions/Estr17+Cong17%20v2.tif?X-Goog-Signature=abc`,
        bucketUrl,
      ),
    ).toBe('releases/sirap/solutions/Estr17+Cong17 v2.tif');
  });
});
