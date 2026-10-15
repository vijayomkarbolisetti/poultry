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
  /** Instant path after login/register — seed cache and skip waiting on /auth/me. */
  acceptSession: (user: UserMe) => Promise<void>;
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
      await tokenStore.hydrate();
      const [access, owner] = await Promise.all([tokenStore.getAccess(), tokenStore.getOwnerId()]);
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
    staleTime: 5 * 60_000,
  });

  const resolvedOwner =
    ownerAccountId ?? meQuery.data?.memberships[0]?.owner_account_id ?? null;

  useEffect(() => {
    if (!meQuery.data) return;
    const first = meQuery.data.memberships[0]?.owner_account_id;
    if (!ownerAccountId && first) {
      setOwnerAccountId(first);
      void tokenStore.setOwnerId(first);
    }
  }, [meQuery.data, ownerAccountId]);

  const refreshSession = useCallback(async () => {
    const access = await tokenStore.getAccess();
    setHasToken(Boolean(access));
    await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }, [queryClient]);

  const acceptSession = useCallback(
    async (user: UserMe) => {
      const first = user.memberships[0]?.owner_account_id ?? null;
      if (first) {
        setOwnerAccountId(first);
        // Persist owner in background — memory is set first inside setOwnerId.
        void tokenStore.setOwnerId(first);
      }
      queryClient.setQueryData(["auth", "me"], user);
      setHasToken(true);
      // Prefetch dashboard while navigating home.
      if (first) {
        void queryClient.prefetchQuery({
          queryKey: ["dashboard", first],
          queryFn: async () => {
            const { fetchDashboard } = await import("../../api/dashboard");
            return fetchDashboard();
          },
        });
      }
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setHasToken(false);
    setOwnerAccountId(null);
    queryClient.clear();
  }, [queryClient]);

  const setActiveOwner = useCallback(
    async (ownerId: string) => {
      setOwnerAccountId(ownerId);
      await tokenStore.setOwnerId(ownerId);
      queryClient.clear();
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      user: meQuery.data ?? null,
      loading: !bootstrapped || (hasToken && (meQuery.isLoading || (!!meQuery.data && !resolvedOwner))),
      ownerAccountId: resolvedOwner,
      refreshSession,
      acceptSession,
      signOut,
      setActiveOwner,
    }),
    [
      meQuery.data,
      meQuery.isLoading,
      bootstrapped,
      hasToken,
      resolvedOwner,
      refreshSession,
      acceptSession,
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
