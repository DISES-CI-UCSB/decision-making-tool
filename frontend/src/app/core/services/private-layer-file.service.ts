import { Injectable, inject } from '@angular/core';
import esriConfig from '@arcgis/core/config';
import { environment } from '../../../environments/environment';
import { FirebaseClientService } from './firebase-client.service';

/** Why the Blob URL Signing Service gave no link, in the terms the layer panel explains to the person. */
export type PrivateFileRefusalReason =
  | 'needs-region-access'
  | 'needs-authenticator'
  | 'needs-sign-in'
  | 'account-inactive'
  | 'file-unavailable'
  | 'service-unavailable';

export class PrivateFileRefusal extends Error {
  constructor(
    readonly reason: PrivateFileRefusalReason,
    readonly httpStatus: number | null,
  ) {
    super(`No signed link for the file (${reason}${httpStatus ? `, HTTP ${httpStatus}` : ''}).`);
  }
}

interface SignedLink {
  uid: string;
  url: string;
  /** After this, the link is replaced before use, so a read never leaves with an expired link. */
  renewAtMs: number;
}

/** How long before expiry a link is renewed. A link shorter than 8 minutes renews a quarter of its life early instead. */
export const SIGNED_LINK_REFRESH_MARGIN_MS = 2 * 60_000;

function renewalTime(receivedAtMs: number, expiresAtMs: number): number {
  const lifeMs = expiresAtMs - receivedAtMs;
  return expiresAtMs - Math.min(SIGNED_LINK_REFRESH_MARGIN_MS, lifeMs / 4);
}

export function refusalReasonFor(
  httpStatus: number,
  status: string | null,
): PrivateFileRefusalReason {
  if (httpStatus === 401) return 'needs-sign-in';
  if (status === 'mfa_required') return 'needs-authenticator';
  if (status === 'layer_forbidden') return 'needs-region-access';
  if (status === 'account_inactive') return 'account-inactive';
  if (status === 'object_not_in_catalog') return 'file-unavailable';
  return 'service-unavailable';
}

/** The bucket object key of a Private Layer Bucket address, decoded the way the signing service expects it. */
export function objectKeyFromBucketUrl(url: string, bucketUrl: string): string {
  const path = url.slice(bucketUrl.length).split(/[?#]/, 1)[0];
  return path.split('/').map(decodeURIComponent).join('/');
}

/**
 * Makes Private Layer Bucket files readable in the browser. The Runtime Catalog keeps each file's plain bucket
 * address; every read swaps it for a short-lived signed link from the Blob URL Signing Service, sent through the
 * same-origin private file proxy unless `privateFileProxyPath` is empty.
 */
@Injectable({ providedIn: 'root' })
export class PrivateLayerFileService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly bucketUrl = environment.privateLayerBucketUrl;
  private readonly proxyPath = environment.privateFileProxyPath;
  private readonly signingServiceUrl = `${environment.metricsApiBaseUrl.replace(/\/$/, '')}/downloads/signed-url`;
  private readonly linksByObjectKey = new Map<string, SignedLink>();
  private readonly pendingLinksByObjectKey = new Map<string, Promise<SignedLink>>();

  isPrivateFile(url: string): boolean {
    return Boolean(this.bucketUrl) && url.startsWith(this.bucketUrl);
  }

  /** A browser-readable address for a map or metrics read. Reuses the file's signed link until it nears expiry. */
  async readableUrl(url: string): Promise<string> {
    if (!this.isPrivateFile(url)) {
      return url;
    }
    const link = await this.currentLink(objectKeyFromBucketUrl(url, this.bucketUrl));
    return this.browserUrl(link.url);
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(await this.readableUrl(url), init);
  }

  /** A fresh browser-readable link for one download. Every call asks the signing service, so a refusal is current. */
  async downloadUrl(url: string): Promise<string> {
    const link = await this.requestSignedLink(objectKeyFromBucketUrl(url, this.bucketUrl));
    return this.browserUrl(link.url);
  }

  /** Routes ArcGIS layer requests, including those its workers hand back to the page, through signed links. */
  registerMapRequestInterceptor(): void {
    if (!this.bucketUrl) {
      return;
    }
    esriConfig.request.interceptors ??= [];
    // ArcGIS applies only the first interceptor whose `urls` match.
    esriConfig.request.interceptors.unshift({
      urls: this.bucketUrl,
      before: async (params: { url: string }) => {
        params.url = await this.readableUrl(params.url);
      },
    });
  }

  private currentLink(objectKey: string): Promise<SignedLink> {
    const uid = this.firebase.currentUser?.uid ?? null;
    const cached = this.linksByObjectKey.get(objectKey);
    if (cached && cached.uid === uid && Date.now() < cached.renewAtMs) {
      return Promise.resolve(cached);
    }
    const pendingKey = `${uid}\n${objectKey}`;
    let pending = this.pendingLinksByObjectKey.get(pendingKey);
    if (!pending) {
      pending = this.requestSignedLink(objectKey)
        .then((link) => {
          this.linksByObjectKey.set(objectKey, link);
          return link;
        })
        .finally(() => this.pendingLinksByObjectKey.delete(pendingKey));
      this.pendingLinksByObjectKey.set(pendingKey, pending);
    }
    return pending;
  }

  private async requestSignedLink(objectKey: string): Promise<SignedLink> {
    const user = this.firebase.currentUser;
    if (!user) {
      throw new PrivateFileRefusal('needs-sign-in', null);
    }
    let response: Response;
    try {
      response = await fetch(this.signingServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ object_name: objectKey }),
      });
    } catch {
      throw new PrivateFileRefusal('service-unavailable', null);
    }
    if (!response.ok) {
      throw new PrivateFileRefusal(
        refusalReasonFor(response.status, await readRefusalStatus(response)),
        response.status,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      url?: unknown;
      expires_at?: unknown;
    } | null;
    if (typeof body?.url !== 'string' || !this.isPrivateFile(body.url)) {
      throw new PrivateFileRefusal('service-unavailable', response.status);
    }
    const expiresAtMs =
      typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : Number.NaN;
    return {
      uid: user.uid,
      url: body.url,
      // Without a readable expiry the link is used once and never reused.
      renewAtMs: Number.isFinite(expiresAtMs) ? renewalTime(Date.now(), expiresAtMs) : 0,
    };
  }

  private browserUrl(signedUrl: string): string {
    if (!this.proxyPath) {
      return signedUrl;
    }
    const proxyPath = this.proxyPath.endsWith('/') ? this.proxyPath : `${this.proxyPath}/`;
    return `${globalThis.location.origin}${proxyPath}${signedUrl.slice(this.bucketUrl.length)}`;
  }
}

async function readRefusalStatus(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { detail?: { status?: unknown } } | null;
    return typeof body?.detail?.status === 'string' ? body.detail.status : null;
  } catch {
    return null;
  }
}
