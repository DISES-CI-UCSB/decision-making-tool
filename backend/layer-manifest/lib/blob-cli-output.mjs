export function parseBlobListOutput(output) {
  const blobs = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim().replaceAll('│', ' ').replaceAll('|', ' ').trim();
    if (!trimmed || trimmed.startsWith('Vercel CLI') || trimmed.startsWith('Fetching blobs')) {
      continue;
    }
    if (trimmed.startsWith('Uploaded At') || trimmed.startsWith('> To display')) {
      continue;
    }

    // Older CLI versions emitted raw byte counts. Current versions include an
    // ISO upload timestamp plus a human-readable byte count (for example
    // `1.24 MB`) in a Unicode table.
    const match = trimmed.match(
      /^\S+\s+(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?\s+(\S+)\s+(https:\/\/\S+)$/,
    );
    if (!match) {
      continue;
    }

    blobs.push({
      bytes: parseBlobSize(match[1], match[2]),
      pathname: match[3],
      url: match[4],
    });
  }

  return blobs;
}

function parseBlobSize(value, unit) {
  const multipliers = {
    B: 1,
    KB: 1_000,
    MB: 1_000_000,
    GB: 1_000_000_000,
    TB: 1_000_000_000_000,
  };
  return Math.round(Number(value) * (multipliers[unit ?? 'B'] ?? 1));
}

export function extractBlobCliUrl(output) {
  return output.match(/https:\/\/\S+/)?.[0] ?? null;
}

export function parseBlobListCursor(output) {
  return output.match(/--cursor\s+([^\s`]+)/)?.[1] ?? null;
}
