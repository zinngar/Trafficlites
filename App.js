// Trafficlites - MVP React Native App with Map, Markers, and Report Button // Using Expo

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Alert, TouchableOpacity } from 'react-native'; // Removed Button
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

// Open or create a database file
const db = SQLite.openDatabase('local_reports.db');

export default function App() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reportStatus, setReportStatus] = useState('');
  const [predictionData, setPredictionData] = useState(null); // State for prediction

  // Dummy traffic light data for markers - this should eventually come from backend or be dynamic
  const trafficLights = [
    // { id: 1, title: 'Main & 1st Ave', coords: { latitude: -26.6505, longitude: 153.0908 }, status: 'green', },
    { id: 2, title: 'Beach Rd & 2nd St', coords: { latitude: -26.6525, longitude: 153.0915 }, status: 'red', },
    { id: 3, title: 'Park Lane & 3rd Blvd', coords: { latitude: -26.6515, longitude: 153.0925 }, status: 'yellow', },
  ];


  // Get initial location
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setLocation(location.coords);
    })();
  }, []);

  // Effect for DB initialization and initial sync
  useEffect(() => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS pending_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          status TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          synced INTEGER DEFAULT 0
        );`,
        [], // Parameters
        () => {
          console.log('Table pending_reports initialized successfully');
          syncPendingReports(); // Sync on app start after table is confirmed
        },
        (_, error) => console.error('Error initializing table pending_reports:', error)
      );
    });
  }, []);

  const syncPendingReports = async () => {
    console.log('Attempting to sync pending reports...');
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM pending_reports WHERE synced = 0;',
        [],
        async (_, { rows: { _array: pendingReports } }) => {
          if (pendingReports.length === 0) {
            console.log('No pending reports to sync.');
            return;
          }
          console.log(`Found ${pendingReports.length} reports to sync.`);

          for (const report of pendingReports) {
            try {
              const response = await fetch('http://localhost:4000/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  latitude: report.latitude,
                  longitude: report.longitude,
                  status: report.status,
                  timestamp: report.timestamp, // Send original timestamp for potential backend processing
                }),
              });

              if (response.ok) {
                console.log(`Report ID ${report.id} (from local DB) synced successfully to server.`);
                // Mark as synced in local DB
                db.transaction(updateTx => {
                  updateTx.executeSql(
                    'UPDATE pending_reports SET synced = 1 WHERE id = ?;',
                    [report.id],
                    (_, { rowsAffected }) => {
                      if (rowsAffected > 0) {
                        console.log(`Local report ID ${report.id} marked as synced.`);
                      }
                    },
                    (_, error) => console.error(`Error marking report ID ${report.id} as synced:`, error)
                  );
                });
              } else {
                console.warn(`API sync failed for local report ID ${report.id} with status ${response.status}.`);
              }
            } catch (error) {
              console.error(`Network or other error syncing report ID ${report.id}:`, error);
            }
          }
        },
        (_, error) => console.error('Error fetching pending reports from SQLite:', error)
      );
    });
  };

  const reportLightStatus = (reportedStatus) => {
    if (!location) {
      Alert.alert("Location not available", "Cannot report light status without location.");
      return;
    }

    const currentTimestamp = new Date().toISOString();
    setReportStatus(reportedStatus.toUpperCase()); // Update UI state

    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO pending_reports (latitude, longitude, status, timestamp, synced) VALUES (?, ?, ?, ?, 0);',
        [location.latitude, location.longitude, reportedStatus, currentTimestamp],
        (_, { insertId, rowsAffected }) => {
          if (rowsAffected > 0) {
            console.log(`Report saved locally with ID: ${insertId}, Status: ${reportedStatus}`);
            Alert.alert('Reported Locally', `Light status '${reportedStatus.toUpperCase()}' saved locally.`);

            // Attempt to send to server
            fetch('http://localhost:4000/report', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                latitude: location.latitude,
                longitude: location.longitude,
                status: reportedStatus,
                // timestamp: currentTimestamp // Server generates its own timestamp upon receipt
              }),
            })
            .then(response => {
              if (response.ok) {
                console.log(`Report (local ID: ${insertId}) synced to server successfully.`);
                // Update local entry to synced = 1
                db.transaction(updateTx => {
                  updateTx.executeSql(
                    'UPDATE pending_reports SET synced = 1 WHERE id = ?;',
                    [insertId],
                    (_, { rowsAffected: updatedRows }) => {
                      if (updatedRows > 0) {
                        console.log(`Local report ID ${insertId} marked as synced.`);
                      }
                    },
                    (_, error) => console.error(`Error marking report ID ${insertId} as synced:`, error)
                  );
                });
                return response.json(); // Or handle response data
              } else {
                console.warn(`API request failed for local ID ${insertId} with status ${response.status}. Report remains unsynced.`);
                // Alert.alert('Sync Failed', 'Could not sync report to server. It remains saved locally.');
              }
            })
            .catch(error => {
              console.error(`Error syncing current report (local ID: ${insertId}) to server:`, error);
              // Alert.alert('Sync Error', 'Error connecting to server. Report remains saved locally.');
            })
            .finally(() => {
              // Attempt to sync any other pending reports after this operation
              syncPendingReports();
            });
          } else {
            console.error('Failed to save report locally (no rows affected).'); // This console log is fine
            Alert.alert('Save Failed', 'Could not save report locally.'); // User facing alert
          }
        },
        (_, error) => {
          console.error('SQLite error when saving report:', error);
          Alert.alert('Database Error', 'Failed to save report to local database.');
          return true; // Rollback transaction
        }
      );
    });
  };

  const fetchLightPrediction = async () => {
    if (!location) {
      Alert.alert("Location not available", "Cannot get prediction without current location.");
      setPredictionData(null);
      return;
    }
    setPredictionData({ loading: true }); // Indicate loading

    try {
      const response = await fetch(`http://localhost:4000/light_timings/${location.latitude}/${location.longitude}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error ${response.status}` }));
        console.warn(`Failed to fetch prediction: ${errorData.message}`);
        Alert.alert("Prediction Error", `Could not fetch prediction: ${errorData.message || 'Server error'}`);
        setPredictionData({ error: errorData.message || 'Server error' });
        return;
      }
      const data = await response.json();
      setPredictionData(data);
    } catch (error) {
      console.error('Error fetching light prediction:', error);
      Alert.alert("Network Error", "Failed to connect to server for prediction.");
      setPredictionData({ error: 'Network error' });
    }
  };

  return (
    <View style={styles.container}>
      {location ? (
        <>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: location.latitude,
              longitude: location.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            showsUserLocation={true}
          >
            {trafficLights.map((light) => ( // Using dummy data for markers
              <Marker
                key={light.id}
                coordinate={light.coords}
                title={light.title}
                description={`Light is ${light.status}`} // This status is from dummy data
                image={
                  light.status === 'green'
                    ? { uri: 'https://via.placeholder.com/32/008000/FFFFFF?Text=G' }
                    : light.status === 'yellow'
                    ? { uri: 'https://via.placeholder.com/32/FFFF00/000000?Text=Y' }
                    : { uri: 'https://via.placeholder.com/32/FF0000/FFFFFF?Text=R' }
                }
              />
            ))}
          </MapView>

          <View style={styles.buttonContainer}>
            <Text style={styles.reportText}>Report Light:</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.reportButton, styles.greenButton]}
                onPress={() => reportLightStatus('green')}
              >
                <Text style={styles.reportButtonText}>GREEN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportButton, styles.yellowButton]}
                onPress={() => reportLightStatus('yellow')}
              >
                <Text style={styles.reportButtonText}>YELLOW</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportButton, styles.redButton]}
                onPress={() => reportLightStatus('red')}
              >
                <Text style={styles.reportButtonText}>RED</Text>
              </TouchableOpacity>
            </View>
            {reportStatus && <Text style={styles.status}>Reported: {reportStatus.toUpperCase()}</Text>}

            <TouchableOpacity style={styles.predictButton} onPress={fetchLightPrediction}>
              <Text style={styles.predictButtonText}>Predict Light</Text>
            </TouchableOpacity>

            {predictionData && predictionData.loading && <Text style={styles.predictionText}>Loading prediction...</Text>}
            {predictionData && predictionData.error && <Text style={styles.predictionTextError}>Error: {predictionData.error}</Text>}
            {predictionData && !predictionData.loading && !predictionData.error && predictionData.prediction && (
              <View style={styles.predictionContainer}>
                <Text style={styles.predictionTitle}>Prediction for Nearest Light:</Text>
                <Text style={styles.predictionText}>Cluster ID: {predictionData.cluster_id}</Text>
                <Text style={styles.predictionText}>
                  Status: {predictionData.prediction.predicted_current_status.toUpperCase()}
                  {predictionData.prediction.predicted_time_remaining_seconds !== null
                    ? ` (Est. ${predictionData.prediction.predicted_time_remaining_seconds}s left)`
                    : ''}
                </Text>
                <Text style={styles.predictionText}>Confidence: {predictionData.prediction.prediction_confidence}</Text>
                <Text style={styles.predictionText}>Last Seen: {predictionData.prediction.last_seen_status} at {new Date(predictionData.prediction.last_seen_timestamp).toLocaleTimeString()}</Text>
                 {/* Optionally display average durations too */}
                 {/* <Text style={styles.predictionText}>Avg Green: {predictionData.average_durations.green}s</Text> */}
              </View>
            )}
          </View>
        </>
      ) : (
        <Text>{errorMsg || 'Getting location...'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  buttonContainer: { // This container holds the report buttons AND the prediction UI
    position: 'absolute',
    bottom: 20,
    right: 20,
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    alignItems: 'center', // Center items like the predict button if it's standalone
  },
  buttonRow: { // For Green, Yellow, Red buttons
    flexDirection: 'column',
  },
  reportText: { // "Report Light:"
    textAlign: 'center',
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  status: { // "Reported: GREEN"
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 5,
    marginBottom: 10, // Space before predict button
    color: '#555',
  },
  reportButton: { // For G, Y, R buttons
    paddingVertical: 12, // Increased padding for larger touch target
    paddingHorizontal: 15, // Increased padding
    borderRadius: 8,
    marginVertical: 5, // Space between stacked buttons
    alignItems: 'center', // Center text inside button
    justifyContent: 'center',
    minWidth: 100, // Ensure buttons have a decent minimum width
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.20,
    shadowRadius: 1.41,
  },
  reportButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16, // Larger text
    textAlign: 'center',
  },
  greenButton: {
    backgroundColor: '#28a745', // Bootstrap green
  },
  yellowButton: {
    backgroundColor: '#ffc107', // Bootstrap yellow
  },
  redButton: {
    backgroundColor: '#dc3545', // Bootstrap red
  },
  predictButton: {
    backgroundColor: '#007bff', // Bootstrap primary blue
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginVertical: 10, // Space around this button
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120, // Make it a bit wider
  },
  predictButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  predictionContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(230, 230, 230, 0.8)',
    borderRadius: 5,
  },
  predictionTitle: {
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 5,
    textAlign: 'center',
  },
  predictionText: {
    fontSize: 14,
    marginBottom: 3,
    textAlign: 'center',
  },
  predictionTextError: {
    fontSize: 14,
    marginBottom: 3,
    textAlign: 'center',
    color: 'red',
  }
});
