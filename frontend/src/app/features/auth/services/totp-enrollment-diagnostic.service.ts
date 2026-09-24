import { Injectable } from '@angular/core';
import type { User } from 'firebase/auth';
import { environment } from '../../../../environments/environment';
import { reportUnconfirmedTotpLookup } from './totp-enrollment-diagnostic';

@Injectable({ providedIn: 'root' })
export class TotpEnrollmentDiagnosticService {
  reportUnconfirmed(user: User): Promise<void> {
    return reportUnconfirmedTotpLookup({
      production: environment.production,
      apiKey: environment.firebase.config.apiKey,
      projectId: environment.firebase.config.projectId,
      currentUid: user.uid,
      getIdToken: (forceRefresh) => user.getIdToken(forceRefresh),
    });
  }
}
