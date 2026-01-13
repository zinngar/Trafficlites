// script.js - Gun.js PoC for Trafficlites

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Gun.
    // Using default peers. For production, you might specify your own relay peers:
    // const gun = Gun(['https://gunjs.herokuapp.com/gun', /* other reliable peers */]);
    const gun = Gun();

    const reportsNode = gun.get('traffic_reports_p2p_v1'); // Use a unique key for your app's data
    const reportsDisplayUl = document.getElementById('reportsDisplay');
    const statusInput = document.getElementById('statusInput');
    const latitudeInput = document.getElementById('latitudeInput');
    const longitudeInput = document.getElementById('longitudeInput');
    const submitReportBtn = document.getElementById('submitReportBtn');

    // Clear initial "Loading..." message
    if (reportsDisplayUl) {
        reportsDisplayUl.innerHTML = '';
    }

    // Handle Report Submission
    if (submitReportBtn) {
        submitReportBtn.addEventListener('click', () => {
            const status = statusInput.value.trim();
            const lat = parseFloat(latitudeInput.value);
            const lon = parseFloat(longitudeInput.value);

            if (!status) {
                alert('Please enter a status.');
                return;
            }
            if (isNaN(lat) || isNaN(lon)) {
                alert('Please enter valid latitude and longitude.');
                return;
            }

            const reportId = Gun.SEA.random(16).toString(); // Generate a random ID
            const timestamp = new Date().toISOString();

            const newReport = {
                status: status,
                latitude: lat,
                longitude: lon,
                timestamp: timestamp,
                // id: reportId // The key in Gun serves as the ID, but can include if needed
            };

            // Put the data into Gun, keyed by the unique reportId
            // This will broadcast to other peers.
            reportsNode.get(reportId).put(newReport, ack => {
                if (ack.err) {
                    console.error('Gun put error:', ack.err);
                    alert('Error submitting report: ' + ack.err);
                } else {
                    console.log('Report submitted to Gun graph, ack:', ack);
                    // Optionally clear inputs, though display will update automatically
                    statusInput.value = '';
                    // latitudeInput.value = ''; // Keep lat/lon for easier subsequent reports?
                    // longitudeInput.value = '';
                }
            });
        });
    }

    // Display Reports (Listen for data on the 'traffic_reports' node)
    reportsNode.map().on((reportData, reportKey) => {
        if (!reportsDisplayUl) return;

        if (reportData) {
            // Report data exists (added or updated)
            let listItem = document.getElementById(`report-${reportKey}`);
            if (!listItem) {
                // New report, create list item
                listItem = document.createElement('li');
                listItem.id = `report-${reportKey}`;
                reportsDisplayUl.appendChild(listItem);
            }
            // Update content (covers both new and updated reports)
            listItem.textContent =
                `ID: ${reportKey.substring(0, 6)}... - Status: ${reportData.status}, ` +
                `Coords: (${reportData.latitude}, ${reportData.longitude}), ` +
                `Time: ${new Date(reportData.timestamp).toLocaleTimeString()}`;
        } else {
            // Report data is null, meaning it was "deleted" or nulled out in Gun
            let listItem = document.getElementById(`report-${reportKey}`);
            if (listItem) {
                listItem.remove();
            }
        }
    });

    console.log('Gun.js P2P Trafficlites PoC initialized.');
    if (reportsDisplayUl && reportsDisplayUl.children.length === 0) {
         const li = document.createElement('li');
         li.textContent = 'Listening for reports on the P2P network...';
         li.style.color = '#777';
         reportsDisplayUl.appendChild(li);
    }
});
