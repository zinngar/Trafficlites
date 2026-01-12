# Trafficlites App

🚦 **Description**

Trafficlites is a cross-platform mobile app (Android & iOS) that helps users report traffic light statuses. The app uses a local database to store reports and does not require a backend server.

Built with React Native and Expo.

---

📱 **Mobile App (React Native + Expo)**

- Interactive map using `react-native-maps`
- Location tracking via `expo-location`
- Users can report traffic light colors: green, yellow, or red
- All data is stored locally on the device.

---

🗂 **Folder Structure**

The repository is organized as follows:

```
Trafficlites/
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
- **Expo CLI:** `npm install -g expo-cli`

---

### Setup

1.  **Install Dependencies:**
    From the project's root directory, run:
    ```bash
    npm install
    ```

2.  **Start the Development Server:**
    ```bash
    expo start
    ```

3.  **Run the App:**
    Use the Expo Go app on your physical device to scan the QR code, or run on an emulator/simulator through the Expo Dev Tools interface.

---

### ✅ Status

- ✅ React Native app with local data storage
- ✅ Traffic light reporting functionality
- ✅ Codebase cleaned and refactored for maintainability
