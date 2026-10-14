import { api } from "./client";

export type DashboardSummary = {
  active_sheds: number;
  active_farmers: number;
  owner_managed_sheds: number;
  farmer_managed_sheds: number;
  active_flocks: number;
  active_birds: number;
  upcoming_doses: number;
  due_today: number;
  overdue_doses: number;
  compliance_numerator: number;
  compliance_denominator: number;
};

export async function fetchDashboard(): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>("/dashboard/summary");
  return data;
}
