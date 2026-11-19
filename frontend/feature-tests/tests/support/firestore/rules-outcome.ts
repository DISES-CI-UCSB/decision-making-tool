import { expect } from '@playwright/test';

/** `accepted` when the write succeeded, otherwise the Firestore error code, such as `permission-denied`. */
export async function writeOutcome(write: Promise<unknown>): Promise<string> {
  return write.then(
    () => 'accepted',
    (error: unknown) => (error as { code?: string }).code ?? 'unknown-error',
  );
}

/** The deployed security rules must refuse the write. Any other error is not a rules refusal and fails the test. */
export async function expectRulesRefusal(write: Promise<unknown>): Promise<void> {
  expect(await writeOutcome(write)).toBe('permission-denied');
}

export async function expectRulesAcceptance(write: Promise<unknown>): Promise<void> {
  expect(await writeOutcome(write)).toBe('accepted');
}
