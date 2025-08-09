const express = require('express');
const path = require('path');

const app = express();

// Serve static files from the Angular app build directory
const distPath = path.join(__dirname, 'dist/smart-alegra');
app.use(express.static(distPath));

// For all GET requests, send back index.html so that PathLocationStrategy can be used
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start the app by listening on the default Railway port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Serving files from: ${distPath}`);
});
