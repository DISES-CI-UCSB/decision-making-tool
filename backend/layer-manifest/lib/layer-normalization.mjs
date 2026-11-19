import path from 'node:path';

export function toLayerId(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function toBlobPath(storageLocation, filename) {
  if (!storageLocation || /^https?:\/\//i.test(storageLocation)) {
    return null;
  }

  const paths = storageLocation
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = paths.find((entry) => {
    const lowerEntry = entry.toLowerCase();
    return lowerEntry.includes('data/inputs/') || lowerEntry.includes('data/boundaries/');
  });

  if (!candidate) {
    return null;
  }
  if (candidate.endsWith('/') || path.posix.extname(candidate)) {
    return candidate.replace(/^data\//, '');
  }
  if (filename && filename.toLowerCase() !== 'na') {
    return `${candidate.replace(/\/+$/, '')}/${filename}`.replace(/^data\//, '');
  }
  return candidate.replace(/^data\//, '');
}
