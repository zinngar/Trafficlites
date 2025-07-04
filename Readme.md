Trafficlites App

🚦 Description

Trafficlites is a cross-platform mobile app (Android & iOS) that helps users report and predict traffic light statuses to avoid red lights and improve travel time. The app uses crowdsourced reports and backend data analysis to learn traffic patterns and suggest optimal routes.

Built with React Native + Expo on the frontend and Node.js + PostgreSQL on the backend.


---

📱 Mobile App (React Native + Expo)

Interactive map using react-native-maps

Location tracking via expo-location

Users can report traffic light colors: green, yellow, or red

Route drawing to selected traffic lights using Google Maps Directions API



---

🔧 Backend API (Node.js + Express + PostgreSQL)

RESTful API for submitting and retrieving traffic light reports

Stores user-submitted light status, location, and timestamp

Ready for future expansion with authentication and analytics



---

📦 Planned Features

User accounts & authentication

Real-time status prediction using ML

Smarter routing based on learned traffic patterns

Community trust system for quality reporting



---

🗂 Folder Structure (Current)

Trafficlites/
├── backend/                # Node.js API
│   ├── index.js
│   └── .env
├── mobile-app/            # React Native frontend
│   ├── App.js
│   └── assets/
└── README.md


---

## 🚀 Getting Started

This guide will walk you through setting up the Trafficlites application, including the backend API server and the frontend mobile app.

### Prerequisites

Before you begin, ensure you have the following software installed on your system:

*   **Node.js:** Required for both the frontend and backend. We recommend using the latest LTS (Long Term Support) version (e.g., Node.js 18.x or 20.x).
    *   *Verify installation:* `node -v`
*   **npm (Node Package Manager):** Comes bundled with Node.js. Used to manage project dependencies.
    *   *Verify installation:* `npm -v`
*   **Git:** Version control system. If you haven't cloned the repository yet, you'll need Git.
    *   *Verify installation:* `git --version`
*   **PostgreSQL:** An open-source relational database required for the backend server.
    *   *Verify installation (once installed and PATH is configured):* `psql --version`
    *   Ensure your PostgreSQL server is running before starting the backend.
*   **Expo CLI:** Command-line tool for developing and building Expo (React Native) applications.
    *   *Installation (if not yet installed globally):* `npm install -g expo-cli`
    *   *Verify installation:* `expo whoami` (or `expo --version`)

---

### Backend (API Server)

Follow these steps to set up and run the Node.js backend server, which connects to a PostgreSQL database.

1.  **Navigate to Backend Directory:**
    From the project's root directory, change into the backend API directory:
    ```bash
    cd Backend-api
    ```

2.  **Install Dependencies:**
    Install the necessary Node.js packages:
    ```bash
    npm install
    ```

3.  **Set Up PostgreSQL Database:**
    *   **Ensure PostgreSQL is Installed and Running:** Verify that your PostgreSQL server is operational (see Prerequisites).
    *   **Create Database and User:** You need to create a dedicated database and a user (role) for the application. Connect to your PostgreSQL instance (e.g., using `psql` or a GUI tool like pgAdmin) and run the following SQL commands. Replace `'your_strong_password'` with a secure password of your choice.

        ```sql
        CREATE DATABASE trafficlites;
        CREATE USER trafficlites_user WITH PASSWORD 'your_strong_password';
        GRANT ALL PRIVILEGES ON DATABASE trafficlites TO trafficlites_user;
        ALTER DATABASE trafficlites OWNER TO trafficlites_user; -- Optional, but good practice
        ```
        *Note: You might need superuser privileges in PostgreSQL to execute these commands.*

4.  **Configure Environment Variables:**
    The backend requires a `.env` file for database connection details.
    *   In the `Backend-api/` directory, create a new file named `.env`.
    *   Add the following line to it, replacing the placeholder username, password, host, port, and database name with your actual PostgreSQL setup details from the previous step.

        ```env
        DATABASE_URL="postgres://trafficlites_user:your_strong_password@localhost:5432/trafficlites"
        ```
        *Example Breakdown:*
        *   `trafficlites_user`: The user you created.
        *   `your_strong_password`: The password you set for `trafficlites_user`.
        *   `localhost:5432`: The host and port where your PostgreSQL server is running. Adjust if your setup differs.
        *   `trafficlites`: The database name you created.

5.  **Start the Backend Server:**
    Once the database is set up and the `.env` file is configured, start the backend server from the `Backend-api/` directory:
    ```bash
    node index.js
    ```
    (Alternatively, if a `start` script is defined in `Backend-api/package.json`, you might be able to use `npm start`).
    By default, the server will attempt to run on port 4000. Look for a confirmation message in the console, such as "Trafficlites backend listening on port 4000".

---

### Frontend (Mobile App)

These instructions guide you through setting up and running the React Native mobile application using Expo. Ensure you have installed Expo CLI as mentioned in the Prerequisites.

1.  **Navigate to Project Root & Install Dependencies:**
    Ensure you are in the project's root directory. Then, install the necessary Node.js packages for the Expo app:
    ```bash
    npm install
    ```
    *(Note: This assumes the frontend `package.json` is at the project root, alongside `App.js`)*

2.  **Start the Development Server:**
    Once dependencies are installed, start the Expo development server from the project root:
    ```bash
    expo start
    ```
    This will typically open a new tab in your web browser with the Expo Developer Tools and show a QR code in the terminal.

3.  **Run the App:**
    *   **On a Physical Device:** Install the "Expo Go" app (available on Android Play Store and iOS App Store) on your smartphone. Scan the QR code shown in the Expo Developer Tools or your terminal using the Expo Go app.
    *   **On an Emulator/Simulator:**
        *   **Android Emulator:** In the Expo Developer Tools (web interface), click "Run on Android device/emulator" (requires Android Studio and a configured Android Virtual Device).
        *   **iOS Simulator:** In the Expo Developer Tools, click "Run on iOS simulator" (requires Xcode and macOS).

---

### Running the Full Application

To use Trafficlites effectively, both the frontend mobile application and the backend API server must be running simultaneously.

1.  **Start the Backend Server First:**
    *   Open a terminal, navigate to the `Backend-api/` directory.
    *   Run `node index.js` (or your backend start command).
    *   Verify it connects to PostgreSQL and is listening (e.g., on port 4000).

2.  **Start the Frontend Mobile App:**
    *   Open another terminal, navigate to the project's root directory.
    *   Run `expo start`.
    *   Open the app on your device or emulator/simulator via Expo Go.

**Network Configuration Note:** The mobile app (frontend) is generally configured to send requests to the backend server at `http://localhost:4000`. If you are running the app on a physical device, ensure your device is on the same Wi-Fi network as your computer. You might need to use your computer's local network IP address in the app's API calls instead of `localhost` if `localhost` doesn't resolve correctly from the device. This typically involves changing the target URL in `App.js` where `fetch` is called.

---

🌍 Live Demo (Coming Soon)

Android APK and iOS TestFlight builds will be available via Expo EAS



---

🤝 Contributing

Contributions are welcome! Please open issues or submit pull requests.


---

📄 License

MIT


---

👤 Author

zinngar


---

✅ Status

✅ React Native app connected to backend<br> ✅ Traffic light markers and directions<br> 🚧 Data prediction and learning model – coming soon

