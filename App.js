// Trafficlites - MVP React Native App with Map, Markers, and Report Button // Using Expo

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Button, Alert, TouchableOpacity } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';

export default function App() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reportStatus, setReportStatus] = useState('');

  // Dummy traffic light data
  const trafficLights = [
    { id: 1, title: 'Main & 1st Ave', coords: { latitude: -26.6505, longitude: 153.0908 }, status: 'green', },
    { id: 2, title: 'Beach Rd & 2nd St', coords: { latitude: -26.6525, longitude: 153.0915 }, status: 'red', },
    { id: 3, title: 'Park Lane & 3rd Blvd', coords: { latitude: -26.6515, longitude: 153.0925 }, status: 'yellow', },
  ];

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

  const reportLightStatus = (status) => {
    setReportStatus(status);
    Alert.alert('Reported', `You reported: ${status.toUpperCase()} light`);

    // Example POST request (commented out - backend needed)

    fetch('http://localhost:4000/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        status: status,
      }),
})
.then(response => {
  if (!response.ok) {
    // If the server response is not OK (e.g., 404, 500), throw an error
    console.warn(`API request failed with status ${response.status}`);
    // Potentially update UI to show error to user
    // Alert.alert('Error', 'Failed to report status. Please try again.');
    return; // Or throw new Error('Network response was not ok');
  }
  // console.log('Report successful', response); // Or handle successful response data
})
.catch(error => {
  console.error('Error reporting light status:', error);
  // Update UI to show error to user
  // Alert.alert('Error', 'Could not connect to server to report status.');
    });

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
            {trafficLights.map((light) => (
              <Marker
                key={light.id}
                coordinate={light.coords}
                title={light.title}
                description={`Light is ${light.status}`}
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
    bottom: 20, // Adjust as needed for padding from screen bottom
    right: 20,  // Adjust as needed for padding from screen right
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Slightly transparent white
    borderRadius: 10, // Optional: for rounded corners
    elevation: 5, // Optional: for shadow on Android
    shadowColor: '#000', // Optional: for shadow on iOS
    shadowOffset: { width: 0, height: 2 }, // Optional: for shadow on iOS
    shadowOpacity: 0.25, // Optional: for shadow on iOS
    shadowRadius: 3.84, // Optional: for shadow on iOS
  },
  buttonRow: {
    flexDirection: 'column', // Stack buttons vertically
    // justifyContent: 'space-around', // Less relevant for vertical stack with individual button margins
    // marginVertical: 10, // Will be handled by individual button margins
  },
  reportText: {
    textAlign: 'center',
    fontWeight: 'bold',
    marginBottom: 10, // Add some space below the title
    color: '#333',
  },
  status: {
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 10, // Add some space above the status
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
});
