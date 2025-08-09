const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Serve static files from the Angular app build directory
const distPath = path.join(__dirname, 'dist/smart-alegra/browser');

// Debug: Check if dist folder exists
console.log('Checking dist path:', distPath);
console.log('Dist folder exists:', fs.existsSync(distPath));
if (fs.existsSync(distPath)) {
  console.log('Files in dist folder:', fs.readdirSync(distPath));
}

// Check if index.html exists
const indexPath = path.join(distPath, 'index.html');
console.log('Index.html exists:', fs.existsSync(indexPath));

app.use(express.static(distPath));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    distPath: distPath,
    indexExists: fs.existsSync(indexPath),
    files: fs.existsSync(distPath) ? fs.readdirSync(distPath) : []
  });
});

// For all GET requests, send back index.html so that PathLocationStrategy can be used
app.get('*', (req, res) => {
  console.log('Request for:', req.url);
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`
      <h1>Build files not found</h1>
      <p>Dist path: ${distPath}</p>
      <p>Index.html exists: ${fs.existsSync(indexPath)}</p>
      <p>Current directory: ${__dirname}</p>
      <p>Available files: ${fs.existsSync(distPath) ? fs.readdirSync(distPath).join(', ') : 'dist folder not found'}</p>
    `);
  }
});

// Start the app by listening on the default Railway port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Serving files from: ${distPath}`);
});
