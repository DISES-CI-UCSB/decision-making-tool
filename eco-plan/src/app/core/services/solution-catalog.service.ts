import { Injectable } from '@angular/core';
import type { SolutionScenario } from '@core/models/solution-scenario.model';

const BASE_PATH = '/data/solutions';

/**
 * Catalog of real prioritizr solution scenarios derived from
 * data/Nacional_1km_solutions/master_eval_summary.csv.
 */
@Injectable({ providedIn: 'root' })
export class SolutionCatalogService {
  private readonly scenarios: SolutionScenario[] = [
    this.scenario('Ecos17+RUNAP_HF', 17, ['RUNAP'], 'Human Footprint', 226225, 665400),
    this.scenario(
      'Ecos17+RUNAP_HF_comunidades',
      17,
      ['RUNAP', 'Comunidades'],
      'Human Footprint',
      618026,
      725538,
    ),
    this.scenario('Ecos17+RUNAP_CO', 17, ['RUNAP'], 'Carbon Opportunity', 226225, 1.51e12),
    this.scenario(
      'Ecos17+RUNAP_comunidades_CO',
      17,
      ['RUNAP', 'Comunidades'],
      'Carbon Opportunity',
      618026,
      2.19e12,
    ),
    this.scenario(
      'Ecos17+RUNAP+OMEC_HF',
      17,
      ['RUNAP', 'OMECs'],
      'Human Footprint',
      339883,
      7857664.19,
    ),
    this.scenario(
      'Ecos17+RUNAP+OMEC_CO',
      17,
      ['RUNAP', 'OMECs'],
      'Carbon Opportunity',
      341584,
      6.76e12,
    ),
    this.scenario(
      'Ecos17+RUNAP_CONFLICTO',
      17,
      ['RUNAP'],
      'Conflict (Coca/Deaths)',
      226225,
      665902,
    ),
    this.scenario('Ecos30+RUNAP_HF', 30, ['RUNAP'], 'Human Footprint', 387656, 689948),
    this.scenario(
      'Ecos30+RUNAP_HF_comunidades',
      30,
      ['RUNAP', 'Comunidades'],
      'Human Footprint',
      614971,
      5530905.343,
    ),
    this.scenario('Ecos30+RUNAP_CO', 30, ['RUNAP'], 'Carbon Opportunity', 369102, 1.61e12),
    this.scenario(
      'Ecos30+RUNAP+OMEC_HF',
      30,
      ['RUNAP', 'OMECs'],
      'Human Footprint',
      387656,
      7989322.192,
    ),
    this.scenario(
      'Ecos30+RUNAP+OMEC_CO',
      30,
      ['RUNAP', 'OMECs'],
      'Carbon Opportunity',
      389568,
      6.77e12,
    ),
    this.scenario(
      'Ecos30+RUNAP_CONFLICTO',
      30,
      ['RUNAP'],
      'Conflict (Coca/Deaths)',
      437610,
      74278.08,
    ),
    this.scenario('ESTR30+RUNAP_HF', 30, ['RUNAP'], 'Human Footprint', 404519, 3585849.234, true),
  ];

  getAll(): SolutionScenario[] {
    return this.scenarios;
  }

  getById(id: string): SolutionScenario | null {
    return this.scenarios.find((s) => s.id === id) ?? null;
  }

  getTifUrl(scenario: SolutionScenario): string {
    return `${BASE_PATH}/${scenario.filename}`;
  }

  private scenario(
    filenameBase: string,
    ecoTargets: number,
    constraints: string[],
    costLayer: string,
    nSelected: number,
    totalCost: number,
    isStrategic = false,
  ): SolutionScenario {
    const targetLabel = isStrategic ? 'strategic ecosystems' : 'ecosystem types';
    const constraintLabel = constraints.join(' + ');
    return {
      id: filenameBase,
      filename: `${filenameBase}.tif`,
      name: filenameBase.replace(/[+_]/g, ' '),
      description: `${ecoTargets}% target for ${targetLabel}, ${constraintLabel} locked-in, ${costLayer} cost`,
      ecosystemTargets: ecoTargets,
      constraints,
      costLayer,
      nSelected,
      totalCost,
      pctTargetsMet: 100,
    };
  }
}
