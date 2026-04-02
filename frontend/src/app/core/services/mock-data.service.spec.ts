import { TestBed } from '@angular/core/testing';
import { MockDataService } from './mock-data.service';

describe('MockDataService metric contract', () => {
  let service: MockDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MockDataService);
  });

  it('returns status-aware solution metrics with value nullability conventions', () => {
    const response = service.getSolutionMetrics('sol-001');

    expect(response).not.toBeNull();
    if (!response) {
      return;
    }

    expect(response.metrics.length).toBeGreaterThan(0);
    for (const metric of response.metrics) {
      if (metric.status === 'ready') {
        expect(metric.value).not.toBeNull();
      } else {
        expect(metric.value).toBeNull();
      }
    }
  });

  it('returns comparison payload using canonical compare response shape', () => {
    const response = service.compareSolutions('sol-001', 'sol-002');

    expect(response).not.toBeNull();
    if (!response) {
      return;
    }

    expect(response.baselineSolutionId).toBe('sol-001');
    expect(response.candidateSolutionId).toBe('sol-002');
    expect(Array.isArray(response.metrics)).toBe(true);
    expect(response.metrics.length).toBeGreaterThan(0);
  });

  it('returns ANL fixtures grouped by section', () => {
    const fixtures = service.getAnalysisMetricFixtures('sol-001');

    expect(fixtures).not.toBeNull();
    if (!fixtures) {
      return;
    }

    expect(fixtures.sections.length).toBe(3);
    expect(fixtures.sections[0].sectionId).toBe('ecology');
  });
});
