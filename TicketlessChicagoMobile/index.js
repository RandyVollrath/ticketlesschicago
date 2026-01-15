/**
 * @format
 */

// Import polyfills FIRST before anything else
import './src/polyfills';

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
