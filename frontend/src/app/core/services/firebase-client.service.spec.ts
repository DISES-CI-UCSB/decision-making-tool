import { type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  type Auth,
  type GoogleAuthProvider,
  type User,
  type UserCredential,
} from 'firebase/auth';
import {
  browserAuthSettings,
  createGoogleSelectAccountProvider,
  initializeBrowserAuth,
  isAuthAlreadyInitialized,
  reauthenticateWithGoogleSelectAccountPopup,
  shouldEnsureActiveDirectory,
  signInWithGoogleSelectAccountPopup,
} from './firebase-client.service';

describe('shouldEnsureActiveDirectory', () => {
  it('creates a directory row for a new or active account only', () => {
    expect(shouldEnsureActiveDirectory(null)).toBe(true);
    expect(shouldEnsureActiveDirectory('active')).toBe(true);
    expect(shouldEnsureActiveDirectory('denied')).toBe(false);
    expect(shouldEnsureActiveDirectory('pending')).toBe(false);
  });
});

describe('browser Auth persistence', () => {
  it('uses IndexedDB local persistence with browser local and session fallback', () => {
    const settings = browserAuthSettings();
    expect(settings.persistence).toEqual([
      indexedDBLocalPersistence,
      browserLocalPersistence,
      browserSessionPersistence,
    ]);
    expect(settings.popupRedirectResolver).toBe(browserPopupRedirectResolver);
  });

  it('reuses the existing Auth instance when initializeAuth already ran', () => {
    const existing = { name: 'existing-auth' } as Auth;
    const initializeAuth = vi.fn(() => {
      throw { code: 'auth/already-initialized' };
    });
    const getAuth = vi.fn(() => existing);

    expect(isAuthAlreadyInitialized({ code: 'auth/already-initialized' })).toBe(true);
    expect(initializeBrowserAuth({} as FirebaseApp, { initializeAuth, getAuth })).toBe(existing);
    expect(initializeAuth).toHaveBeenCalledOnce();
    expect(getAuth).toHaveBeenCalledOnce();
  });
});

describe('Google popup sign-in', () => {
  const credential = {
    user: { uid: 'google-user', email: 'ada@example.com' },
  } as UserCredential;

  function fakeProvider(): GoogleAuthProvider {
    return { setCustomParameters: vi.fn() } as unknown as GoogleAuthProvider;
  }

  function popupAuthApi(overrides: Record<string, unknown> = {}) {
    const provider = fakeProvider();
    return {
      provider,
      signInWithPopup: vi.fn(async () => credential),
      signOut: vi.fn(async () => undefined),
      createProvider: vi.fn(() => provider),
      ...overrides,
    };
  }

  async function withGuardedConsole<T>(run: () => Promise<T>): Promise<{
    value: T;
    consoleText: string;
  }> {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const value = await run();
      return {
        value,
        consoleText: [
          ...info.mock.calls,
          ...warn.mock.calls,
          ...log.mock.calls,
          ...error.mock.calls,
        ]
          .map((call) => call.map(String).join(' '))
          .join('\n'),
      };
    } finally {
      info.mockRestore();
      warn.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  }

  function expectNoSecrets(consoleText: string): void {
    expect(consoleText).not.toContain('google-user');
    expect(consoleText).not.toContain('ada@example.com');
  }

  it('asks Google to select an account', () => {
    const setCustomParameters = vi.fn();
    const created = createGoogleSelectAccountProvider(
      () => ({ setCustomParameters }) as unknown as GoogleAuthProvider,
    );

    expect(setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(created).toEqual({ setCustomParameters });
  });

  it('signs out a leftover current user before the Google popup', async () => {
    const auth = { currentUser: { uid: 'leftover' } } as Auth;
    const api = popupAuthApi();

    await expect(signInWithGoogleSelectAccountPopup(auth, api)).resolves.toBe(credential);
    expect(api.signOut).toHaveBeenCalledWith(auth);
    expect(api.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      api.signInWithPopup.mock.invocationCallOrder[0],
    );
    expect(api.provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(api.signInWithPopup).toHaveBeenCalledWith(auth, api.provider);
  });

  it('does not sign out when the Google popup has no leftover session', async () => {
    const auth = { currentUser: null } as Auth;
    const api = popupAuthApi();

    await signInWithGoogleSelectAccountPopup(auth, api);
    expect(api.signOut).not.toHaveBeenCalled();
    expect(api.signInWithPopup).toHaveBeenCalledWith(auth, api.provider);
  });

  it('returns the popup result without a second identity-provider call', async () => {
    const auth = { currentUser: null } as Auth;
    const reauthenticateWithPopup = vi.fn();
    const api = popupAuthApi({ reauthenticateWithPopup });

    const finished = await withGuardedConsole(() => signInWithGoogleSelectAccountPopup(auth, api));

    expect(finished.value).toBe(credential);
    expect(api.signInWithPopup).toHaveBeenCalledOnce();
    expect(reauthenticateWithPopup).not.toHaveBeenCalled();
    expectNoSecrets(finished.consoleText);
  });

  it('preserves MFA error identity from the popup', async () => {
    const auth = { currentUser: null } as Auth;
    const mfaError = {
      code: 'auth/multi-factor-auth-required',
      customData: { email: 'ada@example.com' },
    };
    const api = popupAuthApi({
      signInWithPopup: vi.fn(async () => {
        throw mfaError;
      }),
    });

    const finished = await withGuardedConsole(async () => {
      await expect(signInWithGoogleSelectAccountPopup(auth, api)).rejects.toBe(mfaError);
    });

    expect(api.signInWithPopup).toHaveBeenCalledOnce();
    expectNoSecrets(finished.consoleText);
  });

  it('reauthenticates with the same select-account provider and does not sign out', async () => {
    const user = { uid: 'enrolling-user' } as User;
    const reauthenticateWithPopup = vi.fn(async () => credential);
    const provider = fakeProvider();
    const createProvider = vi.fn(() => provider);

    await expect(
      reauthenticateWithGoogleSelectAccountPopup(user, {
        reauthenticateWithPopup,
        createProvider,
      }),
    ).resolves.toBe(credential);
    expect(reauthenticateWithPopup).toHaveBeenCalledWith(user, provider);
    expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(createProvider).toHaveBeenCalledOnce();
  });
});
