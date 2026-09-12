/**
 * Injected at session start, never seen by the model, never written to an artifact or
 * evidence. `typeCredential` carries only a reference; this is the one place a
 * reference resolves to an actual secret.
 */
export interface CredentialProvider {
  resolve(ref: string): string;
}

/** The one implementation: a credential reference is an environment variable name. */
export class EnvCredentialProvider implements CredentialProvider {
  resolve(ref: string): string {
    return process.env[ref] ?? '';
  }
}
