import { shouldDenyRequestHistoryOnRevoke } from './sirap-access.service';

describe('SirapAccessService revoke history', () => {
  it('does not require a request document to revoke an authoritative user grant', () => {
    expect(shouldDenyRequestHistoryOnRevoke(null)).toBe(false);
  });

  it('marks approved request history denied when a matching document exists', () => {
    expect(shouldDenyRequestHistoryOnRevoke({ status: 'approved' })).toBe(true);
    expect(shouldDenyRequestHistoryOnRevoke({ status: 'pending' })).toBe(false);
  });
});
