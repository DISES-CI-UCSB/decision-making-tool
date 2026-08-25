import { Injectable, inject } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Firestore,
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
  private syncedUserId: string | null = null;
  private readonly pendingScenarioIds = new Set<string>();
  private readonly pendingRemovalIds = new Set<string>();

  startSyncForUser(uid: string): void {
    if (this.syncedUserId === uid && this.scenariosUnsubscribe) {
      return;
    }

    this.stopSync(this.syncedUserId !== null && this.syncedUserId !== uid);
    this.syncedUserId = uid;
    const firestore = this.firebase.firestore;
    if (!firestore) {
      return;
    }

    this.appState.savedSolutionScenarios$().forEach((scenario) => {
      void this.writeScenario(uid, firestore, scenario);
    });

    this.scenariosUnsubscribe = onSnapshot(
      collection(firestore, 'users', uid, 'savedSolutionScenarios'),
      (snapshot) => {
        const remoteScenarios = snapshot.docs
          .map((entry) => entry.data())
          .filter(isSavedSolutionScenario)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, MAX_SAVED_SOLUTION_SCENARIOS);
        const remoteScenarioIds = new Set(remoteScenarios.map((scenario) => scenario.id));
        const pendingScenarios = this.appState
          .savedSolutionScenarios$()
          .filter((scenario) => this.pendingScenarioIds.has(scenario.id));
        const scenarios = [
          ...pendingScenarios,
          ...remoteScenarios.filter((scenario) => !this.pendingRemovalIds.has(scenario.id)),
        ];

        this.pendingScenarioIds.forEach((scenarioId) => {
          if (remoteScenarioIds.has(scenarioId)) {
            this.pendingScenarioIds.delete(scenarioId);
          }
        });
        this.pendingRemovalIds.forEach((scenarioId) => {
          if (!remoteScenarioIds.has(scenarioId)) {
            this.pendingRemovalIds.delete(scenarioId);
          }
        });
        this.appState.setSavedSolutionScenarios(this.uniqueScenariosById(scenarios));
      },
      () => {
        // Keep in-session labels visible if Firestore is temporarily unavailable.
      },
    );
  }

  stopSync(clearScenarios = true): void {
    this.scenariosUnsubscribe?.();
    this.scenariosUnsubscribe = null;
    this.syncedUserId = null;
    if (clearScenarios) {
      this.pendingScenarioIds.clear();
      this.pendingRemovalIds.clear();
      this.appState.clearSavedSolutionScenarios();
    }
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

    return this.writeScenario(uid, firestore, scenario);
  }

  async removeScenario(solutionId: string): Promise<boolean> {
    const uid = this.firebase.currentUser?.uid;
    const firestore = this.firebase.firestore;
    this.appState.removeSavedSolutionScenario(solutionId);

    if (!uid || !firestore) {
      return true;
    }

    const scenarioId = `saved-scenario-${solutionId}`;
    this.pendingRemovalIds.add(scenarioId);
    try {
      await deleteDoc(doc(firestore, 'users', uid, 'savedSolutionScenarios', scenarioId));
      return true;
    } catch {
      this.pendingRemovalIds.delete(scenarioId);
      return false;
    }
  }

  private uniqueScenariosById(scenarios: SavedSolutionScenario[]): SavedSolutionScenario[] {
    const scenarioById = new Map<string, SavedSolutionScenario>();
    scenarios.forEach((scenario) => {
      if (!scenarioById.has(scenario.id)) {
        scenarioById.set(scenario.id, scenario);
      }
    });
    return Array.from(scenarioById.values()).slice(0, MAX_SAVED_SOLUTION_SCENARIOS);
  }

  private async writeScenario(
    uid: string,
    firestore: Firestore,
    scenario: SavedSolutionScenario,
  ): Promise<boolean> {
    this.pendingScenarioIds.add(scenario.id);
    try {
      await setDoc(doc(firestore, 'users', uid, 'savedSolutionScenarios', scenario.id), scenario);
      return true;
    } catch {
      this.pendingScenarioIds.delete(scenario.id);
      return false;
    }
  }
}
