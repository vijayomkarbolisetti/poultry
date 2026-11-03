import enum


class MembershipRole(str, enum.Enum):
    owner = "owner"
    org_admin = "org_admin"
    farmer = "farmer"
    read_only = "read_only"


class TrackingMode(str, enum.Enum):
    batch = "batch"
    individual = "individual"
    mixed = "mixed"


class DobConfidence(str, enum.Enum):
    exact = "exact"
    estimated = "estimated"
    unknown = "unknown"


class FlockStatus(str, enum.Enum):
    active = "active"
    closed = "closed"


class BirdLifecycleStatus(str, enum.Enum):
    active = "active"
    sold = "sold"
    dead = "dead"
    transferred_out = "transferred_out"
    inactive = "inactive"


class LifecycleEventType(str, enum.Enum):
    mortality = "mortality"
    sale = "sale"
    transfer = "transfer"
    flock_closure = "flock_closure"
    band_assignment = "band_assignment"
    count_adjustment = "count_adjustment"
    onboarding = "onboarding"


class BirdParentRole(str, enum.Enum):
    sire = "sire"
    dam = "dam"
