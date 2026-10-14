import { api, tokenStore } from "./client";

export type Membership = {
  id: string;
  owner_account_id: string;
  role: "owner" | "org_admin" | "farmer" | "read_only";
  is_active: boolean;
  organization_name: string | null;
};

export type UserMe = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_platform_super_admin: boolean;
  created_at: string;
  memberships: Membership[];
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export async function registerOwner(input: {
  email: string;
  password: string;
  full_name: string;
  organization_name: string;
}): Promise<TokenPair> {
  const { data } = await api.post<TokenPair>("/auth/register-owner", input);
  await tokenStore.setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function login(input: { email: string; password: string }): Promise<TokenPair> {
  const { data } = await api.post<TokenPair>("/auth/login", input);
  await tokenStore.setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function fetchMe(): Promise<UserMe> {
  const { data } = await api.get<UserMe>("/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  const refresh = await tokenStore.getRefresh();
  try {
    if (refresh) await api.post("/auth/logout", { refresh_token: refresh });
  } finally {
    await tokenStore.clear();
  }
}
