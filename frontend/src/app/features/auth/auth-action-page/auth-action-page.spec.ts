import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import {
  AUTH_ACTION_COPY,
  AuthActionPageComponent,
  authActionErrorFor,
  resolveAuthActionMode,
  safeContinueHref,
  type AuthActionMode,
} from './auth-action-page';

const OOB_CODE = 'secret-oob-code-123';
const API_KEY = 'secret-api-key-456';

interface FakeFirebase {
  applyActionCode: ReturnType<typeof vi.fn>;
  checkActionCode: ReturnType<typeof vi.fn>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function render(
  params: Record<string, string>,
  firebase: Partial<FakeFirebase> = {},
): Promise<{
  fixture: ComponentFixture<AuthActionPageComponent>;
  firebase: FakeFirebase;
  el: HTMLElement;
}> {
  const fake: FakeFirebase = {
    applyActionCode: vi.fn(async () => undefined),
    checkActionCode: vi.fn(async () => ({ operation: 'RECOVER_EMAIL', data: {} })),
    ...firebase,
  };
  await TestBed.configureTestingModule({
    imports: [AuthActionPageComponent],
    providers: [
      { provide: FirebaseClientService, useValue: fake },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(params) } },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AuthActionPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, firebase: fake, el: fixture.nativeElement as HTMLElement };
}

function linkParams(mode: string): Record<string, string> {
  return { mode, oobCode: OOB_CODE, apiKey: API_KEY, lang: 'en' };
}

async function clickConfirm(fixture: ComponentFixture<AuthActionPageComponent>): Promise<void> {
  (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('#auth-action-confirm-btn')
    ?.click();
  await fixture.whenStable();
  fixture.detectChanges();
}

const CONFIRMABLE_MODES: AuthActionMode[] = [
  'revertSecondFactorAddition',
  'verifyEmail',
  'recoverEmail',
  'verifyAndChangeEmail',
];

describe('AuthActionPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe.each([...CONFIRMABLE_MODES, 'resetPassword', 'unknownMode'])('on load (%s)', (mode) => {
    it('makes no Firebase call before a click', async () => {
      const { firebase } = await render(linkParams(mode));
      expect(firebase.applyActionCode).not.toHaveBeenCalled();
      expect(firebase.checkActionCode).not.toHaveBeenCalled();
    });
  });

  it.each(CONFIRMABLE_MODES)('shows the %s copy and button', async (mode) => {
    const { el } = await render(linkParams(mode));
    expect(el.querySelector('#auth-action-title')?.textContent).toContain(
      AUTH_ACTION_COPY[mode].title,
    );
    const button = el.querySelector<HTMLButtonElement>('#auth-action-confirm-btn');
    expect(button?.type).toBe('button');
    expect(button?.textContent).toContain(AUTH_ACTION_COPY[mode].buttonLabel);
  });

  it('warns revert visitors to continue only if they did not add the authenticator', async () => {
    const { el } = await render(linkParams('revertSecondFactorAddition'));
    expect(el.querySelector('h1')?.textContent).toContain('Remove 2-step verification?');
    expect(el.querySelector('#auth-action-description')?.textContent).toContain(
      'signs you out on every device',
    );
    expect(el.querySelector('#auth-action-warning')?.textContent).toContain(
      'did not add an authenticator',
    );
  });

  it.each(['revertSecondFactorAddition', 'verifyEmail', 'verifyAndChangeEmail'])(
    'applies the %s code exactly once on click and shows success',
    async (mode) => {
      const { fixture, firebase, el } = await render(linkParams(mode));
      await clickConfirm(fixture);

      expect(firebase.applyActionCode).toHaveBeenCalledTimes(1);
      expect(firebase.applyActionCode).toHaveBeenCalledWith(OOB_CODE);
      expect(firebase.checkActionCode).not.toHaveBeenCalled();
      expect(el.querySelector('#auth-action-success')?.textContent).toContain(
        AUTH_ACTION_COPY[mode as AuthActionMode].successMessage,
      );
      expect(el.querySelector('#auth-action-confirm-btn')).toBeNull();
    },
  );

  it('shows the revert success copy with a link back to the app', async () => {
    const { fixture, el } = await render(linkParams('revertSecondFactorAddition'));
    await clickConfirm(fixture);
    expect(el.querySelector('#auth-action-success')?.textContent).toContain(
      'Two-step verification was removed. Sign in again to set it up.',
    );
    expect(el.querySelector('#auth-action-return-link')?.getAttribute('href')).toBe('/');
  });

  it('checks then applies the code for recoverEmail', async () => {
    const order: string[] = [];
    const { fixture, firebase } = await render(linkParams('recoverEmail'), {
      checkActionCode: vi.fn(async () => void order.push('check')),
      applyActionCode: vi.fn(async () => void order.push('apply')),
    });
    await clickConfirm(fixture);

    expect(firebase.checkActionCode).toHaveBeenCalledExactlyOnceWith(OOB_CODE);
    expect(firebase.applyActionCode).toHaveBeenCalledExactlyOnceWith(OOB_CODE);
    expect(order).toEqual(['check', 'apply']);
  });

