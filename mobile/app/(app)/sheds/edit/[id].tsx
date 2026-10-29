import { useLocalSearchParams } from "expo-router";

import { ShedEditorScreen } from "../../../../src/features/sheds/ShedEditorScreen";
import { firstRouteParam } from "../../../../src/navigation/routeParams";

/** Edit Shed — same Screen 5 form as create, prepopulated from the shed. */
export default function EditShedScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = firstRouteParam(params.id);
  return <ShedEditorScreen mode="edit" shedId={id} />;
}
