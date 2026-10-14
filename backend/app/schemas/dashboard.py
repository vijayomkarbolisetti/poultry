from pydantic import BaseModel


class DashboardSummary(BaseModel):
    active_sheds: int
    active_farmers: int
    owner_managed_sheds: int
    farmer_managed_sheds: int
    # Placeholders until Phase 3+ flock/bird/vaccination data exists
    active_flocks: int = 0
    active_birds: int = 0
    upcoming_doses: int = 0
    due_today: int = 0
    overdue_doses: int = 0
    compliance_numerator: int = 0
    compliance_denominator: int = 0
