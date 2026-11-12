import type { AuthProvider, User, UserCredential, reauthenticateWithCredential } from 'firebase/auth';
import { testReauthentication } from './test-sign-in-hook.e2e';
import { testReauthentication as productionStubReauthentication } from './test-sign-in-hook';

describe('Test Sign-In Hook re-authentication', () => {
  const testWindow = window as { __dmtTestSignIn?: { email: string; password: string } };
  const disposableEmail = 'dmt-test-0123456789abcdef@dmt-test.invalid';
  const user = { uid: 'enrolling-user' } as User;
  const credential = { user } as UserCredential;
  const googleProvider = {} as AuthProvider;

  afterEach(() => {
    delete testWindow.__dmtTestSignIn;
    vi.restoreAllMocks();
  });

  it('re-authenticates a disposable account on this machine with its email and password', async () => {
    expect(location.hostname).toBe('localhost');
    testWindow.__dmtTestSignIn = { email: disposableEmail, password: 'test-only-password' };
    const reauthenticateWithEmail = vi.fn<typeof reauthenticateWithCredential>(async () => credential);

    const reauthenticate = testReauthentication({ reauthenticateWithCredential: reauthenticateWithEmail });

    expect(reauthenticate).not.toBeNull();
    await expect(reauthenticate?.(user, googleProvider)).resolves.toBe(credential);
    expect(reauthenticateWithEmail).toHaveBeenCalledOnce();
    const [reauthenticatedUser, emailCredential] = reauthenticateWithEmail.mock.calls[0];
    expect(reauthenticatedUser).toBe(user);
    expect(emailCredential.providerId).toBe('password');
    expect(emailCredential.toJSON()).toMatchObject({ email: disposableEmail });
  });

  it('leaves re-authentication to Google when no test credentials were provided', () => {
    const reauthenticateWithEmail = vi.fn<typeof reauthenticateWithCredential>();

    expect(testReauthentication({ reauthenticateWithCredential: reauthenticateWithEmail })).toBeNull();
    expect(reauthenticateWithEmail).not.toHaveBeenCalled();
  });

  it('refuses a non-disposable email and leaves re-authentication to Google', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    testWindow.__dmtTestSignIn = { email: 'ada@example.com', password: 'test-only-password' };
    const reauthenticateWithEmail = vi.fn<typeof reauthenticateWithCredential>();

    expect(testReauthentication({ reauthenticateWithCredential: reauthenticateWithEmail })).toBeNull();
    expect(reauthenticateWithEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('production stub never re-authenticates through the hook, even with test credentials present', () => {
    testWindow.__dmtTestSignIn = { email: disposableEmail, password: 'test-only-password' };

    expect(productionStubReauthentication()).toBeNull();
  });
});
