/** Public file bucket. Addresses built from this constant are born here. The bucket name is part of the path. */
export const PUBLIC_BLOB_HOST =
  'https://storage.googleapis.com/pnn-priorizando-la-naturaleza-public';

/** Previous public host. Request-time swap rewrites an address only when it starts with this. */
export const VERCEL_BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';

export const RUNTIME_MANIFEST_BLOB_PATHNAME = 'manifest/manifest.json';
export const RUNTIME_MANIFEST_BLOB_URL = `${PUBLIC_BLOB_HOST}/${RUNTIME_MANIFEST_BLOB_PATHNAME}`;

export const RUNTIME_CATALOG_RELEASE_INDEX_PATHNAME =
  'catalog-releases/3.7.1/catalog-release-index.json';
export const RUNTIME_CATALOG_RELEASE_INDEX_BLOB_URL = `${PUBLIC_BLOB_HOST}/${RUNTIME_CATALOG_RELEASE_INDEX_PATHNAME}`;

export const LOCAL_RUNTIME_MANIFEST_PUBLIC_PATH = '/data/layer-manifest/manifest.json';
export const LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH = 'public/data/layer-manifest/manifest.json';
