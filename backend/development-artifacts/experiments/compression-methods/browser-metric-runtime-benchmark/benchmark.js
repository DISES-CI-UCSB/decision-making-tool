#!/usr/bin/env node
/* Benchmark browser-style decode, AOI masking, and metric summaries in Node.js.
 *
 * This intentionally uses only built-in Node APIs so it stays close to what a
 * browser implementation would do with DecompressionStream + typed arrays.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '../../../..');
const ARTIFACT_DIR = path.join(__dirname, 'artifacts');
const MANIFEST_PATH = path.join(ARTIFACT_DIR, 'manifest.json');

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function readArtifact(relativePath) {
  return fs.readFileSync(path.join(ARTIFACT_DIR, relativePath));
}

function gunzip(buffer) {
  return zlib.gunzipSync(buffer);
}

function typedArrayFromBuffer(buffer, dtype) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  switch (dtype) {
    case 'uint8':
      return new Uint8Array(arrayBuffer);
    case 'int16':
      return new Int16Array(arrayBuffer);
    case 'uint16':
      return new Uint16Array(arrayBuffer);
    case 'int32':
      return new Int32Array(arrayBuffer);
    case 'uint32':
      return new Uint32Array(arrayBuffer);
    case 'float32':
      return new Float32Array(arrayBuffer);
    case 'float64':
      return new Float64Array(arrayBuffer);
    default:
      throw new Error(`Unsupported dtype: ${dtype}`);
  }
}

function uint32ArrayFromGzip(buffer) {
  return typedArrayFromBuffer(gunzip(buffer), 'uint32');
}

function cumsumUint32(deltas) {
  const indices = new Uint32Array(deltas.length);
  let total = 0;
  for (let i = 0; i < deltas.length; i += 1) {
    total = (total + deltas[i]) >>> 0;
    indices[i] = total;
  }
  return indices;
}

function isValidValue(value, nodata) {
  if (!Number.isFinite(value)) return false;
  if (Math.abs(value) >= 1e20) return false;
  if (nodata !== null && nodata !== undefined && value === nodata) return false;
  return true;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function createPolygonMask(width, height) {
  // Normalized polygon covering a moderate, irregular AOI-like area.
  const polygon = [
    [0.28, 0.2],
    [0.62, 0.17],
    [0.78, 0.42],
    [0.68, 0.76],
    [0.38, 0.82],
    [0.2, 0.55],
  ];
  const mask = new Uint8Array(width * height);
  let selected = 0;
  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      if (pointInPolygon(nx, ny, polygon)) {
        mask[y * width + x] = 1;
        selected += 1;
      }
    }
  }
  return { mask, selected };
}

function getMask(maskCache, width, height) {
  const key = `${width}x${height}`;
  if (maskCache.has(key)) return maskCache.get(key);
  const start = performance.now();
  const result = createPolygonMask(width, height);
  result.elapsedMs = performance.now() - start;
  maskCache.set(key, result);
  return result;
}

function loadLayerPayload(layer) {
  switch (layer.encoding) {
    case 'raw_array_gzip':
      return {
        ...layer,
        arrayBuffer: readArtifact(layer.files.array),
      };
    case 'nonzero_index_value_gzip':
      return {
        ...layer,
        indexDeltasBuffer: readArtifact(layer.files.indexDeltas),
        valuesBuffer: readArtifact(layer.files.values),
      };
    case 'by_value_delta_gzip':
      return {
        ...layer,
        values: layer.values.map((entry) => ({
          ...entry,
          indexDeltasBuffer: readArtifact(entry.indexDeltas),
        })),
      };
    default:
      throw new Error(`Unsupported layer encoding: ${layer.encoding}`);
  }
}

function queryLayer(layer, mask) {
  let sum = 0;
  let count = 0;

  if (layer.encoding === 'raw_array_gzip') {
    const values = typedArrayFromBuffer(gunzip(layer.arrayBuffer), layer.dtype);
    for (let i = 0; i < values.length; i += 1) {
      if (mask[i] && isValidValue(values[i], layer.nodata)) {
        sum += values[i];
        count += 1;
      }
    }
    return { sum, count };
  }

  if (layer.encoding === 'nonzero_index_value_gzip') {
    const deltas = uint32ArrayFromGzip(layer.indexDeltasBuffer);
    const indices = cumsumUint32(deltas);
    const values = typedArrayFromBuffer(gunzip(layer.valuesBuffer), layer.dtype);
    for (let i = 0; i < indices.length; i += 1) {
      if (mask[indices[i]]) {
        sum += values[i];
        count += 1;
      }
    }
    return { sum, count };
  }

  if (layer.encoding === 'by_value_delta_gzip') {
    for (const entry of layer.values) {
      const deltas = uint32ArrayFromGzip(entry.indexDeltasBuffer);
      const indices = cumsumUint32(deltas);
      let hits = 0;
      for (let i = 0; i < indices.length; i += 1) {
        if (mask[indices[i]]) hits += 1;
      }
      sum += entry.value * hits;
      count += hits;
    }
    return { sum, count };
  }

  throw new Error(`Unsupported encoding: ${layer.encoding}`);
}

function loadSpeciesPayload(speciesManifest) {
  return {
    ...speciesManifest,
    species: speciesManifest.species.map((entry) => ({
      ...entry,
      indexDeltasBuffer: readArtifact(entry.indexDeltas),
    })),
  };
}

function querySpecies(speciesPayload, mask) {
  let presentSpecies = 0;
  let totalHits = 0;
  const byTaxon = new Map();
  const threatened = new Set(['CR', 'EN', 'VU']);
  let threatenedPresent = 0;
  let endemicPresent = 0;

  for (const species of speciesPayload.species) {
    const deltas = uint32ArrayFromGzip(species.indexDeltasBuffer);
    const indices = cumsumUint32(deltas);
    let hits = 0;
    for (let i = 0; i < indices.length; i += 1) {
      if (mask[indices[i]]) hits += 1;
    }
    if (hits > 0) {
      presentSpecies += 1;
      totalHits += hits;
      byTaxon.set(species.taxonClass, (byTaxon.get(species.taxonClass) ?? 0) + 1);
      if (threatened.has(species.threatStatus)) threatenedPresent += 1;
      if (species.endemicStatus) endemicPresent += 1;
    }
  }

  return {
    presentSpecies,
    totalHits,
    threatenedPresent,
    endemicPresent,
    byTaxon: Object.fromEntries(byTaxon.entries()),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runTimed(label, fn, iterations = 5) {
  const times = [];
  let lastResult = null;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    lastResult = fn();
    times.push(performance.now() - start);
  }
  return {
    label,
    minMs: Math.min(...times),
    medianMs: median(times),
    maxMs: Math.max(...times),
    lastResult,
  };
}

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function main() {
  const manifest = readManifest();
  const loadStart = performance.now();
  const layers = manifest.layers.map(loadLayerPayload);
  const species = loadSpeciesPayload(manifest.species);
  const loadMs = performance.now() - loadStart;

  const maskCache = new Map();
  for (const layer of layers) getMask(maskCache, layer.width, layer.height);
  getMask(maskCache, species.width, species.height);

  const layerTimings = [];
  for (const layer of layers) {
    const { mask } = getMask(maskCache, layer.width, layer.height);
    layerTimings.push(runTimed(layer.layerId, () => queryLayer(layer, mask), 5));
  }

  const speciesMask = getMask(maskCache, species.width, species.height).mask;
  const speciesTiming = runTimed('species-threatened-endemic', () => querySpecies(species, speciesMask), 5);

  const payloadBytes = manifest.totals.allPayloadBytes;
  const result = {
    payloadMb: Number(formatMb(payloadBytes)),
    readPayloadFromDiskMs: loadMs,
    masks: Object.fromEntries(
      Array.from(maskCache.entries()).map(([key, value]) => [
        key,
        { selectedCells: value.selected, createMaskMs: value.elapsedMs },
      ]),
    ),
    layerTimings,
    speciesTiming,
    totalMedianQueryMs:
      layerTimings.reduce((sum, timing) => sum + timing.medianMs, 0) + speciesTiming.medianMs,
  };

  console.log(JSON.stringify(result, null, 2));
  console.log('\nSummary');
  console.log(`Payload: ${formatMb(payloadBytes)} MB`);
  console.log(`Read artifact buffers from disk: ${loadMs.toFixed(2)} ms`);
  for (const [key, value] of maskCache.entries()) {
    console.log(
      `Create polygon mask ${key}: ${value.elapsedMs.toFixed(2)} ms (${value.selected.toLocaleString()} cells)`,
    );
  }
  console.log(`Layer median query total: ${layerTimings.reduce((s, t) => s + t.medianMs, 0).toFixed(2)} ms`);
  console.log(`Species median query: ${speciesTiming.medianMs.toFixed(2)} ms`);
  console.log(`Total median query estimate: ${result.totalMedianQueryMs.toFixed(2)} ms`);
}

main();
