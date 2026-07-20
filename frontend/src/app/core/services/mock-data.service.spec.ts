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
});
