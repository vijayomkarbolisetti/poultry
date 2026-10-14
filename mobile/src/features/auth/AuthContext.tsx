import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchMe, logout as apiLogout, type UserMe } from "../../api/auth";
import { tokenStore } from "../../api/client";

type AuthState = {
  user: UserMe | null;
  loading: boolean;
  ownerAccountId: string | null;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
  setActiveOwner: (ownerId: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ownerAccountId, setOwnerAccountId] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    (async () => {
      const access = await tokenStore.getAccess();
      const owner = await tokenStore.getOwnerId();
      setHasToken(Boolean(access));
      setOwnerAccountId(owner);
      setBootstrapped(true);
    })();
  }, []);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    enabled: bootstrapped && hasToken,
    retry: false,
  });

  useEffect(() => {
    if (!meQuery.data) return;
    const first = meQuery.data.memberships[0]?.owner_account_id;
    if (!ownerAccountId && first) {
      void tokenStore.setOwnerId(first).then(() => setOwnerAccountId(first));
    }
  }, [meQuery.data, ownerAccountId]);

  const refreshSession = useCallback(async () => {
    const access = await tokenStore.getAccess();
    setHasToken(Boolean(access));
    await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await apiLogout();
    setHasToken(false);
    setOwnerAccountId(null);
    queryClient.clear();
  }, [queryClient]);

  const setActiveOwner = useCallback(async (ownerId: string) => {
    await tokenStore.setOwnerId(ownerId);
    setOwnerAccountId(ownerId);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: meQuery.data ?? null,
      loading: !bootstrapped || (hasToken && meQuery.isLoading),
      ownerAccountId,
      refreshSession,
      signOut,
      setActiveOwner,
    }),
    [
      meQuery.data,
      meQuery.isLoading,
      bootstrapped,
      hasToken,
      ownerAccountId,
      refreshSession,
      signOut,
      setActiveOwner,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
