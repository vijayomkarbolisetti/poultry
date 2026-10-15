import { api } from "./client";

export type Farmer = {
  membership_id: string;
  user_id: string;
  owner_account_id: string;
  email: string;
  full_name: string;
  role: "org_admin" | "farmer" | "read_only";
  is_active: boolean;
  permission_codes: string[];
  assigned_shed_ids: string[];
  created_at: string;
};

export type Permission = { code: string; description: string };

export async function listFarmers(): Promise<Farmer[]> {
  const { data } = await api.get<Farmer[]>("/farmers");
  return data;
}

export async function createFarmer(input: {
  email: string;
  password: string;
  full_name: string;
  role?: "org_admin" | "farmer" | "read_only";
  permission_codes?: string[];
  shed_ids?: string[];
}): Promise<Farmer> {
  const { data } = await api.post<Farmer>("/farmers", input);
  return data;
}

export async function updateFarmer(
  membershipId: string,
  input: { full_name?: string; is_active?: boolean },
): Promise<Farmer> {
  const { data } = await api.patch<Farmer>(`/farmers/${membershipId}`, input);
  return data;
}

export async function setFarmerPermissions(membershipId: string, permission_codes: string[]): Promise<Farmer> {
  const { data } = await api.put<Farmer>(`/farmers/${membershipId}/permissions`, { permission_codes });
  return data;
}

export async function setFarmerSheds(membershipId: string, shed_ids: string[]): Promise<Farmer> {
  const { data } = await api.put<Farmer>(`/farmers/${membershipId}/sheds`, { shed_ids });
  return data;
}

export async function listPermissions(): Promise<Permission[]> {
  const { data } = await api.get<Permission[]>("/farmers/permissions");
  return data;
}
