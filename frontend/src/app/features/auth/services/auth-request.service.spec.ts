import { TestBed } from '@angular/core/testing';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { SirapAccessService } from './sirap-access.service';
import {
  ACCESS_ALREADY_APPROVED_MESSAGE,
  ACCESS_APPROVED_WITHOUT_ACCOUNT_MESSAGE,
  ACCESS_DENIED_MESSAGE,
  AuthRequestService,
} from './auth-request.service';

describe('AuthRequestService Firebase Google flow', () => {
  const firebase = {
    isEnabled: true,
    firestore: {},
    getUserDocument: vi.fn(),
    getAccessRequestDocument: vi.fn(),
    setAccessRequestDocument: vi.fn().mockResolvedValue(undefined),
  };
  const sirapAccess = {
    submitRequestsForIdentity: vi.fn().mockResolvedValue(undefined),
  };

  let service: AuthRequestService;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    firebase.getUserDocument.mockResolvedValue(null);
    firebase.getAccessRequestDocument.mockResolvedValue(null);
    firebase.setAccessRequestDocument.mockResolvedValue(undefined);
    sirapAccess.submitRequestsForIdentity.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: SirapAccessService, useValue: sirapAccess },
      ],
    });
    service = TestBed.inject(AuthRequestService);
  });

  it('returns active for an approved user without writing an account', async () => {
    firebase.getUserDocument.mockResolvedValue({ status: 'active' });

    await expect(
      service.attemptLogin({
        uid: 'approved-user',
        email: 'approved@example.com',
        provider: 'google',
      }),
    ).resolves.toBe('active');

    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
    expect(firebase.getAccessRequestDocument).not.toHaveBeenCalled();
  });

  it('restores an existing pending access request without creating a user', async () => {
    firebase.getAccessRequestDocument.mockResolvedValue({
      status: 'pending',
      email: 'pending@example.com',
      displayName: 'Pending User',
      submittedAt: 123,
    });

    await expect(
      service.attemptLogin({
        uid: 'pending-user',
        email: 'pending@example.com',
        provider: 'google',
      }),
    ).resolves.toBe('pending');

    expect(service.pendingRequest$()?.requestId).toBe('pending-user');
    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
  });

  it('creates only a pending access request for a first Google sign-in', async () => {
    await expect(
      service.attemptLogin({
        uid: 'new-user',
        email: 'new@example.com',
        displayName: 'New User',
        provider: 'google',
      }),
    ).resolves.toBe('pending');

    expect(firebase.setAccessRequestDocument).toHaveBeenCalledOnce();
    expect(firebase.setAccessRequestDocument).toHaveBeenCalledWith(
      'new-user',
      expect.objectContaining({
        uid: 'new-user',
        email: 'new@example.com',
        displayName: 'New User',
        provider: 'google',
        status: 'pending',
        requestedAt: expect.anything(),
        updatedAt: expect.anything(),
      }),
    );
  });

  it('keeps the SIRAP request flow pending without creating a user', async () => {
    await service.submitGoogleRequest({
      uid: 'sirap-user',
      googleName: 'SIRAP User',
      googleEmail: 'sirap@example.com',
      googleAvatarInitials: 'SU',
      requestedSirapIds: ['orinoquia'],
    });

    expect(firebase.setAccessRequestDocument).toHaveBeenCalledWith(
      'sirap-user',
      expect.objectContaining({ status: 'pending', avatarInitials: 'SU' }),
    );
    expect(sirapAccess.submitRequestsForIdentity).toHaveBeenCalledWith(
      'sirap-user',
      'sirap@example.com',
      'SIRAP User',
      ['orinoquia'],
      undefined,
    );
  });

  it('does not overwrite a denied access request', async () => {
    firebase.getAccessRequestDocument.mockResolvedValue({ status: 'denied' });

    await expect(
      service.attemptLogin({
        uid: 'denied-user',
        email: 'denied@example.com',
        provider: 'google',
      }),
    ).resolves.toBe('invalid');

    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
  });

  it('rejects Request Access when the access request is denied', async () => {
    firebase.getAccessRequestDocument.mockResolvedValue({ status: 'denied' });

    await expect(submitOrinoquiaRequest()).rejects.toThrow(ACCESS_DENIED_MESSAGE);

    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
    expect(sirapAccess.submitRequestsForIdentity).not.toHaveBeenCalled();
  });

  it('rejects Request Access when the user record is denied', async () => {
    firebase.getUserDocument.mockResolvedValue({ status: 'denied' });

    await expect(submitOrinoquiaRequest()).rejects.toThrow(ACCESS_DENIED_MESSAGE);

    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
    expect(sirapAccess.submitRequestsForIdentity).not.toHaveBeenCalled();
  });

  it('does not demote an already active user through Request Access', async () => {
    firebase.getUserDocument.mockResolvedValue({ status: 'active' });
    firebase.getAccessRequestDocument.mockResolvedValue({ status: 'approved' });

    await expect(submitOrinoquiaRequest()).rejects.toThrow(ACCESS_ALREADY_APPROVED_MESSAGE);

    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
    expect(sirapAccess.submitRequestsForIdentity).not.toHaveBeenCalled();
  });

  it('does not rewrite an approved access request when the user doc is missing', async () => {
    firebase.getAccessRequestDocument.mockResolvedValue({ status: 'approved' });

    await expect(submitOrinoquiaRequest()).rejects.toThrow(ACCESS_APPROVED_WITHOUT_ACCOUNT_MESSAGE);

    expect(firebase.setAccessRequestDocument).not.toHaveBeenCalled();
    expect(sirapAccess.submitRequestsForIdentity).not.toHaveBeenCalled();
  });

  it('still resubmits a pending access request and SIRAP selections', async () => {
    firebase.getAccessRequestDocument.mockResolvedValue({
      status: 'pending',
      email: 'pending@example.com',
      displayName: 'Pending User',
    });

    await submitOrinoquiaRequest();

    expect(firebase.setAccessRequestDocument).toHaveBeenCalledWith(
      'sirap-user',
      expect.objectContaining({ status: 'pending', avatarInitials: 'SU' }),
    );
    expect(sirapAccess.submitRequestsForIdentity).toHaveBeenCalledWith(
      'sirap-user',
      'sirap@example.com',
      'SIRAP User',
      ['orinoquia'],
      undefined,
    );
  });

  function submitOrinoquiaRequest() {
    return service.submitGoogleRequest({
      uid: 'sirap-user',
      googleName: 'SIRAP User',
      googleEmail: 'sirap@example.com',
      googleAvatarInitials: 'SU',
      requestedSirapIds: ['orinoquia'],
    });
  }
});
