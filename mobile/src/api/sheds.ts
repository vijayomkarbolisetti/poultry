import { api } from "./client";

export type Shed = {
  id: string;
  owner_account_id: string;
  name: string;
  code: string;
  location_notes: string | null;
  is_owner_managed: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ShedAssignment = {
  id: string;
  shed_id: string;
  owner_membership_id: string;
  is_manager: boolean;
  is_active: boolean;
  farmer_name: string | null;
  farmer_email: string | null;
};

export async function listSheds(): Promise<Shed[]> {
  const { data } = await api.get<Shed[]>("/sheds");
  return data;
}

export async function getShed(id: string): Promise<Shed> {
  const { data } = await api.get<Shed>(`/sheds/${id}`);
  return data;
}

export async function createShed(input: {
  name: string;
  code: string;
  location_notes?: string;
  is_owner_managed?: boolean;
}): Promise<Shed> {
  const { data } = await api.post<Shed>("/sheds", input);
  return data;
}

export async function updateShed(
  id: string,
  input: Partial<{ name: string; location_notes: string; is_owner_managed: boolean; is_active: boolean }>,
): Promise<Shed> {
  const { data } = await api.patch<Shed>(`/sheds/${id}`, input);
  return data;
}

export async function listAssignments(shedId: string): Promise<ShedAssignment[]> {
  const { data } = await api.get<ShedAssignment[]>(`/sheds/${shedId}/assignments`);
  return data;
}

export async function assignFarmer(
  shedId: string,
  input: { owner_membership_id: string; is_manager?: boolean },
): Promise<ShedAssignment> {
  const { data } = await api.post<ShedAssignment>(`/sheds/${shedId}/assignments`, input);
  return data;
}
