// Trafficlites - MVP React Native App with Map, Markers, and Report Button // Using Expo

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Alert, TouchableOpacity, TextInput, ScrollView, Modal } from 'react-native'; // Added Modal for detail panel
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

// Open or create a database file
const db = SQLite.openDatabase('local_reports.db');

const GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY_HERE'; // Replace with your key

function decodePolyline(encoded) {
  if (!encoded) return [];
  let points = []; let index = 0, len = encoded.length; let lat = 0, lng = 0;
  while (index < len) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  } return points;
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '');
}

const CLUSTERING_RADIUS_METERS = 50;

function getDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180; const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180; const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}


export default function App() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reportStatus, setReportStatus] = useState('');
  const [predictionData, setPredictionData] = useState(null);
  const [destination, setDestination] = useState('');
  const [routePolyline, setRoutePolyline] = useState([]);
  const [onRouteLightPredictions, setOnRouteLightPredictions] = useState([]);
  const [departureAdvice, setDepartureAdvice] = useState(null);
  const [googleRouteSteps, setGoogleRouteSteps] = useState([]);
  const [countdownSeconds, setCountdownSeconds] = useState(null);
  const [selectedLightDetails, setSelectedLightDetails] = useState(null); // For detail panel

  const trafficLights = [
    { id: 2, title: 'Beach Rd & 2nd St', coords: { latitude: -26.6525, longitude: 153.0915 }, status: 'red', },
    { id: 3, title: 'Park Lane & 3rd Blvd', coords: { latitude: -26.6515, longitude: 153.0925 }, status: 'yellow', },
  ];

  useEffect(() => { /* Get initial location */
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setErrorMsg('Location permission denied'); return; }
      let loc = await Location.getCurrentPositionAsync({}); setLocation(loc.coords);
    })();
  }, []);

  useEffect(() => { /* DB initialization */
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS pending_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, synced INTEGER DEFAULT 0);`,
        [], () => { console.log('pending_reports table initialized'); syncPendingReports(); },
        (_, error) => console.error('DB Error:', error)
      );
    });
  }, []);

  useEffect(() => { /* Countdown timer effect */
    let timerId = null;
    if (departureAdvice && typeof departureAdvice.optimal_departure_offset_seconds === 'number' && departureAdvice.optimal_departure_offset_seconds > 0 && !departureAdvice.error && !departureAdvice.loading) {
      setCountdownSeconds(departureAdvice.optimal_departure_offset_seconds);
      timerId = setInterval(() => {
        setCountdownSeconds(prevSeconds => {
          if (prevSeconds === null || prevSeconds <= 1) { clearInterval(timerId); return null; }
          return prevSeconds - 1;
        });
      }, 1000);
    } else {
      setCountdownSeconds(null);
    }
    return () => { if (timerId) clearInterval(timerId); };
  }, [departureAdvice]);

  const syncPendingReports = async () => { /* ... existing ... */ };
  const reportLightStatus = (reportedStatus) => { /* ... existing ... */ };
  const fetchLightPrediction = async () => { /* ... existing ... */ };
  const getPredictionForCoordinate = async (lat, lon) => { /* ... existing ... */ };
  const fetchRouteAndLightPredictions = async () => { /* ... existing, including setGoogleRouteSteps ... */};
  const fetchDepartureAdvice = async () => { /* ... existing ... */ };

  // --- Condensed existing async functions for brevity in this view ---
  // (Full implementations from previous steps are assumed)

  return (
    <View style={styles.container}>
      {location ? (
        <>
          <MapView style={styles.map} initialRegion={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }} showsUserLocation={true}>
            {routePolyline.length > 0 && <Polyline coordinates={routePolyline} strokeColor="#007bff" strokeWidth={4} />}
            {onRouteLightPredictions.map((item) => {
              let markerColor = 'grey';
              if (item.prediction && item.prediction.predicted_current_status) {
                const status = item.prediction.predicted_current_status.toLowerCase();
                if (status === 'green') markerColor = 'green'; else if (status === 'yellow') markerColor = 'yellow'; else if (status === 'red') markerColor = 'red';
              }
              return <Marker
                        key={`route-light-${item.cluster_id}`}
                        coordinate={{ latitude: item.cluster_center.latitude, longitude: item.cluster_center.longitude }}
                        pinColor={markerColor}
                        title={`Light ${item.cluster_id}`}
                        description={"Tap for details"} // Simpler description, details in panel
                        onPress={() => setSelectedLightDetails(item)} // Set selected light
                     />;
            })}
            {!onRouteLightPredictions.length && trafficLights.map((light) => ( <Marker key={`dummy-${light.id}`} coordinate={light.coords} title={light.title} description={`Dummy: ${light.status}`} /> ))}
          </MapView>

          <View style={styles.bottomControlsContainer}>
            {googleRouteSteps && googleRouteSteps.length > 0 && (
              <View style={styles.routeStepsOuterContainer}>
                <Text style={styles.instructionsTitle}>Route Instructions:</Text>
                <ScrollView style={styles.stepsScrollView}>
                  {googleRouteSteps.map((step, index) => (
                    <View key={index} style={styles.stepItem}>
                      <Text style={styles.stepInstruction}>{index + 1}. {stripHtml(step.html_instructions)}</Text>
                      <Text style={styles.stepDetails}>({step.distance.text} / {step.duration.text})</Text>
                      {(() => {
                        let lightPredText = '';
                        for (const predLight of onRouteLightPredictions) {
                          if (predLight.cluster_center && step.end_location && getDistance(predLight.cluster_center.latitude, predLight.cluster_center.longitude, step.end_location.lat, step.end_location.lng) < CLUSTERING_RADIUS_METERS * 0.75) {
                            lightPredText = `↳ Light ${predLight.cluster_id}: ${predLight.prediction.predicted_current_status.toUpperCase()} (~${predLight.prediction.predicted_time_remaining_seconds ?? 'N/A'}s, ${predLight.prediction.prediction_confidence} conf.)`;
                            break;
                          }
                        }
                        return lightPredText ? <Text style={styles.stepLightPrediction}>{lightPredText}</Text> : null;
                      })()}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={styles.buttonContainer}>
              {/* ... Report buttons, Predict Nearest, Destination Input, Route & Lights button ... */}
               <Text style={styles.reportText}>Report Light:</Text>
              <View style={styles.buttonRow}>{/* Report Buttons */}
                <TouchableOpacity style={[styles.reportButton, styles.greenButton]} onPress={() => reportLightStatus('green')}><Text style={styles.reportButtonText}>G</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.yellowButton]} onPress={() => reportLightStatus('yellow')}><Text style={styles.reportButtonText}>Y</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.redButton]} onPress={() => reportLightStatus('red')}><Text style={styles.reportButtonText}>R</Text></TouchableOpacity>
              </View>
              {reportStatus && <Text style={styles.status}>Reported: {reportStatus}</Text>}
              <TouchableOpacity style={styles.actionButton} onPress={fetchLightPrediction}><Text style={styles.actionButtonText}>Predict Nearest</Text></TouchableOpacity>
              <View style={styles.destinationInputContainer}>
                <TextInput style={styles.destinationInput} placeholder="Destination" value={destination} onChangeText={setDestination} />
                <TouchableOpacity style={styles.actionButton} onPress={fetchRouteAndLightPredictions}><Text style={styles.actionButtonText}>Route</Text></TouchableOpacity>
              </View>

              {/* Display for nearest light prediction (from fetchLightPrediction) */}
              {predictionData && predictionData.loading && <Text style={styles.predictionText}>Loading Prediction...</Text>}
              {predictionData && predictionData.error && <Text style={styles.predictionTextError}>Error: {predictionData.error}</Text>}
              {predictionData && !predictionData.loading && !predictionData.error && predictionData.prediction && (
                 <View style={styles.predictionContainer}>
                    <Text style={styles.predictionTitle}>Nearest Light Prediction:</Text>
                    {/* ... content ... */}
                 </View>
              )}

              {routePolyline.length > 0 && (<TouchableOpacity style={styles.actionButton} onPress={fetchDepartureAdvice}><Text style={styles.actionButtonText}>Timing Advice</Text></TouchableOpacity>)}
              {/* Departure Advice & Countdown Display */}
              {departureAdvice && departureAdvice.loading && <Text style={styles.predictionText}>Loading advice...</Text>}
              {/* ... departure advice display & countdown ... */}
            </View>
          </View>

          {/* Modal for Selected Light Details */}
          {selectedLightDetails && (
            <Modal
              animationType="slide"
              transparent={true}
              visible={selectedLightDetails !== null}
              onRequestClose={() => setSelectedLightDetails(null)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.lightDetailPanel}>
                  <Text style={styles.detailPanelTitle}>Light Details (Cluster ID: {selectedLightDetails.cluster_id})</Text>
                  <Text style={styles.detailPanelText}>Location: {selectedLightDetails.cluster_center.latitude.toFixed(4)}, {selectedLightDetails.cluster_center.longitude.toFixed(4)}</Text>

                  {selectedLightDetails.prediction && (<>
                    <Text style={styles.detailPanelText}>Predicted Status: {selectedLightDetails.prediction.predicted_current_status.toUpperCase()}</Text>
                    <Text style={styles.detailPanelText}>Time Remaining: {selectedLightDetails.prediction.predicted_time_remaining_seconds ?? 'N/A'}s</Text>
                    <Text style={styles.detailPanelText}>Confidence: {selectedLightDetails.prediction.prediction_confidence}</Text>
                    <Text style={styles.detailPanelText}>Last Seen: {selectedLightDetails.prediction.last_seen_status} at {new Date(selectedLightDetails.prediction.last_seen_timestamp).toLocaleTimeString()}</Text>
                  </>)}

                  {selectedLightDetails.average_durations && (<>
                    <Text style={styles.detailPanelSubtitle}>Average Durations:</Text>
                    <Text style={styles.detailPanelText}> - Green: {selectedLightDetails.average_durations.green ?? 'N/A'}s</Text>
                    <Text style={styles.detailPanelText}> - Yellow: {selectedLightDetails.average_durations.yellow ?? 'N/A'}s</Text>
                    <Text style={styles.detailPanelText}> - Red: {selectedLightDetails.average_durations.red ?? 'N/A'}s</Text>
                  </>)}

                  <TouchableOpacity style={[styles.actionButton, styles.detailPanelCloseButton]} onPress={() => setSelectedLightDetails(null)}>
                    <Text style={styles.actionButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}
        </>
      ) : ( <Text>{errorMsg || 'Getting location...'}</Text> )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ... (Keep existing styles)
  container: { flex: 1 }, map: { flex: 1 },
  bottomControlsContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', padding: 5, maxHeight: '45%', backgroundColor: 'rgba(0,0,0,0.05)' },
  routeStepsOuterContainer: { flex: 1.2, backgroundColor: 'rgba(250,250,250,0.9)', borderRadius: 10, padding: 8, margin: 5, maxHeight: '100%' },
  stepsScrollView: { flex: 1 },
  instructionsTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 5, textAlign: 'center' },
  stepItem: { paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  stepInstruction: { fontSize: 13, },
  stepDetails: { fontSize: 11, fontStyle: 'italic', color: '#444', marginLeft: 10 },
  stepLightPrediction: { fontSize: 11, color: '#007bff', marginLeft: 15, fontStyle: 'italic', marginTop: 2 },
  buttonContainer: { flex: 1, padding: 8, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 10, alignItems: 'center', marginLeft: 5, margin: 5, maxHeight: '100%', justifyContent: 'flex-start'},
  buttonRow: { flexDirection: 'row', justifyContent: 'space-around', width:'100%', marginBottom:5 },
  reportText: { textAlign: 'center', fontWeight: 'bold', marginBottom: 3, color: '#333' },
  status: { textAlign: 'center', fontStyle: 'italic', marginVertical: 3, color: '#555', fontSize: 12 },
  reportButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginHorizontal: 3, alignItems: 'center', justifyContent: 'center', flex: 1},
  reportButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  greenButton: { backgroundColor: '#28a745' }, yellowButton: { backgroundColor: '#ffc107' }, redButton: { backgroundColor: '#dc3545' },
  actionButton: { backgroundColor: '#007bff', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginVertical: 3, alignItems: 'center', justifyContent: 'center', minWidth: 100, width:'95%' },
  actionButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  destinationInputContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 3, width:'95%' },
  destinationInput: { flex: 1, borderColor: '#ccc', borderWidth: 1, borderRadius: 5, paddingVertical: 6, paddingHorizontal:8, marginRight: 5, backgroundColor: '#fff', fontSize:13 },
  predictionContainer: { marginTop: 5, padding: 8, backgroundColor: 'rgba(230,230,230,0.8)', borderRadius: 5, width:'95%', alignItems: 'center' },
  predictionTitle: { fontWeight: 'bold', fontSize: 14, marginBottom: 4, textAlign: 'center' },
  predictionText: { fontSize: 12, marginBottom: 2, textAlign: 'center' },
  predictionTextError: { fontSize: 12, marginBottom: 2, textAlign: 'center', color: 'red' },
  adviceContainer: { marginTop: 3, padding: 8, backgroundColor: 'rgba(220,220,255,0.85)', borderRadius: 5, alignItems: 'center', width:'95%' },
  countdownText: { fontSize: 16, fontWeight: 'bold', color: '#007bff', marginVertical: 5 },
  // Styles for Modal Light Detail Panel
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', // Semi-transparent background
  },
  lightDetailPanel: {
    width: '85%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    alignItems: 'stretch', // Stretch items like button
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  detailPanelTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  detailPanelSubtitle: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 5,
  },
  detailPanelText: {
    fontSize: 14,
    marginBottom: 5,
  },
  detailPanelCloseButton: {
    marginTop: 15,
    backgroundColor: '#6c757d', // A more neutral close button color
  }
});
