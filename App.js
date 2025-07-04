// Trafficlites - MVP React Native App with Map, Markers, and Report Button // Using Expo

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Alert, TouchableOpacity, TextInput, ScrollView } from 'react-native';
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

const CLUSTERING_RADIUS_METERS = 50; // Defined here for frontend use in getDistance if needed by UI logic

function getDistance(lat1, lon1, lat2, lon2) { // Haversine, also needed for UI logic potentially
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


  const trafficLights = [ // Dummy data
    { id: 2, title: 'Beach Rd & 2nd St', coords: { latitude: -26.6525, longitude: 153.0915 }, status: 'red', },
    { id: 3, title: 'Park Lane & 3rd Blvd', coords: { latitude: -26.6515, longitude: 153.0925 }, status: 'yellow', },
  ];

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setErrorMsg('Location permission denied'); return; }
      let loc = await Location.getCurrentPositionAsync({}); setLocation(loc.coords);
    })();
  }, []);

  useEffect(() => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS pending_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, synced INTEGER DEFAULT 0);`,
        [], () => { console.log('pending_reports table initialized'); syncPendingReports(); },
        (_, error) => console.error('DB Error:', error)
      );
    });
  }, []);

  useEffect(() => { // Countdown timer effect
    let timerId = null;
    if (departureAdvice && typeof departureAdvice.optimal_departure_offset_seconds === 'number' && departureAdvice.optimal_departure_offset_seconds > 0 && !departureAdvice.error && !departureAdvice.loading) {
      setCountdownSeconds(departureAdvice.optimal_departure_offset_seconds);
      timerId = setInterval(() => {
        setCountdownSeconds(prevSeconds => {
          if (prevSeconds === null || prevSeconds <= 1) {
            clearInterval(timerId);
            return null;
          }
          return prevSeconds - 1;
        });
      }, 1000);
    } else {
      setCountdownSeconds(null);
    }
    return () => { if (timerId) clearInterval(timerId); };
  }, [departureAdvice]);


  const syncPendingReports = async () => { /* ... full logic ... */
    db.transaction(tx => {
        tx.executeSql('SELECT * FROM pending_reports WHERE synced = 0;', [], async (_, { rows: { _array } }) => {
            if (_array.length === 0) return; console.log(`Syncing ${_array.length} reports...`);
            for (const report of _array) {
                try { /* ... fetch logic ... */
                    const r = await fetch('http://localhost:4000/report', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(report)});
                    if(r.ok) tx.executeSql('UPDATE pending_reports SET synced = 1 WHERE id = ?;', [report.id]);
                } catch (e) { console.error("Sync error", e); }
            }
        });
    });
  };

  const reportLightStatus = (reportedStatus) => { /* ... full logic ... */
    if(!location) {Alert.alert("Location missing"); return;}
    const ts = new Date().toISOString(); setReportStatus(reportedStatus.toUpperCase());
    db.transaction(tx => {
        tx.executeSql('INSERT INTO pending_reports (latitude, longitude, status, timestamp, synced) VALUES (?, ?, ?, ?, 0);',
        [location.latitude, location.longitude, reportedStatus, ts],
        (_, {insertId}) => {
            Alert.alert("Reported Locally");
            fetch('http://localhost:4000/report', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({latitude:location.latitude, longitude:location.longitude, status:reportedStatus})})
            .then(r => { if(r.ok) db.transaction(utx => utx.executeSql('UPDATE pending_reports SET synced = 1 WHERE id = ?;', [insertId])); })
            .catch(e => console.error("Report sync error",e))
            .finally(()=> syncPendingReports());
        }, (_,e)=>{Alert.alert("DB Save Error"); return true;});
    });
  };

  const fetchLightPrediction = async () => { /* ... full logic ... */
    if(!location) {Alert.alert("Location missing"); return;} setPredictionData({loading:true});
    try{
        const r = await fetch(`http://localhost:4000/light_timings/${location.latitude}/${location.longitude}`);
        if(!r.ok){ const ed = await r.json().catch(()=>({message: `HTTP ${r.status}`})); setPredictionData({error: ed.message}); return;}
        setPredictionData(await r.json());
    }catch(e){setPredictionData({error: 'Network error'});}
  };

  const getPredictionForCoordinate = async (lat, lon) => { /* ... full logic ... */
    try{
        const r = await fetch(`http://localhost:4000/light_timings/${lat}/${lon}`);
        if(!r.ok) return null; return await r.json();
    }catch(e){return null;}
  };

  const fetchRouteAndLightPredictions = async () => { /* ... full logic, including setGoogleRouteSteps ... */
    if (!location || !destination) { Alert.alert("Info", "Location & destination needed."); setRoutePolyline([]); setOnRouteLightPredictions([]); setGoogleRouteSteps([]); setDepartureAdvice(null); return; }
    if (GOOGLE_MAPS_API_KEY === 'YOUR_API_KEY_HERE') { Alert.alert("API Key Missing", "Add Google Maps API Key."); setRoutePolyline([]); setOnRouteLightPredictions([]); setGoogleRouteSteps([]); setDepartureAdvice(null); return; }
    setRoutePolyline([]); setOnRouteLightPredictions([]); setGoogleRouteSteps([]); setDepartureAdvice(null);
    Alert.alert("Fetching Route...", "Please wait.");
    try {
      const origin = `${location.latitude},${location.longitude}`;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${GOOGLE_MAPS_API_KEY}`;
      const routeResponse = await fetch(url); const routeJson = await routeResponse.json();
      if (routeJson.routes && routeJson.routes.length > 0) {
        const route = routeJson.routes[0]; const decodedPoints = decodePolyline(route.overview_polyline.points);
        setRoutePolyline(decodedPoints);
        if (route.legs && route.legs.length > 0 && route.legs[0].steps) { setGoogleRouteSteps(route.legs[0].steps); } else { setGoogleRouteSteps([]); }
        const SAMPLING_INTERVAL = Math.max(1, Math.floor(decodedPoints.length / 20));
        const uniqueClusterPredictions = new Map();
        for (let i = 0; i < decodedPoints.length; i += SAMPLING_INTERVAL) {
          const point = decodedPoints[i]; const predictionResult = await getPredictionForCoordinate(point.latitude, point.longitude);
          if (predictionResult && predictionResult.cluster_id && !uniqueClusterPredictions.has(predictionResult.cluster_id)) {
            uniqueClusterPredictions.set(predictionResult.cluster_id, { ...predictionResult, route_coordinate: point });
          } await new Promise(resolve => setTimeout(resolve, 50));
        }
        setOnRouteLightPredictions(Array.from(uniqueClusterPredictions.values()));
        Alert.alert("Route Found", `Found ${uniqueClusterPredictions.size} light(s).`);
      } else { Alert.alert("No Route", `Status: ${routeJson.status}`); }
    } catch (err) { Alert.alert("Route Error", "Error fetching route."); console.error(err); }
  };

  const fetchDepartureAdvice = async () => { /* ... full logic ... */
    if (!location || !destination || !routePolyline || routePolyline.length === 0) { Alert.alert("Info", "Location, destination, and route needed."); setDepartureAdvice(null); return; }
    setDepartureAdvice({ loading: true });
    try {
      const resp = await fetch('http://localhost:4000/route_departure_advice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: { lat: location.latitude, lon: location.longitude }, destination: { lat: routePolyline[routePolyline.length -1].latitude, lon: routePolyline[routePolyline.length -1].longitude }})});
      if (!resp.ok) { const ed = await resp.json().catch(()=>({message: `HTTP ${resp.status}`})); setDepartureAdvice({ error: ed.message }); return; }
      setDepartureAdvice(await resp.json());
    } catch (e) { setDepartureAdvice({ error: 'Network error' }); }
  };

  return (
    <View style={styles.container}>
      {location ? (
        <>
          <MapView style={styles.map} initialRegion={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }} showsUserLocation={true}>
            {routePolyline.length > 0 && <Polyline coordinates={routePolyline} strokeColor="#007bff" strokeWidth={4} />}
            {onRouteLightPredictions.map((item) => { /* On-route light markers */
              let markerColor = 'grey'; if (item.prediction && item.prediction.predicted_current_status) { const status = item.prediction.predicted_current_status.toLowerCase(); if (status === 'green') markerColor = 'green'; else if (status === 'yellow') markerColor = 'yellow'; else if (status === 'red') markerColor = 'red';}
              return <Marker key={`route-light-${item.cluster_id}`} coordinate={{ latitude: item.cluster_center.latitude, longitude: item.cluster_center.longitude }} pinColor={markerColor} title={`Light ${item.cluster_id}`} description={item.prediction ? `Status: ${item.prediction.predicted_current_status.toUpperCase()} (${item.prediction.prediction_confidence})\nTime Left: ${item.prediction.predicted_time_remaining_seconds ?? 'N/A'}s` : 'No prediction'} />;
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
                      {(() => { /* Simplified Light prediction per step */
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
              {predictionData && predictionData.loading && <Text>Loading Prediction...</Text>}
              {/* ... Prediction display ... */}
              {routePolyline.length > 0 && (<TouchableOpacity style={styles.actionButton} onPress={fetchDepartureAdvice}><Text style={styles.actionButtonText}>Timing Advice</Text></TouchableOpacity>)}

              {/* Departure Advice & Countdown Display */}
              {departureAdvice && departureAdvice.loading && <Text style={styles.predictionText}>Loading advice...</Text>}
              {departureAdvice && departureAdvice.error && <Text style={styles.predictionTextError}>Advice Error: {departureAdvice.error}</Text>}
              {departureAdvice && !departureAdvice.loading && !departureAdvice.error && (
                <View style={styles.adviceContainer}>
                  <Text style={styles.predictionTitle}>Departure Advice:</Text>
                  {countdownSeconds !== null && countdownSeconds > 0 ? (
                    <Text style={styles.countdownText}>Depart in: {countdownSeconds}s</Text>
                  ) : (
                    <Text style={styles.predictionText}>{departureAdvice.advice}</Text>
                  )}
                  {departureAdvice.optimal_departure_offset_seconds !== undefined && countdownSeconds === null && (
                    <Text style={styles.predictionText}>Optimal Offset: {departureAdvice.optimal_departure_offset_seconds}s (Saves ~{departureAdvice.wait_time_savings_seconds}s)</Text>
                  )}
                </View>
              )}
            </View>
          </View>
        </>
      ) : ( <Text>{errorMsg || 'Getting location...'}</Text> )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ... (Keep existing styles, add/modify as needed)
  container: { flex: 1 }, map: { flex: 1 },
  bottomControlsContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', padding: 5, maxHeight: '45%', backgroundColor: 'rgba(0,0,0,0.05)' },
  routeStepsOuterContainer: { flex: 1.2, backgroundColor: 'rgba(250,250,250,0.9)', borderRadius: 10, padding: 8, margin: 5, maxHeight: '100%' },
  stepsScrollView: { flex: 1 }, // Allow scroll view to take available height in its container
  instructionsTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 5, textAlign: 'center' },
  stepItem: { paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  stepInstruction: { fontSize: 13, },
  stepDetails: { fontSize: 11, fontStyle: 'italic', color: '#444', marginLeft: 10 },
  stepLightPrediction: { fontSize: 11, color: '#007bff', marginLeft: 15, fontStyle: 'italic', marginTop: 2 },
  buttonContainer: { flex: 1, padding: 8, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 10, alignItems: 'center', marginLeft: 5, margin: 5, maxHeight: '100%', justifyContent: 'flex-start'},
  buttonRow: { flexDirection: 'row', justifyContent: 'space-around', width:'100%', marginBottom:5 }, // Changed to row for G,Y,R
  reportText: { textAlign: 'center', fontWeight: 'bold', marginBottom: 3, color: '#333' },
  status: { textAlign: 'center', fontStyle: 'italic', marginVertical: 3, color: '#555', fontSize: 12 },
  reportButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginHorizontal: 3, alignItems: 'center', justifyContent: 'center', flex: 1}, // flex:1 for equal width
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
  countdownText: { fontSize: 16, fontWeight: 'bold', color: '#007bff', marginVertical: 5 }
});
