import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, TextInput, ScrollView, Modal } from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import { supabase } from './src/supabaseClient';

// Open or create a database file
const db = SQLite.openDatabase('local_reports.db');

// --- Helper Functions ---
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

// --- Child Components ---

const RouteInstructions = ({ steps, lightPredictions }) => {
    const findLightPredictionForStep = (step) => {
        for (const predLight of lightPredictions) {
            if (predLight.cluster_center && step.end_location && getDistance(predLight.cluster_center.latitude, predLight.cluster_center.longitude, step.end_location.lat, step.end_location.lng) < CLUSTERING_RADIUS_METERS * 0.75) {
                return `↳ Light ${predLight.cluster_id}: ${predLight.prediction.predicted_current_status.toUpperCase()} (~${predLight.prediction.predicted_time_remaining_seconds ?? 'N/A'}s, ${predLight.prediction.prediction_confidence} conf.)`;
            }
        }
        return null;
    };

    return (
        <View style={styles.routeStepsOuterContainer}>
            <Text style={styles.instructionsTitle}>Route Instructions:</Text>
            <ScrollView style={styles.stepsScrollView}>
                {steps.map((step, index) => {
                    const lightPredText = findLightPredictionForStep(step);
                    return (
                        <View key={index} style={styles.stepItem}>
                            <Text style={styles.stepInstruction}>{index + 1}. {stripHtml(step.html_instructions)}</Text>
                            <Text style={styles.stepDetails}>({step.distance.text} / {step.duration.text})</Text>
                            {lightPredText && <Text style={styles.stepLightPrediction}>{lightPredText}</Text>}
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
};

const LightDetailModal = ({ light, visible, onClose }) => {
    if (!light) return null;

    return (
        <Modal
            transparent={true}
            animationType="slide"
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.lightDetailPanel}>
                    <Text style={styles.detailPanelTitle}>Light Details</Text>
                    <Text style={styles.detailPanelText}>Cluster ID: {light.cluster_id}</Text>
                    {light.prediction && (
                        <>
                            <Text style={styles.detailPanelSubtitle}>Prediction</Text>
                            <Text style={styles.detailPanelText}>Status: {light.prediction.predicted_current_status}</Text>
                            <Text style={styles.detailPanelText}>Time Remaining: {light.prediction.predicted_time_remaining_seconds ?? 'N/A'}s</Text>
                            <Text style={styles.detailPanelText}>Confidence: {light.prediction.prediction_confidence}</Text>
                        </>
                    )}
                    <TouchableOpacity style={[styles.actionButton, styles.detailPanelCloseButton]} onPress={onClose}>
                        <Text style={styles.actionButtonText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};


// --- Main App Component ---
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
  const [selectedLightDetails, setSelectedLightDetails] = useState(null);
  const [supabaseStatus, setSupabaseStatus] = useState('Checking...');

  // --- API Functions ---
  const reportLightStatus = async (status) => {
    if (!location) return;
    const { latitude, longitude } = location;
    const { data, error } = await supabase
      .from('reports')
      .insert([{ latitude, longitude, status }]);

    if (error) {
      console.error('Error reporting light status:', error);
      // If there's an error, store the report locally
      db.transaction(tx => {
        tx.executeSql(
          'INSERT INTO pending_reports (latitude, longitude, status, timestamp) VALUES (?, ?, ?, ?)',
          [latitude, longitude, status, new Date().toISOString()]
        );
      });
    } else {
      console.log('Report sent successfully');
    }
  };

  const syncPendingReports = async () => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM pending_reports WHERE synced = 0',
        [],
        async (_, { rows }) => {
          if (rows.length > 0) {
            const reports = rows._array;
            console.log(`Syncing ${reports.length} pending reports...`);
            const { error } = await supabase.from('reports').insert(reports.map(r => ({
              latitude: r.latitude,
              longitude: r.longitude,
              status: r.status,
              created_at: r.timestamp,
            })));

            if (!error) {
              const ids = reports.map(r => r.id).join(',');
              tx.executeSql(`UPDATE pending_reports SET synced = 1 WHERE id IN (${ids})`);
              console.log('Pending reports synced successfully');
            } else {
              console.error('Error syncing pending reports:', error);
            }
          }
        }
      );
    });
  };

  const fetchLightPrediction = async () => {
    if (!location) return;
    const { latitude, longitude } = location;
    const { data, error } = await supabase.rpc('get_nearby_light_data', {
        lat: latitude,
        lon: longitude
    });

    if (error) {
      console.error('Error fetching light prediction:', error);
    } else {
      setPredictionData(data);
    }
  };


  // --- Effects ---
  useEffect(() => {
    // Check supabase connection
    if (supabase) {
      setSupabaseStatus('Connected');
    } else {
      setSupabaseStatus('Disconnected');
    }

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
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS pending_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, synced INTEGER DEFAULT 0);`,
        [], () => { console.log('pending_reports table initialized'); syncPendingReports(); },
        (_, error) => console.error('DB Error:', error)
      );
    });
  }, []);

  useEffect(() => {
    let timerId = null;
    if (departureAdvice && typeof departureAdvice.optimal_departure_offset_seconds === 'number' && departureAdvice.optimal_departure_offset_seconds > 0) {
      setCountdownSeconds(departureAdvice.optimal_departure_offset_seconds);
      timerId = setInterval(() => {
        setCountdownSeconds(prev => (prev <= 1 ? null : prev - 1));
      }, 1000);
    } else {
      setCountdownSeconds(null);
    }
    return () => clearInterval(timerId);
  }, [departureAdvice]);


  return (
    <View style={styles.container}>
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>Supabase: {supabaseStatus}</Text>
      </View>
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
            {routePolyline.length > 0 && <Polyline coordinates={routePolyline} strokeColor="#007bff" strokeWidth={4} />}
            {onRouteLightPredictions
              .filter(item => item && item.cluster_center)
              .map((item) => (
                <Marker
                    key={`route-light-${item.cluster_id}`}
                    coordinate={{ latitude: item.cluster_center.latitude, longitude: item.cluster_center.longitude }}
                    pinColor={item.prediction?.predicted_current_status?.toLowerCase() || 'grey'}
                    title={`Light ${item.cluster_id}`}
                    onPress={() => setSelectedLightDetails(item)}
                />
            ))}
          </MapView>

          <View style={styles.bottomControlsContainer}>
            {googleRouteSteps.length > 0 && <RouteInstructions steps={googleRouteSteps} lightPredictions={onRouteLightPredictions} />}

            <View style={styles.buttonContainer}>
              <Text style={styles.reportText}>Report Light:</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity style={[styles.reportButton, styles.greenButton]} onPress={() => reportLightStatus('green')}><Text style={styles.reportButtonText}>G</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.yellowButton]} onPress={() => reportLightStatus('yellow')}><Text style={styles.reportButtonText}>Y</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.reportButton, styles.redButton]} onPress={() => reportLightStatus('red')}><Text style={styles.reportButtonText}>R</Text></TouchableOpacity>
              </View>
              {/* Other controls... */}
            </View>
          </View>

          <LightDetailModal
            light={selectedLightDetails}
            visible={!!selectedLightDetails}
            onClose={() => setSelectedLightDetails(null)}
          />
        </>
      ) : ( <Text>{errorMsg || 'Getting location...'}</Text> )}
       {supabaseStatus !== 'Connected' && (
        <View style={styles.serverWarning}>
          <Text style={styles.serverWarningText}>{supabaseStatus}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statusBar: { backgroundColor: '#f8f9fa', paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#dee2e6', alignItems: 'center' },
  statusText: { fontSize: 12, color: '#495057' },
  serverWarning: { position: 'absolute', top: 50, left: 0, right: 0, backgroundColor: 'rgba(255, 236, 179, 0.9)', padding: 12, alignItems: 'center', },
  serverWarningText: { color: '#856404', fontWeight: 'bold' },
  map: { flex: 1 },
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
  actionButton: { backgroundColor: '#007bff', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginVertical: 3, alignItems: 'center', justifyContent: 'center', minWidth: 100, width:'95%' },
  actionButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  greenButton: { backgroundColor: '#28a745' },
  yellowButton: { backgroundColor: '#ffc107' },
  redButton: { backgroundColor: '#dc3545' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)'},
  lightDetailPanel: { width: '85%', backgroundColor: 'white', borderRadius: 10, padding: 20, alignItems: 'stretch', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
  detailPanelTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  detailPanelSubtitle: { fontSize: 15, fontWeight: 'bold', marginTop: 10, marginBottom: 5 },
  detailPanelText: { fontSize: 14, marginBottom: 5 },
  detailPanelCloseButton: { marginTop: 15, backgroundColor: '#6c757d' }
});
