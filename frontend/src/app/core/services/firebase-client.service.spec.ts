import { shouldEnsureActiveDirectory } from './firebase-client.service';

describe('shouldEnsureActiveDirectory', () => {
  it('creates a directory row for a new or active account only', () => {
    expect(shouldEnsureActiveDirectory(null)).toBe(true);
    expect(shouldEnsureActiveDirectory('active')).toBe(true);
    expect(shouldEnsureActiveDirectory('denied')).toBe(false);
    expect(shouldEnsureActiveDirectory('pending')).toBe(false);
  });
});
