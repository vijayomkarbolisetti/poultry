import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../src/features/auth/AuthContext";
import { colors } from "../src/theme/tokens";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (user) return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/welcome" />;
}
