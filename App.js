import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, PermissionsAndroid, Platform } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- Main App Component ---
export default function App() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [lightPredictions, setLightPredictions] = useState([]);

  // --- AsyncStorage Functions ---
  const reportLightStatus = async (status) => {
    if (!location) {
      console.log("Location not available to report light status.");
      return;
    }

    const intersectionId = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const now = new Date().getTime();

    try {
      const existingData = await AsyncStorage.getItem(intersectionId);
      let lightData = existingData ? JSON.parse(existingData) : {
        intersectionId,
        lastSeen: null,
        timestamp: null,
        avgRedDuration: 45, // Default average
        avgGreenDuration: 45, // Default average
        redTimestamps: [],
        greenTimestamps: [],
      };

      if (lightData.lastSeen && lightData.timestamp) {
        const duration = (now - lightData.timestamp) / 1000;

        if (lightData.lastSeen === 'red' && status === 'green') {
          lightData.redTimestamps.push(duration);
          if (lightData.redTimestamps.length > 5) lightData.redTimestamps.shift();
          const avg = lightData.redTimestamps.reduce((a, b) => a + b, 0) / lightData.redTimestamps.length;
          lightData.avgRedDuration = Math.round(avg);
        } else if (lightData.lastSeen === 'green' && status === 'red') {
          lightData.greenTimestamps.push(duration);
          if (lightData.greenTimestamps.length > 5) lightData.greenTimestamps.shift();
          const avg = lightData.greenTimestamps.reduce((a, b) => a + b, 0) / lightData.greenTimestamps.length;
          lightData.avgGreenDuration = Math.round(avg);
        }
      }

      lightData.lastSeen = status;
      lightData.timestamp = now;

      await AsyncStorage.setItem(intersectionId, JSON.stringify(lightData));
      console.log('Report stored:', lightData);
      fetchPredictions();
    } catch (error) {
      console.error('Error storing report:', error);
    }
  };

  const fetchPredictions = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const items = await AsyncStorage.multiGet(keys);
      const now = new Date().getTime();
      const predictions = items.map(item => {
        const data = JSON.parse(item[1]);
        const timeSinceLastSeen = (now - data.timestamp) / 1000;
        let predictedStatus = 'grey';

        if (data.lastSeen === 'red' && timeSinceLastSeen < data.avgRedDuration) {
          predictedStatus = 'red';
        } else if (data.lastSeen === 'green' && timeSinceLastSeen < data.avgGreenDuration) {
          predictedStatus = 'green';
        }

        const [latitude, longitude] = data.intersectionId.split(',').map(Number);
        return { ...data, predictedStatus, latitude, longitude };
      });
      setLightPredictions(predictions);
    } catch (error) {
      console.error('Error fetching predictions:', error);
    }
  };

  // --- Effects ---
  useEffect(() => {
    const requestLocationPermission = async () => {
      if (Platform.OS === 'ios') {
        const authStatus = await Geolocation.requestAuthorization('whenInUse');
        if (authStatus === 'granted') {
          getLocation();
        } else {
          setErrorMsg('Location permission denied');
        }
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'This app needs access to your location.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          getLocation();
        } else {
          setErrorMsg('Location permission denied');
        }
      }
    };

    const getLocation = () => {
      Geolocation.getCurrentPosition(
        (position) => {
          setLocation(position.coords);
        },
        (error) => {
          setErrorMsg(error.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    };

    requestLocationPermission();
  }, []);

  useEffect(() => {
    fetchPredictions();
    const interval = setInterval(fetchPredictions, 5000); // Refresh predictions every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      {location ? (
        <>
          <MapView
            style={styles.map}
            initialRegion={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
            showsUserLocation={true}
          >
            <UrlTile
              urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maximumZ={19}
            />
            {lightPredictions.map(p => (
              <Marker
                key={p.intersectionId}
                coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                pinColor={p.predictedStatus}
                title={`Status: ${p.predictedStatus.toUpperCase()}`}
              />
            ))}
          </MapView>

          <View style={styles.bottomControlsContainer}>
            <View style={styles.buttonContainer}>
              <Text style={styles.reportText}>Report Light:</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity style={[styles.reportButton, styles.greenButton]} onPress={() => reportLightStatus('green')}><Text style={styles.reportButtonText}>G</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.yellowButton]} onPress={() => reportLightStatus('yellow')}><Text style={styles.reportButtonText}>Y</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.redButton]} onPress={() => reportLightStatus('red')}><Text style={styles.reportButtonText}>R</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </>
      ) : ( <Text>{errorMsg || 'Getting location...'}</Text> )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  bottomControlsContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center'
  },
  buttonContainer: {
    padding: 15,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: 200,
    marginTop: 10
  },
  reportText: {
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
    color: '#333'
  },
  reportButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 10,
  },
  reportButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 20,
  },
  greenButton: { backgroundColor: '#28a745' },
  yellowButton: { backgroundColor: '#ffc107' },
  redButton: { backgroundColor: '#dc3545' },
});
