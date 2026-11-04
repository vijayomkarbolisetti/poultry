import { Redirect } from "expo-router";
import { View } from "react-native";

import { HenLoader } from "../src/components/ui/HenLoader";
import { useAuth } from "../src/features/auth/AuthContext";
import { colors } from "../src/theme/tokens";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <HenLoader label="Opening your farm…" />
      </View>
    );
  }

  if (user?.must_change_password) return <Redirect href="/(auth)/change-password" />;
  if (user) return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/login" />;
}

