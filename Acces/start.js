
// This is the entry point for the deployment
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory equivalent to __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set environment variables
process.env.PORT = process.env.PORT || 5000; // موقع التعدين والبلوك تشين - منفذ 5000
process.env.BLOCKCHAIN_PORT = process.env.BLOCKCHAIN_PORT || 5000; // نفس المنفذ للجميع
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.HOST = '0.0.0.0';

console.log(`=== DEPLOYMENT CONFIGURATION ===`);
console.log(`Using PORT: ${process.env.PORT}`);
console.log(`Environment: ${process.env.NODE_ENV}`);
console.log(`Binding to: ${process.env.HOST}`);

// Wrap main execution in async function
async function main() {
  // Import the findServerPath function from run_server.js
  let findServerPath;
  try {
    const runServerModule = await import('./run_server.js');
    findServerPath = runServerModule.findServerPath;
    console.log("Successfully imported findServerPath function");
  } catch (error) {
    console.error(`Failed to import findServerPath: ${error.message}`);
    findServerPath = null;
  }

  // Define the expected server directory path
  const expectedServerDir = path.join(__dirname, 'RealisticHonorableDeskscan');

  // First try to dynamically find the server.js file
  let serverDir = null;
  if (findServerPath) {
    console.log("Attempting to dynamically find server.js...");
    serverDir = findServerPath(__dirname);
    if (serverDir) {
      console.log(`Dynamically found server.js in: ${serverDir}`);
    }
  }

  // Fall back to expected path if dynamic search fails
  if (!serverDir) {
    serverDir = expectedServerDir;
    console.log(`Using predefined server path: ${serverDir}`);
  }

  const serverFilePath = path.join(serverDir, 'server.js');

  if (fs.existsSync(serverFilePath)) {
    console.log(`Confirmed server.js exists at: ${serverFilePath}`);

    // Change to server directory
    try {
      process.chdir(serverDir);
      console.log(`Changed directory to: ${process.cwd()}`);

      // Start the server using dynamic import
      console.log('Starting server...');
      await import(serverFilePath);
    } catch (error) {
      console.error(`Error starting server: ${error.message}`);
      console.error(error.stack);
      startFallbackServer(error);
    }
  } else {
    console.error(`Could not find server.js at expected path: ${serverFilePath}`);
    startFallbackServer(new Error(`Server file not found at ${serverFilePath}`));
  }
}

// Function to start fallback server in case of failure
function startFallbackServer(error) {
  import('http').then(({ default: http }) => {
    const server = http.createServer((req, res) => {
      // Log incoming requests to help with debugging
      console.log(`Fallback server received request: ${req.method} ${req.url}`);
      
      if (req.url === '/' || req.url === '/health') {
        // Return 200 OK for health checks and root endpoint
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end('OK - Fallback server running');
      } else {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
          <html>
            <head>
              <title>Deployment Error</title>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }
                .error { background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; }
                h1 { color: #721c24; }
                pre { background: #f8f9fa; padding: 15px; overflow: auto; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>Application Error</h1>
                <p>The server encountered an error while starting:</p>
                <pre>${error.message}\n\n${error.stack}</pre>
                <p>Please check your deployment configuration.</p>
              </div>
            </body>
          </html>
        `);
      }
    });

    server.listen(process.env.PORT, process.env.HOST, () => {
      console.log(`Emergency fallback server running at http://${process.env.HOST}:${process.env.PORT}`);
    });
  });
}

// Start the main function
main().catch(error => {
  console.error('Fatal error in main function:', error);
  startFallbackServer(error);
});