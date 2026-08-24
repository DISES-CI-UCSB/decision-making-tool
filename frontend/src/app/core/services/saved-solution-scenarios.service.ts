import { Injectable, inject } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  AppStateService,
  MAX_SAVED_SOLUTION_SCENARIOS,
  type SavedSolutionScenario,
  isSavedSolutionScenario,
} from '@core/services/app-state.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';

@Injectable({ providedIn: 'root' })
export class SavedSolutionScenariosService {
  private readonly appState = inject(AppStateService);
  private readonly firebase = inject(FirebaseClientService);
  private scenariosUnsubscribe: Unsubscribe | null = null;

  startSyncForUser(uid: string): void {
    this.stopSync();
    const firestore = this.firebase.firestore;
    if (!firestore) {
      return;
    }

    this.scenariosUnsubscribe = onSnapshot(
      collection(firestore, 'users', uid, 'savedSolutionScenarios'),
      (snapshot) => {
        const scenarios = snapshot.docs
          .map((entry) => entry.data())
          .filter(isSavedSolutionScenario)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, MAX_SAVED_SOLUTION_SCENARIOS);
        this.appState.setSavedSolutionScenarios(scenarios);
      },
      () => {
        this.appState.clearSavedSolutionScenarios();
      },
    );
  }

  stopSync(): void {
    this.scenariosUnsubscribe?.();
    this.scenariosUnsubscribe = null;
    this.appState.clearSavedSolutionScenarios();
  }

  async saveScenario(input: {
    solutionId: string;
    label: string;
    solutionName: string;
  }): Promise<boolean> {
    const uid = this.firebase.currentUser?.uid;
    const firestore = this.firebase.firestore;
    if (!uid || !firestore) {
      return false;
    }

    const scenario = this.appState.upsertSavedSolutionScenario(input);
    if (!scenario) {
      return false;
    }

    await setDoc(doc(firestore, 'users', uid, 'savedSolutionScenarios', scenario.id), scenario);
    return true;
  }

  async removeScenario(solutionId: string): Promise<boolean> {
    const uid = this.firebase.currentUser?.uid;
    const firestore = this.firebase.firestore;
    if (!uid || !firestore) {
      return false;
    }

    const scenarioId = `saved-scenario-${solutionId}`;
    this.appState.removeSavedSolutionScenario(solutionId);
    await deleteDoc(doc(firestore, 'users', uid, 'savedSolutionScenarios', scenarioId));
    return true;
  }
}
