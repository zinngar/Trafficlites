// Trafficlites - MVP React Native App with Map, Markers, and Report Button // Using Expo

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Alert, TouchableOpacity } from 'react-native'; // Removed Button
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

import { View, StyleSheet, Text, Alert, TouchableOpacity, TextInput } from 'react-native'; // Added TextInput
import MapView, { Marker, Polyline } from 'react-native-maps'; // Added Polyline
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

// Open or create a database file
const db = SQLite.openDatabase('local_reports.db');

// =====================================================================================
// IMPORTANT: GOOGLE MAPS API KEY REQUIRED FOR ROUTING
// -------------------------------------------------------------------------------------
// To use the route fetching functionality, you MUST obtain a Google Maps Directions API
// key and replace the placeholder below.
// 1. Go to Google Cloud Console (https://console.cloud.google.com/).
// 2. Create a project or select an existing one.
// 3. Enable the "Directions API" for your project.
// 4. Create an API key and **secure it properly** (e.g., restrict it to your app's
//    bundle ID for Android/iOS if deploying, or by IP for testing).
// 5. Replace 'YOUR_API_KEY_HERE' with your actual key.
// Without a valid key, the "Route & Lights" button will show an alert.
// =====================================================================================
const GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY_HERE';

// Polyline decoding (simplified version for demonstration)
// In a real app, use a library like @mapbox/polyline or google-polyline
function decodePolyline(encoded) {
  if (!encoded) return [];
  let points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}


