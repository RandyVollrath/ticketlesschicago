import React from 'react';
import { View, StyleSheet } from 'react-native';

interface GoogleLogoProps {
  size?: number;
}

/**
 * Google "G" Logo component using pure React Native Views
 * Approximates the official Google multicolor logo
 */
const GoogleLogo: React.FC<GoogleLogoProps> = ({ size = 20 }) => {
  const scale = size / 20;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Blue arc - right side */}
      <View style={[
        styles.arc,
        styles.blueArc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3 * scale,
        }
      ]} />
      {/* Green arc - bottom right */}
      <View style={[
        styles.arc,
        styles.greenArc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3 * scale,
        }
      ]} />
      {/* Yellow arc - bottom left */}
      <View style={[
        styles.arc,
        styles.yellowArc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3 * scale,
        }
      ]} />
      {/* Red arc - top */}
      <View style={[
        styles.arc,
        styles.redArc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3 * scale,
        }
      ]} />
      {/* Blue horizontal bar */}
      <View style={[
        styles.bar,
        {
          width: size * 0.45,
          height: 3 * scale,
          right: 0,
          top: size / 2 - (1.5 * scale),
          backgroundColor: '#4285F4',
        }
      ]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  arc: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderColor: 'transparent',
  },
  blueArc: {
    borderRightColor: '#4285F4',
    transform: [{ rotate: '45deg' }],
  },
  greenArc: {
    borderBottomColor: '#34A853',
    transform: [{ rotate: '45deg' }],
  },
  yellowArc: {
    borderLeftColor: '#FBBC05',
    transform: [{ rotate: '45deg' }],
  },
  redArc: {
    borderTopColor: '#EA4335',
    transform: [{ rotate: '45deg' }],
  },
  bar: {
    position: 'absolute',
  },
});

export default GoogleLogo;
