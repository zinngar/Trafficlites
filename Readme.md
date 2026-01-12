# Trafficlites App

🚦 **Description**

Trafficlites is a cross-platform mobile app (Android & iOS) that helps users report and predict traffic light statuses to avoid red lights and improve travel time. The app uses crowdsourced reports and Supabase for data analysis to learn traffic patterns and suggest optimal routes.

Built with React Native and Expo, using Supabase for backend services.

---

📱 **Mobile App (React Native + Expo)**

- Interactive map using `react-native-maps`
- Location tracking via `expo-location`
- Users can report traffic light colors: green, yellow, or red
- Route drawing to selected traffic lights using Google Maps Directions API

---

🗂 **Folder Structure**

The repository is organized as follows:

```
Trafficlites/
├── assets/           # Image and font assets for the mobile app
├── database_schema/  # SQL schemas
├── src/              # Supabase client and other utilities
├── App.js            # Main React Native application component
├── config.js         # Frontend configuration (e.g., API keys)
├── package.json      # Frontend dependencies
└── Readme.md         # This file
```

---

## 🚀 Getting Started

This guide will walk you through setting up the Trafficlites application.

### Prerequisites

- **Node.js:** v18.x or later
- **npm:** v8.x or later
- **Git**
- **Expo CLI:** `npm install -g expo-cli`

---

### Setup

1.  **Install Dependencies:**
    From the project's root directory, run:
    ```bash
    npm install
    ```

2.  **Configure Supabase Keys:**
    Open the `config.js` file at the root of the project. You will need to add your own Supabase URL and anonymous key for the app to connect to the backend.
    ```javascript
    // config.js
    const config = {
      SUPABASE_URL: 'YOUR_SUPABASE_URL_HERE',
      SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY_HERE',
    };
    export default config;
    ```
    **Note:** For a real application, it is highly recommended to manage these keys securely and not commit them directly to version control.

3.  **Start the Development Server:**
    ```bash
    expo start
    ```

4.  **Run the App:**
    Use the Expo Go app on your physical device to scan the QR code, or run on an emulator/simulator through the Expo Dev Tools interface.

---

### ✅ Status

- ✅ React Native app connected to Supabase
- ✅ Traffic light markers and directions
- ✅ Codebase cleaned and refactored for maintainability
- 🚧 Data prediction and learning model – coming soon
