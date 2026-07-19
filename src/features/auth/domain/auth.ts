export type AuthUser = {
  id: string;
  email: string | null;
};

export type AuthSession = {
  accessToken: string;
  user: AuthUser;
};

export type AuthStateListener = (session: AuthSession | null) => void;

export interface AuthService {
  readonly isConfigured: boolean;
  getSession(): Promise<AuthSession | null>;
  onAuthStateChange(listener: AuthStateListener): () => void;
  signInWithGoogle(redirectTo: string): Promise<void>;
  signOut(): Promise<void>;
}