  it('guards against double submit while the request is pending', async () => {
    const pending = deferred();
    const { fixture, firebase, el } = await render(linkParams('revertSecondFactorAddition'), {
      applyActionCode: vi.fn(() => pending.promise),
    });
    const button = el.querySelector<HTMLButtonElement>('#auth-action-confirm-btn')!;
    button.click();
    button.click();
    fixture.detectChanges();

    expect(button.disabled).toBe(true);
    button.click();
    expect(firebase.applyActionCode).toHaveBeenCalledTimes(1);

    pending.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('#auth-action-success')).not.toBeNull();
  });

  it('shows resetPassword guidance with no form, button, or call', async () => {
    const { el, firebase } = await render(linkParams('resetPassword'));
    expect(el.querySelector('#auth-action-title')?.textContent).toContain(
      'Password sign-in isn’t used',
    );
    expect(el.querySelector('form, input, #auth-action-confirm-btn')).toBeNull();
    expect(el.querySelector('#auth-action-return-link')?.getAttribute('href')).toBe('/');
    expect(firebase.applyActionCode).not.toHaveBeenCalled();
  });

  it.each([
    ['missing mode', { oobCode: OOB_CODE }],
    ['unknown mode', { mode: 'signIn', oobCode: OOB_CODE }],
    ['missing oobCode', { mode: 'revertSecondFactorAddition' }],
  ])('shows the invalid-link message for %s', async (_label, params) => {
    const { el } = await render(params);
    expect(el.querySelector('#auth-action-title')?.textContent).toContain(
      AUTH_ACTION_COPY.invalid.title,
    );
    expect(el.querySelector('#auth-action-confirm-btn')).toBeNull();
  });

  it('shows a mapped error and hides the button for a used link', async () => {
    const { fixture, el } = await render(linkParams('revertSecondFactorAddition'), {
      applyActionCode: vi.fn(async () => {
        throw { code: 'auth/invalid-action-code', message: `bad ${OOB_CODE}` };
      }),
    });
    await clickConfirm(fixture);

    const alert = el.querySelector('#auth-action-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('invalid or has already been used');
    expect(el.textContent).not.toContain(OOB_CODE);
    expect(el.querySelector('#auth-action-confirm-btn')).toBeNull();
  });

  it('lets the user retry after a network error', async () => {
    const applyActionCode = vi
      .fn()
      .mockRejectedValueOnce({ code: 'auth/network-request-failed' })
      .mockResolvedValueOnce(undefined);
    const { fixture, el } = await render(linkParams('verifyEmail'), { applyActionCode });
    await clickConfirm(fixture);
    expect(el.querySelector('#auth-action-error')?.textContent).toContain('connection');

    await clickConfirm(fixture);
    expect(applyActionCode).toHaveBeenCalledTimes(2);
    expect(el.querySelector('#auth-action-error')).toBeNull();
    expect(el.querySelector('#auth-action-success')).not.toBeNull();
  });

  it('renders status inside an aria-live region', async () => {
    const { el } = await render(linkParams('verifyEmail'));
    expect(el.querySelector('#auth-action-status-region')?.getAttribute('aria-live')).toBe(
      'polite',
    );
  });

  it('never writes to the console, even on failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const { fixture } = await render(linkParams('revertSecondFactorAddition'), {
        applyActionCode: vi.fn(async () => {
          throw new Error(`boom ${OOB_CODE} ${API_KEY}`);
        }),
      });
      await clickConfirm(fixture);
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

describe('auth action helpers', () => {
  it('resolves supported modes and rejects missing codes', () => {
    expect(resolveAuthActionMode('verifyEmail', 'code')).toBe('verifyEmail');
    expect(resolveAuthActionMode('resetPassword', null)).toBe('resetPassword');
    expect(resolveAuthActionMode('verifyEmail', null)).toBe('invalid');
    expect(resolveAuthActionMode(null, 'code')).toBe('invalid');
    expect(resolveAuthActionMode('toString', 'code')).toBe('invalid');
  });

  it('follows only same-origin continue URLs', () => {
    const origin = 'https://app.example.org';
    expect(safeContinueHref(null, origin)).toBe('/');
    expect(safeContinueHref('https://app.example.org/guide?x=1#top', origin)).toBe(
      '/guide?x=1#top',
    );
    expect(safeContinueHref('https://evil.example.com/', origin)).toBe('/');
    expect(safeContinueHref('javascript:alert(1)', origin)).toBe('/');
  });

  it.each([
    ['auth/invalid-action-code', 'invalid or has already been used', false],
    ['auth/expired-action-code', 'expired', false],
    ['auth/user-disabled', 'disabled', false],
    ['auth/user-not-found', 'couldn’t find the account', false],
    ['auth/network-request-failed', 'connection', true],
    ['auth/something-else', 'Something went wrong', true],
  ])('maps %s to friendly copy', (code, text, retryable) => {
    const mapped = authActionErrorFor({ code });
    expect(mapped.message).toContain(text);
    expect(mapped.retryable).toBe(retryable);
  });

  it('maps non-Firebase errors to generic copy', () => {
    expect(authActionErrorFor(new Error('Firebase Auth is not configured.')).message).toContain(
      'Something went wrong',
    );
  });
});
