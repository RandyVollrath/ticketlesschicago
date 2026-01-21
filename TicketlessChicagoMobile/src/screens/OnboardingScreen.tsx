import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Dimensions,
  FlatList,
  Animated,
  StatusBar,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, typography, spacing } from '../theme';
import { Button } from '../components';
import { StorageKeys } from '../constants';
import Logger from '../utils/Logger';

const log = Logger.createLogger('OnboardingScreen');

const { width } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  icon: string;
  title: string;
  description: string;
  backgroundColor: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: '1',
    icon: '🚗',
    title: 'Welcome to Ticketless',
    description: 'Never get a parking ticket in Chicago again. We help you stay compliant with all parking rules.',
    backgroundColor: colors.primary,
  },
  {
    id: '2',
    icon: '📍',
    title: 'Check Any Location',
    description: 'Instantly check parking restrictions at your current location or anywhere in Chicago.',
    backgroundColor: '#5856D6',
  },
  {
    id: '3',
    icon: '🔔',
    title: 'Automatic Alerts',
    description: 'Pair your car\'s Bluetooth and get automatic alerts when you park in a restricted zone.',
    backgroundColor: '#34C759',
  },
  {
    id: '4',
    icon: '🧹',
    title: 'Street Cleaning',
    description: 'Know exactly when street cleaning is scheduled so you can move your car in time.',
    backgroundColor: '#FF9500',
  },
  {
    id: '5',
    icon: '❄️',
    title: 'Snow Routes',
    description: 'Get alerts for winter overnight parking bans and snow emergency routes.',
    backgroundColor: '#5AC8FA',
  },
];

interface OnboardingScreenProps {
  navigation: any;
  onComplete?: () => void;
}

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ navigation, onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const viewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const completeOnboarding = useCallback(async () => {
    // Prevent double-taps
    if (isCompleting) return;
    setIsCompleting(true);

    log.info('completeOnboarding called');

    try {
      await AsyncStorage.setItem(StorageKeys.HAS_ONBOARDED, 'true');
      log.info('AsyncStorage set, calling onComplete or navigating');

      if (onComplete) {
        onComplete();
      } else {
        navigation.replace('Login');
      }
    } catch (error) {
      log.error('Error completing onboarding', error);
      setIsCompleting(false);
      Alert.alert('Error', 'Failed to complete setup. Please try again.');
    }
  }, [navigation, onComplete, isCompleting]);

  const goToNextSlide = useCallback(() => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      completeOnboarding();
    }
  }, [currentIndex, completeOnboarding]);

  const skipOnboarding = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const renderSlide = useCallback(({ item }: { item: OnboardingSlide }) => (
    <View
      style={[styles.slide, { backgroundColor: item.backgroundColor }]}
      accessibilityRole="text"
      accessibilityLabel={`${item.title}. ${item.description}`}
    >
      <Text style={styles.icon} accessibilityElementsHidden>{item.icon}</Text>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  ), []);

  const renderDots = useCallback(() => (
    <View
      style={styles.dotsContainer}
      accessibilityRole="text"
      accessibilityLabel={`Slide ${currentIndex + 1} of ${SLIDES.length}`}
    >
      {SLIDES.map((_, index) => {
        const inputRange = [
          (index - 1) * width,
          index * width,
          (index + 1) * width,
        ];

        const dotWidth = scrollX.interpolate({
          inputRange,
          outputRange: [8, 20, 8],
          extrapolate: 'clamp',
        });

        const opacity = scrollX.interpolate({
          inputRange,
          outputRange: [0.4, 1, 0.4],
          extrapolate: 'clamp',
        });

        return (
          <Animated.View
            key={index}
            style={[styles.dot, { width: dotWidth, opacity }]}
          />
        );
      })}
    </View>
  ), [currentIndex, scrollX]);

  const isLastSlide = currentIndex === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Skip Button */}
      {!isLastSlide && (
        <View style={styles.skipContainer}>
          <Button
            title="Skip"
            variant="ghost"
            size="sm"
            onPress={skipOnboarding}
            textStyle={styles.skipText}
            accessibilityLabel="Skip onboarding and continue to login"
          />
        </View>
      )}

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onViewableItemsChanged={viewableItemsChanged}
        viewabilityConfig={viewConfig}
        scrollEventThrottle={32}
      />

      {/* Bottom Section */}
      <View style={styles.bottomContainer}>
        {renderDots()}

        <View style={styles.buttonContainer}>
          <Button
            title={isLastSlide ? 'Get Started' : 'Next'}
            variant="primary"
            size="lg"
            onPress={goToNextSlide}
            style={styles.nextButton}
            accessibilityLabel={isLastSlide ? 'Get started with Ticketless' : `Go to next slide, ${currentIndex + 2} of ${SLIDES.length}`}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  skipContainer: {
    position: 'absolute',
    top: 50,
    right: spacing.base,
    zIndex: 1,
  },
  skipText: {
    color: colors.white,
  },
  slide: {
    width,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  icon: {
    fontSize: 80,
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.white,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    fontSize: typography.sizes.md,
    color: colors.white,
    textAlign: 'center',
    lineHeight: typography.sizes.md * typography.lineHeights.relaxed,
    opacity: 0.9,
  },
  bottomContainer: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.white,
    marginHorizontal: spacing.xs,
  },
  buttonContainer: {
    paddingHorizontal: spacing.base,
  },
  nextButton: {
    minHeight: 52,
  },
});

export default OnboardingScreen;
