
#!/bin/bash

# Launch script for AccessoireCrypto
echo "=== ACCESSOIRECRYPTO LAUNCHER ==="
echo "Starting deployment process..."

# Run verification
echo "Running deployment verification..."
node verify-deployment.js

if [ $? -ne 0 ]; then
  echo "Verification failed. Aborting deployment."
  exit 1
fi

# Change to app directory
cd RealisticHonorableDeskscan

# Install dependencies
echo "Installing dependencies..."
npm install

# Try different ports with proper incrementing
declare -a PORTS=(3000 8080 3001 3002 3003)

for PORT in "${PORTS[@]}"; do
  echo "Attempting to start server on port $PORT..."
  
  # Set environment variables and start server
  export PORT=$PORT
  export NODE_ENV=production
  
  # Start server in the background and capture PID
  node server.js &
  SERVER_PID=$!
  
  # Wait a moment to see if server starts
  sleep 2
  
  # Check if process is still running
  if kill -0 $SERVER_PID 2>/dev/null; then
    echo "Server successfully started on port $PORT"
    # Keep the process running in the foreground
    wait $SERVER_PID
    exit 0
  else
    echo "Failed to start on port $PORT, trying next port..."
  fi
done

echo "Failed to start server on any port. Please check if multiple instances are running."
exit 1