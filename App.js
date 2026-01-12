import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

// Open or create a database file
const db = SQLite.openDatabase('local_reports.db');

// --- Main App Component ---
export default function App() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // --- Database Functions ---
  const reportLightStatus = async (status) => {
    if (!location) {
        console.log("Location not available to report light status.");
        return;
    }
    const { latitude, longitude } = location;

    console.log(`Storing report locally: ${status} at ${latitude}, ${longitude}`);
    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO reports (latitude, longitude, status, timestamp) VALUES (?, ?, ?, ?)',
        [latitude, longitude, status, new Date().toISOString()],
        () => console.log('Report stored successfully'),
        (_, error) => console.error('Error storing report:', error)
      );
    });
  };

  // --- Effects ---
  useEffect(() => {
    // Request location permissions and get current location
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied. Please enable it in your settings.');
        return;
      }
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
    })();
  }, []);

  useEffect(() => {
    // Initialize the local database table
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL);`,
        [],
        () => console.log('reports table initialized'),
        (_, error) => console.error('DB Error creating table:', error)
      );
    });
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
          </MapView>

          <View style={styles.bottomControlsContainer}>
            <View style={styles.buttonContainer}>
              <Text style={styles.reportText}>Report Light:</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity style={[styles.reportButton, styles.greenButton]} onPress={() => reportLightStatus('green')}><Text style={styles.reportButtonText}>G</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.yellowButton]} onPress={() => reportLightStatus('yellow')}><Text style={styles.reportButtonText}>Y</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton,
                 styles.redButton]} onPress={() => reportLightStatus('red')}><Text style={styles.reportButtonText}>R</Text></TouchableOpacity>
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
    width: 200, // Fixed width for the button row
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
