# Trafficlites App

🚦 **Description**

Trafficlites is a cross-platform mobile app (Android & iOS) that helps users report and predict traffic light statuses to avoid red lights and improve travel time. The app uses crowdsourced reports and backend data analysis to learn traffic patterns and suggest optimal routes.

Built with React Native + Expo on the frontend and Node.js + PostgreSQL on the backend.

---

📱 **Mobile App (React Native + Expo)**

- Interactive map using `react-native-maps`
- Location tracking via `expo-location`
- Users can report traffic light colors: green, yellow, or red
- Route drawing to selected traffic lights using Google Maps Directions API

---

🔧 **Backend API (Node.js + Express + PostgreSQL)**

- RESTful API for submitting and retrieving traffic light reports
- Stores user-submitted light status, location, and timestamp
- Ready for future expansion with authentication and analytics

---

🗂 **Folder Structure**

The repository is organized as follows:

```
Trafficlites/
├── Backend-api/      # Node.js API server
│   ├── services.js   # Business logic (predictions, etc.)
│   ├── index.js      # Main server file
│   ├── package.json
│   └── .env          # Environment variables
│
├── assets/           # Image and font assets for the mobile app
├── database_schema/  # SQL schemas
├── App.js            # Main React Native application component
├── config.js         # Frontend configuration (e.g., API keys)
├── package.json      # Frontend dependencies
└── Readme.md         # This file
```

---

## 🚀 Getting Started

This guide will walk you through setting up the Trafficlites application, including the backend API server and the frontend mobile app.

### Prerequisites

- **Node.js:** v18.x or later
- **npm:** v8.x or later
- **Git**
- **PostgreSQL:** A running instance
- **Expo CLI:** `npm install -g expo-cli`

---

### Backend (API Server)

1.  **Navigate to Backend Directory:**
    ```bash
    cd Backend-api
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Set Up PostgreSQL Database:**
    Connect to your PostgreSQL instance and run the following commands:
    ```sql
    CREATE DATABASE trafficlites;
    CREATE USER trafficlites_user WITH PASSWORD 'your_strong_password';
    GRANT ALL PRIVILEGES ON DATABASE trafficlites TO trafficlites_user;
    ```

4.  **Configure Environment Variables:**
    In the `Backend-api/` directory, create a file named `.env` and add your database connection string:
    ```env
    DATABASE_URL="postgres://trafficlites_user:your_strong_password@localhost:5432/trafficlites"
    ```

5.  **Start the Backend Server:**
    ```bash
    npm start
    ```
    The server will run on port 4000 by default.

---

### Frontend (Mobile App)

1.  **Navigate to Project Root & Install Dependencies:**
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

- ✅ React Native app connected to backend
- ✅ Traffic light markers and directions
- ✅ Codebase cleaned and refactored for maintainability
- 🚧 Data prediction and learning model – coming soon
