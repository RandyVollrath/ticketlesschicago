import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import LocationService, { ParkingRule } from './services/LocationService';
import BluetoothService, { SavedCarDevice } from './services/BluetoothService';

function App(): React.JSX.Element {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [lastParkingCheck, setLastParkingCheck] = useState<{
    address: string;
    rules: ParkingRule[];
    timestamp: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load saved car device on mount
    loadSavedCar();
  }, []);

  const loadSavedCar = async () => {
    const device = await BluetoothService.getSavedCarDevice();
    setSavedCar(device);
  };

  const handleCarDisconnect = async () => {
    console.log('Car disconnected - checking parking location...');
    setLoading(true);

    try {
      // Get current location
      const coords = await LocationService.getCurrentLocation();

      // Check parking rules
      const rules = await LocationService.checkParkingRules(coords);

      // Save parking location
      await LocationService.saveLastParkingLocation(coords, rules);

      // Update state
      setLastParkingCheck({
        address: `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
        rules,
        timestamp: Date.now(),
      });

      // Send alerts if there are parking restrictions
      if (rules.length > 0) {
        await LocationService.sendParkingAlert(rules);
      }
    } catch (error) {
      console.error('Error handling car disconnect:', error);
      Alert.alert('Error', 'Failed to check parking location');
    } finally {
      setLoading(false);
    }
  };

  const startMonitoring = async () => {
    if (!savedCar) {
      Alert.alert('No Car Paired', 'Please pair your car Bluetooth device first');
      return;
    }

    setLoading(true);

    try {
      // Request location permissions
      const hasLocationPermission = await LocationService.requestLocationPermission();
      if (!hasLocationPermission) {
        Alert.alert('Permission Denied', 'Location permission is required');
        setLoading(false);
        return;
      }

      // Start monitoring car connection
      await BluetoothService.monitorCarConnection(handleCarDisconnect);

      setIsMonitoring(true);
      Alert.alert('Monitoring Started', 'We\'ll check parking restrictions when you disconnect from your car');
    } catch (error) {
      console.error('Error starting monitoring:', error);
      Alert.alert('Error', 'Failed to start monitoring');
    } finally {
      setLoading(false);
    }
  };

  const stopMonitoring = () => {
    BluetoothService.stopMonitoring();
    setIsMonitoring(false);
    Alert.alert('Monitoring Stopped', 'Parking detection has been disabled');
  };

  const testParkingCheck = async () => {
    setLoading(true);

    try {
      const coords = await LocationService.getCurrentLocation();
      const rules = await LocationService.checkParkingRules(coords);

      setLastParkingCheck({
        address: `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
        rules,
        timestamp: Date.now(),
      });

      if (rules.length > 0) {
        await LocationService.sendParkingAlert(rules);
      } else {
        Alert.alert('All Clear!', 'No parking restrictions at your current location');
      }
    } catch (error) {
      console.error('Error testing parking check:', error);
      Alert.alert('Error', 'Failed to check parking location');
    } finally {
      setLoading(false);
    }
  };

  const navigateToSettings = () => {
    // This would navigate to settings screen in a full app
    Alert.alert('Settings', 'Settings screen coming soon!');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView contentContainerStyle={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Ticketless Chicago</Text>
          <Text style={styles.subtitle}>Auto Parking Detection</Text>
        </View>

        {/* Monitoring Status */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Auto-Detection</Text>
            <Switch
              value={isMonitoring}
              onValueChange={isMonitoring ? stopMonitoring : startMonitoring}
              disabled={loading || !savedCar}
            />
          </View>
          <Text style={styles.cardText}>
            {isMonitoring
              ? '✅ Monitoring your car connection'
              : savedCar
              ? '⏸️ Tap to start monitoring'
              : '⚠️ Please pair your car first'}
          </Text>
        </View>

        {/* Saved Car */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Paired Car</Text>
          {savedCar ? (
            <View>
              <Text style={styles.cardText}>🚗 {savedCar.name}</Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={navigateToSettings}
              >
                <Text style={styles.secondaryButtonText}>Change Car</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.cardText}>No car paired</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={navigateToSettings}
              >
                <Text style={styles.buttonText}>Pair Your Car</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Test Button */}
        <TouchableOpacity
          style={[styles.primaryButton, styles.testButton]}
          onPress={testParkingCheck}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>🔍 Check Current Location</Text>
          )}
        </TouchableOpacity>

        {/* Last Parking Check */}
        {lastParkingCheck && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last Parking Check</Text>
            <Text style={styles.timestamp}>
              {new Date(lastParkingCheck.timestamp).toLocaleString()}
            </Text>
            <Text style={styles.address}>{lastParkingCheck.address}</Text>

            {lastParkingCheck.rules.length > 0 ? (
              <View style={styles.rulesContainer}>
                {lastParkingCheck.rules.map((rule, index) => (
                  <View key={index} style={styles.ruleCard}>
                    <Text style={styles.ruleType}>
                      {rule.type === 'street_cleaning'
                        ? '🧹 Street Cleaning'
                        : rule.type === 'snow_route'
                        ? '❄️ Snow Route'
                        : '🅿️ Permit Zone'}
                    </Text>
                    <Text style={styles.ruleMessage}>{rule.message}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.allClear}>✅ No restrictions found</Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    padding: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  testButton: {
    marginVertical: 8,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  address: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  rulesContainer: {
    marginTop: 8,
  },
  ruleCard: {
    backgroundColor: '#fff5f5',
    borderLeftWidth: 4,
    borderLeftColor: '#ff4444',
    padding: 12,
    marginBottom: 8,
    borderRadius: 4,
  },
  ruleType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff4444',
    marginBottom: 4,
  },
  ruleMessage: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  allClear: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
});

export default App;
