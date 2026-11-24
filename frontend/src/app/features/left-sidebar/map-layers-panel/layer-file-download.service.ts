import { Injectable, inject, signal } from '@angular/core';
import {
  PrivateFileRefusal,
  PrivateLayerFileService,
  type PrivateFileRefusalReason,
} from '@core/services/private-layer-file.service';

export const LAYER_DOWNLOAD_REFUSAL_MESSAGE_KEYS: Readonly<
  Record<PrivateFileRefusalReason, string>
> = {
  'needs-region-access': 'mapLayersPanel.downloadRefusal.needsRegionAccess',
  'needs-authenticator': 'mapLayersPanel.downloadRefusal.needsAuthenticator',
  'needs-sign-in': 'mapLayersPanel.downloadRefusal.needsSignIn',
  'account-inactive': 'mapLayersPanel.downloadRefusal.accountInactive',
  'file-unavailable': 'mapLayersPanel.downloadRefusal.fileUnavailable',
  'service-unavailable': 'mapLayersPanel.downloadRefusal.serviceUnavailable',
};

export function downloadFileName(fileUrl: string): string {
  const path = fileUrl.split(/[?#]/, 1)[0];
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * Saves a layer's source file. Public files download from their own address. Private Layer Bucket files, at most a
 * few megabytes, are read through a fresh signed link and saved from memory; a refusal is kept per layer row so the
 * panel can explain it instead of starting a download.
 */
@Injectable({ providedIn: 'root' })
export class LayerFileDownloadService {
  private readonly privateFiles = inject(PrivateLayerFileService);
  private readonly refusalsByRowId = signal<ReadonlyMap<string, PrivateFileRefusalReason>>(
    new Map(),
  );

  refusalFor(rowId: string): PrivateFileRefusalReason | null {
    return this.refusalsByRowId().get(rowId) ?? null;
  }

  async download(rowId: string, fileUrl: string): Promise<void> {
    this.setRefusal(rowId, null);
    const fileName = downloadFileName(fileUrl);
    if (!this.privateFiles.isPrivateFile(fileUrl)) {
      saveFromAddress(fileUrl, fileName);
      return;
    }
    try {
      // Reading the file first means a failed read shows an explanation instead of a broken download.
      await saveFromFetchedFile(await this.privateFiles.downloadUrl(fileUrl), fileName);
    } catch (error) {
      this.setRefusal(
        rowId,
        error instanceof PrivateFileRefusal ? error.reason : 'service-unavailable',
      );
    }
  }

  private setRefusal(rowId: string, reason: PrivateFileRefusalReason | null): void {
    this.refusalsByRowId.update((refusals) => {
      const next = new Map(refusals);
      if (reason) {
        next.set(rowId, reason);
      } else {
        next.delete(rowId);
      }
      return next;
    });
  }
}

function saveFromAddress(href: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

async function saveFromFetchedFile(href: string, fileName: string): Promise<void> {
  const response = await fetch(href);
  if (!response.ok) {
    throw new PrivateFileRefusal('service-unavailable', response.status);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    saveFromAddress(objectUrl, fileName);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
