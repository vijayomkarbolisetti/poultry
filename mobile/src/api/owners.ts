import { api } from "./client";

export type OwnerAccount = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type OwnerAccountListItem = OwnerAccount & {
  owner_user_id: string | null;
  owner_email: string | null;
  owner_full_name: string | null;
  owner_must_change_password: boolean;
};

export type OwnerUserSummary = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  must_change_password: boolean;
  /** Temporary password just set, echoed once by create/reset. Never stored or listed. */
  password: string | null;
};

export type CreatedOwnerAccount = {
  owner: OwnerAccount;
  owner_user: OwnerUserSummary;
};

export async function listOwnerAccounts(): Promise<OwnerAccountListItem[]> {
  const { data } = await api.get<OwnerAccountListItem[]>("/owners");
  return data;
}

export async function createOwnerAccount(input: {
  email: string;
  password: string;
  full_name: string;
  organization_name: string;
}): Promise<CreatedOwnerAccount> {
  const { data } = await api.post<CreatedOwnerAccount>("/owners", input);
  return data;
}

export async function updateFarmOwnerUser(
  ownerId: string,
  input: { full_name?: string; password?: string },
): Promise<OwnerUserSummary> {
  const { data } = await api.patch<OwnerUserSummary>(`/owners/${ownerId}/owner-user`, input);
  return data;
}
