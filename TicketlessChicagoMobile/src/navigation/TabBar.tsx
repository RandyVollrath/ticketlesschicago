import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, shadows } from '../theme';

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Home: { active: 'shield-check', inactive: 'shield-check-outline' },
  History: { active: 'history', inactive: 'clock-outline' },
  Alerts: { active: 'bell-ring', inactive: 'bell-ring-outline' },
  Settings: { active: 'cog', inactive: 'cog-outline' },
};

const TAB_LABELS: Record<string, string> = {
  Home: 'Home',
  History: 'History',
  Alerts: 'Alerts',
  Settings: 'Settings',
};

const TabBar: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
  return (
    <View style={styles.container}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = TAB_LABELS[route.name] || options.tabBarLabel || options.title || route.name;
        const isFocused = state.index === index;
        const icons = TAB_ICONS[route.name] || { active: 'circle', inactive: 'circle-outline' };

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel || `${label} tab`}
            testID={(options as any).tabBarTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.tab}
          >
            <View style={[styles.iconContainer, isFocused && styles.iconContainerActive]}>
              <MaterialCommunityIcons
                name={isFocused ? icons.active : icons.inactive}
                size={22}
                color={isFocused ? colors.primary : colors.textTertiary}
              />
            </View>
            <Text style={[styles.label, isFocused && styles.labelActive]}>
              {label as string}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 0 : spacing.sm,
    paddingTop: spacing.sm,
    ...shadows.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  iconContainer: {
    width: 48,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginBottom: 2,
  },
  iconContainerActive: {
    backgroundColor: colors.primaryTint,
  },
  label: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontWeight: typography.weights.medium,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
});

export default TabBar;
