import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The frontend is a separate repository. Local-preview outputs and frontend source reads
// target a sibling checkout unless DMT_FRONTEND_DIR points somewhere else.
export const frontendRoot = process.env.DMT_FRONTEND_DIR
  ? path.resolve(process.env.DMT_FRONTEND_DIR)
  : path.resolve(backendRoot, '../frontend');
