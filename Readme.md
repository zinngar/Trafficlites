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

🚀 Getting Started

Mobile App

1. Install Expo CLI:

npm install -g expo-cli


2. Install dependencies:

cd mobile-app
npm install


3. Start the app:

expo start



Backend

1. Install dependencies:

cd backend
npm install


2. Set up PostgreSQL and create .env:

DATABASE_URL=postgres://user:password@localhost:5432/trafficlites


3. Start the server:

node index.js




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

