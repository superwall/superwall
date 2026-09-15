import React from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Notifications from "expo-notifications";

const STORE_URL = "itms-apps://apps.apple.com/app/id123456789";
const PRODUCT_ID = "acme_pro_annual";

export function UpdateRequiredScreen({ minimumVersion }: { minimumVersion: string }) {
  const navigation = useNavigation();
  return (
    <View style={{ flex: 1, padding: 24 }}>
      <Image source={require("../assets/rocket.png")} accessibilityLabel="Rocket" />
      <Text>Update required</Text>
      <Text>{`Version ${minimumVersion} fixes sign-in.`}</Text>
      <Pressable onPress={() => Linking.openURL(STORE_URL)}>
        <Text>Update now</Text>
      </Pressable>
      <Pressable onPress={() => Notifications.requestPermissionsAsync()}>
        <Text>Notify me when it's ready</Text>
      </Pressable>
      <Pressable onPress={() => navigation.goBack()} accessibilityLabel="Dismiss">
        <Text>Not now</Text>
      </Pressable>
    </View>
  );
}
