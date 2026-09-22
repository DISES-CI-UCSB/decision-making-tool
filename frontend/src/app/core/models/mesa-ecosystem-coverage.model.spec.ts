import {
  hydrateMesaEcosystemCoverageRows,
  isMesaEcosystemCoverageCompactDocument,
  resolveMesaEcosystemGeographyIndex,
  type MesaEcosystemCoverageCompactDocument,
} from './mesa-ecosystem-coverage.model';

function buildDocument(): MesaEcosystemCoverageCompactDocument {
  return {
    format: 'mesa-ecosystem-coverage-compact-v1',
    solutionId: 'eco17_estr17_esprep17_runap_iheh2022',
    geographyLevel: 'siraps',
    features: [['Orobioma Andino Cordillera Central', 12, 0.17, 'prioritizr_model']],
    geographies: [['thematic_eje_cafetero_1', 'Eje Cafetero']],
    rowLayout: ['geographyIndex', 'featureIndex', 'totalAmount', 'absoluteHeld', 'relativeHeld'],
    rows: [[0, 0, 6054, 1225, 1225 / 6054]],
  };
}

describe('mesa-ecosystem-coverage.model', () => {
  it('accepts compact v1 documents and hydrates one geography', () => {
    const document = buildDocument();
    expect(isMesaEcosystemCoverageCompactDocument(document)).toBe(true);
    expect(resolveMesaEcosystemGeographyIndex(document, 'eje-cafetero')).toBe(0);
    const [row] = hydrateMesaEcosystemCoverageRows(document, 'eje-cafetero');
    expect(row.feature).toBe('Orobioma Andino Cordillera Central');
    expect(row.relativeHeld).toBeCloseTo(0.202, 3);
    expect(row.met).toBe(true);
  });
});
