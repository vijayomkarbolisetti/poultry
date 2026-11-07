/**
 * Run: npx --yes tsx src/features/farmers/farmerListHelpers.test.ts
 */
import type { Farmer } from "../../api/farmers";
import { filterFarmers } from "./farmerListHelpers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const rows: Farmer[] = [
  {
    membership_id: "1",
    user_id: "u1",
    owner_account_id: "o1",
    email: "ana@farm.com",
    full_name: "Ana Farmer",
    role: "farmer",
    is_active: true,
    permission_codes: [],
    assigned_shed_ids: ["s1"],
    created_at: "",
  },
  {
    membership_id: "2",
    user_id: "u2",
    owner_account_id: "o1",
    email: "bob@farm.com",
    full_name: "Bob Helper",
    role: "farmer",
    is_active: false,
    permission_codes: [],
    assigned_shed_ids: [],
    created_at: "",
  },
];

assert(filterFarmers(rows, "").length === 2, "empty query");
assert(filterFarmers(rows, "ANA").length === 1 && filterFarmers(rows, "ANA")[0]?.full_name === "Ana Farmer", "name");
assert(filterFarmers(rows, "bob@")[0]?.email === "bob@farm.com", "email");
assert(filterFarmers(rows, "xyz").length === 0, "no match");

console.log("farmerListHelpers.test.ts OK");
