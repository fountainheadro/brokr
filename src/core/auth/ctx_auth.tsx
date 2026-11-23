import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth, clearLocalFirestorePersistenceOnSignOut } from "../../lib/firebase";
import { clientDataHub } from "../crm/svc_client-data-hub";

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        clientDataHub.setAuthUser(currentUser?.uid || null);
        setUser(currentUser);
        setIsLoading(false);
        setError(null);
      },
      (err) => {
        console.error("[AuthProvider] onAuthStateChanged error:", err);
        setError(err?.message || "Eroare la verificarea sesiunii.");
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      setError(null);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("[AuthProvider] Google Sign-In error:", err);
      setError(err?.message || "Autentificarea cu Google a eșuat.");
      throw err;
    }
  };

  const logout = async () => {
    try {
      clientDataHub.purgeAllCaches();
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("brokr_preview_token");
      }
      await firebaseSignOut(auth);
      setUser(null);
      const terminatedPersistence = await clearLocalFirestorePersistenceOnSignOut();
      if (terminatedPersistence && typeof window !== "undefined") {
        // Reload once after terminating Firestore IndexedDB persistence so the next login gets a fresh runtime instance
        window.location.replace("/");
      }
    } catch (err: any) {
      console.error("[AuthProvider] Sign out error:", err);
      setError(err?.message || "Deconectarea a eșuat.");
    }
  };

  const clearError = () => setError(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      error,
      loginWithGoogle,
      logout,
      clearError,
    }),
    [user, isLoading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth trebuie utilizat în interiorul unui AuthProvider.");
  }
  return context;
}