export default function App() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reportStatus, setReportStatus] = useState('');
  const [predictionData, setPredictionData] = useState(null);
  const [destination, setDestination] = useState('');
  const [routePolyline, setRoutePolyline] = useState([]);
  const [onRouteLightPredictions, setOnRouteLightPredictions] = useState([]);
  const [departureAdvice, setDepartureAdvice] = useState(null); // State for departure advice

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

  // Helper function to get prediction for a single coordinate
  const getPredictionForCoordinate = async (lat, lon) => {
    try {
      const response = await fetch(`http://localhost:4000/light_timings/${lat}/${lon}`);
      if (!response.ok) {
        // Don't alert for each failed point, just log console warning
        console.warn(`Failed to fetch prediction for ${lat},${lon}: ${response.status}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching prediction for ${lat},${lon}:`, error);
      return null;
    }
  };

  const fetchRouteAndLightPredictions = async () => {
    if (!location || !destination) {
      Alert.alert("Missing information", "Current location and destination are required.");
      setRoutePolyline([]);
      setOnRouteLightPredictions([]);
      return;
    }
    if (GOOGLE_MAPS_API_KEY === 'YOUR_API_KEY_HERE') {
      Alert.alert("API Key Missing", "Please add your Google Maps API Key in App.js.");
      setRoutePolyline([]);
      setOnRouteLightPredictions([]);
      return;
    }

    setRoutePolyline([]); // Clear previous route
    setOnRouteLightPredictions([]); // Clear previous light predictions
    Alert.alert("Fetching Route...", "Please wait.");


    try {
      const origin = `${location.latitude},${location.longitude}`;
      const destinationQuery = destination;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destinationQuery}&key=${GOOGLE_MAPS_API_KEY}`;

      const routeResponse = await fetch(url);
      const routeJson = await routeResponse.json();

      if (routeJson.routes && routeJson.routes.length > 0) {
        const decodedPoints = decodePolyline(routeJson.routes[0].overview_polyline.points);
        setRoutePolyline(decodedPoints);

        // Identify lights on route
        const SAMPLING_INTERVAL = Math.max(1, Math.floor(decodedPoints.length / 20)); // Sample ~20 points, or at least 1
        const uniqueClusterPredictions = new Map();

        for (let i = 0; i < decodedPoints.length; i += SAMPLING_INTERVAL) {
          const point = decodedPoints[i];
          const predictionResult = await getPredictionForCoordinate(point.latitude, point.longitude);
          if (predictionResult && predictionResult.cluster_id && !uniqueClusterPredictions.has(predictionResult.cluster_id)) {
            // Store the full prediction data, keyed by cluster_id to ensure uniqueness
            uniqueClusterPredictions.set(predictionResult.cluster_id, {
              ...predictionResult, // Includes cluster_id, center, averages, and prediction object
              // Add the specific point on the polyline this cluster was found near, for marker placement
              route_coordinate: point
            });
          }
          // Add a small delay to avoid overwhelming the backend if too many points are sampled
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        setOnRouteLightPredictions(Array.from(uniqueClusterPredictions.values()));
        if (uniqueClusterPredictions.size === 0) {
            Alert.alert("Route Found", "Route displayed. No known traffic lights found along this route or no prediction data available.");
        } else {
            Alert.alert("Route Found", `Route displayed. Found ${uniqueClusterPredictions.size} traffic light(s) with predictions.`);
        }

      } else {
        Alert.alert("No Route Found", `Could not find a route. Status: ${routeJson.status} ${routeJson.error_message || ''}`);
      }
    } catch (err) {
      Alert.alert("Route Error", "An error occurred while fetching the route or light predictions.");
      console.error("Error in fetchRouteAndLightPredictions:", err);
    }
  };

  const fetchDepartureAdvice = async () => {
    if (!location || !destination) {
      Alert.alert("Missing Info", "Current location and destination are needed for departure advice.");
      setDepartureAdvice(null);
      return;
    }
    if (!routePolyline || routePolyline.length === 0) {
        Alert.alert("No Route", "Please get a route first before requesting departure advice.");
        setDepartureAdvice(null);
        return;
    }

    setDepartureAdvice({ loading: true }); // Indicate loading state

    try {
      const response = await fetch('http://localhost:4000/route_departure_advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: location.latitude, lon: location.longitude },
          destination: { lat: routePolyline[routePolyline.length -1].latitude, lon: routePolyline[routePolyline.length -1].longitude } // Use last point of current polyline as destination
          // Alternatively, pass the destination string or the full polyline if backend supports it
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error ${response.status}` }));
        console.warn(`Failed to fetch departure advice: ${errorData.message}`);
        Alert.alert("Advice Error", `Could not fetch departure advice: ${errorData.message || 'Server error'}`);
        setDepartureAdvice({ error: errorData.message || 'Server error' });
        return;
      }
      const data = await response.json();
      setDepartureAdvice(data);
    } catch (error) {
      console.error('Error fetching departure advice:', error);
      Alert.alert("Network Error", "Failed to connect to server for departure advice.");
      setDepartureAdvice({ error: 'Network error' });
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
            {routePolyline.length > 0 && (
              <Polyline
                coordinates={routePolyline}
                strokeColor="#007bff"
                strokeWidth={4}
              />
            )}
            {onRouteLightPredictions.map((item) => {
              let markerColor = 'grey';
              if (item.prediction && item.prediction.predicted_current_status) {
                const status = item.prediction.predicted_current_status.toLowerCase();
                if (status === 'green') markerColor = 'green';
                else if (status === 'yellow') markerColor = 'yellow';
                else if (status === 'red') markerColor = 'red';
              }
              return (
                <Marker
                  key={`route-light-${item.cluster_id}`}
                  coordinate={{
                    latitude: item.cluster_center.latitude,
                    longitude: item.cluster_center.longitude,
                  }}
                  pinColor={markerColor}
                  title={`Light ${item.cluster_id} Prediction`}
                  description={
                    item.prediction
                      ? `Status: ${item.prediction.predicted_current_status.toUpperCase()} (${item.prediction.prediction_confidence})\nTime Left: ${item.prediction.predicted_time_remaining_seconds ?? 'N/A'}s\nLast Seen: ${item.prediction.last_seen_status} at ${new Date(item.prediction.last_seen_timestamp).toLocaleTimeString()}`
                      : 'No prediction available'
                  }
                />
              );
            })}
            {!onRouteLightPredictions.length && trafficLights.map((light) => (
              <Marker
                key={`dummy-${light.id}`}
                coordinate={light.coords}
                title={light.title}
                description={`Dummy: Light is ${light.status}`}
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

            <TouchableOpacity style={styles.actionButton} onPress={fetchLightPrediction}>
              <Text style={styles.actionButtonText}>Predict Nearest</Text>
            </TouchableOpacity>

            {/* Destination Input and Route Button */}
            <View style={styles.destinationInputContainer}>
              <TextInput
                style={styles.destinationInput}
                placeholder="Enter destination (e.g., City Hall)"
                value={destination}
                onChangeText={setDestination}
              />
              <TouchableOpacity style={styles.actionButton} onPress={fetchRouteAndLightPredictions}>
                <Text style={styles.actionButtonText}>Route & Lights</Text>
              </TouchableOpacity>
            </View>

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

            {/* Departure Advice Button and Display */}
            {routePolyline.length > 0 && ( // Only show if a route is active
              <TouchableOpacity style={styles.actionButton} onPress={fetchDepartureAdvice}>
                <Text style={styles.actionButtonText}>Get Timing Advice</Text>
              </TouchableOpacity>
            )}
            {departureAdvice && departureAdvice.loading && <Text style={styles.predictionText}>Loading advice...</Text>}
            {departureAdvice && departureAdvice.error && <Text style={styles.predictionTextError}>Advice Error: {departureAdvice.error}</Text>}
            {departureAdvice && !departureAdvice.loading && !departureAdvice.error && (
              <View style={styles.adviceContainer}>
                <Text style={styles.predictionTitle}>Departure Advice:</Text>
                <Text style={styles.predictionText}>{departureAdvice.advice}</Text>
                {departureAdvice.optimal_departure_offset_seconds !== undefined && (
                  <Text style={styles.predictionText}>
                    Optimal Offset: {departureAdvice.optimal_departure_offset_seconds}s
                    (Saves ~{departureAdvice.wait_time_savings_seconds}s)
                  </Text>
                )}
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
  buttonContainer: {
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
    alignItems: 'center',
    maxWidth: '80%', // Prevent it from becoming too wide with lots of text
  },
  buttonRow: {
    flexDirection: 'column',
  },
  reportText: {
    textAlign: 'center',
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  status: {
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 5,
    marginBottom: 10,
    color: '#555',
  },
  reportButton: {
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
  actionButton: { // Generic style for Predict and Get Route buttons
    backgroundColor: '#007bff',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  actionButtonText: { // Text for those buttons
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  destinationInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 5,
  },
  destinationInput: {
    flex: 1,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 5,
    padding: 8,
    marginRight: 10,
    backgroundColor: '#fff',
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
  },
  adviceContainer: {
    marginTop: 5,
    padding: 8,
    backgroundColor: 'rgba(220, 220, 255, 0.85)', // Light blueish background
    borderRadius: 5,
    alignItems: 'center',
  }
});
