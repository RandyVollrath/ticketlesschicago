import React from 'react';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

interface GoogleLogoProps {
  size?: number;
}

/**
 * Google "G" logo using MaterialCommunityIcons.
 * Uses Google's primary brand blue (#4285F4) for a clean, recognizable look.
 */
const GoogleLogo: React.FC<GoogleLogoProps> = ({ size = 20 }) => {
  return (
    <MaterialCommunityIcons
      name="google"
      size={size}
      color="#4285F4"
    />
  );
};

export default GoogleLogo;
