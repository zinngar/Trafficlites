# Trafficlites App

🚦 **Description**

Trafficlites is a cross-platform mobile app (Android & iOS) that helps users report and predict traffic light statuses. The app is fully standalone, using local storage to learn and predict traffic light patterns without needing a backend server.

Built with React Native, using AsyncStorage for local data persistence.

---

📱 **Mobile App (React Native)**

- Interactive map using `react-native-maps`.
- Location tracking via `react-native-geolocation-service`.
- Users can report traffic light colors (green, yellow, or red).
- Simple prediction model that learns average light durations based on user reports.
- Custom map markers that display the predicted status of known traffic lights.
- All data is stored locally on the device using `@react-native-async-storage/async-storage`.

---

🗂 **Folder Structure**

The repository is organized as follows:

```
Trafficlites/
├── android/          # Android native project
├── ios/              # iOS native project
├── assets/           # Image and font assets for the mobile app
├── App.js            # Main React Native application component
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
- **React Native CLI:** `npm install -g react-native-cli`
- **Android Studio** or **Xcode** for running on an emulator/simulator or a physical device.

---

### Setup

1.  **Install Dependencies:**
    From the project's root directory, run:
    ```bash
    npm install
    ```

2.  **Start the Development Server:**
    ```bash
    npx react-native start
    ```

3.  **Run the App:**
    - **For Android:**
      ```bash
      npx react-native run-android
      ```
    - **For iOS:**
      ```bash
      npx react-native run-ios
      ```

---

### ✅ Status

- ✅ React Native app with local data storage via AsyncStorage
- ✅ Traffic light reporting and simple prediction model
- ✅ Codebase cleaned and refactored for a standalone architecture
- ✅ Ejected from Expo to a bare React Native project
