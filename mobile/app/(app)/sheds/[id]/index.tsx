import { Redirect, useLocalSearchParams } from "expo-router";

import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { firstRouteParam } from "../../../../src/navigation/routeParams";

/**
 * Legacy Shed Details route — unified Shed Management lives at `/sheds/[id]/birds`.
 * Keep this file so deep links and bookmarks redirect safely.
 */
export default function ShedDetailRedirect() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = firstRouteParam(params.id);

  if (!id) {
    return (
      <Screen>
        <HenLoader label="Opening shed…" />
      </Screen>
    );
  }

  return <Redirect href={`/(app)/sheds/${id}/birds`} />;
}
