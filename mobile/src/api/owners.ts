import { api } from "./client";

export type OwnerAccount = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type OwnerAccountListItem = OwnerAccount & {
  owner_email: string | null;
  owner_full_name: string | null;
};

export type CreatedOwnerAccount = {
  owner: OwnerAccount;
  owner_user: {
    id: string;
    email: string;
    full_name: string;
    is_active: boolean;
  };
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
