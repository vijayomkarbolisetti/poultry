import { Redirect } from "expo-router";
import { Image, View } from "react-native";

import { useAuth } from "../src/features/auth/AuthContext";
import { colors } from "../src/theme/tokens";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Image
          source={require("../assets/Vibrant Poultry Garden Splash Screen.png")}
          style={{ flex: 1, width: "100%", height: "100%" }}
          resizeMode="cover"
          fadeDuration={0}
        />
      </View>
    );
  }

  if (user?.must_change_password) return <Redirect href="/(auth)/change-password" />;
  if (user) return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/login" />;
}

