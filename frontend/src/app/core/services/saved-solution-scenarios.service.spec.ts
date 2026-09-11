import { TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import { AppStateService } from './app-state.service';
import { FirebaseClientService } from './firebase-client.service';
import {
  SavedSolutionScenariosService,
  canPersistSavedScenariosRemotely,
} from './saved-solution-scenarios.service';

describe('canPersistSavedScenariosRemotely', () => {
  it('allows remote persistence only at DecisionMaker or higher', () => {
    expect(canPersistSavedScenariosRemotely(UserTier.Public)).toBe(false);
    expect(canPersistSavedScenariosRemotely(UserTier.DecisionMaker)).toBe(true);
    expect(canPersistSavedScenariosRemotely(UserTier.Manager)).toBe(true);
  });
});

describe('SavedSolutionScenariosService public-tier hold', () => {
  const firebase = {
    currentUser: { uid: 'held-user' } as { uid: string } | null,
    firestore: {},
  };

  beforeEach(() => {
    firebase.currentUser = { uid: 'held-user' };
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseClientService, useValue: firebase }],
    });
  });

  it('keeps a local save and skips remote persistence at Public', async () => {
    const appState = TestBed.inject(AppStateService);
    const service = TestBed.inject(SavedSolutionScenariosService);
    appState.userTier$.set(UserTier.Public);

    await expect(
      service.saveScenario({
        solutionId: 'sol-1',
        label: 'Held label',
        solutionName: 'Solution One',
      }),
    ).resolves.toBe(false);

    expect(appState.savedSolutionScenarios$()).toEqual([
      expect.objectContaining({
        solutionId: 'sol-1',
        label: 'Held label',
        solutionName: 'Solution One',
      }),
    ]);
  });

  it('keeps a local delete and skips remote deletion at Public', async () => {
    const appState = TestBed.inject(AppStateService);
    const service = TestBed.inject(SavedSolutionScenariosService);
    appState.userTier$.set(UserTier.Public);
    appState.upsertSavedSolutionScenario({
      solutionId: 'sol-1',
      label: 'Held label',
      solutionName: 'Solution One',
    });

    await expect(service.removeScenario('sol-1')).resolves.toBe(true);
    expect(appState.savedSolutionScenarios$()).toEqual([]);
  });

  it('does not create a local scenario when there is no Firebase identity', async () => {
    firebase.currentUser = null;
    const appState = TestBed.inject(AppStateService);
    const service = TestBed.inject(SavedSolutionScenariosService);
    appState.userTier$.set(UserTier.Public);

    await expect(
      service.saveScenario({
        solutionId: 'sol-1',
        label: 'Anonymous label',
        solutionName: 'Solution One',
      }),
    ).resolves.toBe(false);
    expect(appState.savedSolutionScenarios$()).toEqual([]);
  });
});
