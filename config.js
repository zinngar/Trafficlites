// It is strongly recommended to use a library like react-native-dotenv
// to manage environment variables securely.
// For this cleanup, we are moving the key to a separate file
// to demonstrate better practice than hardcoding directly in the component.
// In a real project, this file should be added to .gitignore.

const config = {
    GOOGLE_MAPS_API_KEY: 'AIzaSyAOVYRIgupAurZup5y1PRh8Ismb1A3lLao' // Replace with your key
};

export default config;
