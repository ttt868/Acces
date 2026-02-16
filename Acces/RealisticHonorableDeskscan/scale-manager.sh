# =============================================
# ACCESS NETWORK - Auto-Scale Manager
# Manages multi-server deployment on Hetzner Cloud
# =============================================

set -e

MAIN_SERVER_IP="89.167.14.197"
APP_DIR="/var/www/Acces/RealisticHonorableDeskscan"
DB_PORT=5432
PGBOUNCER_PORT=6432
REDIS_PORT=6379
APP_PORT=3000
NGINX_UPSTREAM_FILE="/etc/nginx/sites-available/access-loadbalancer"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[ACCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# === Status Command ===
cmd_status() {
    log "📊 ACCESS Network - System Status"
    echo ""
    
    echo "=== PM2 Processes ==="
    pm2 jlist 2>/dev/null | python3 -c "
import sys,json
ps=json.load(sys.stdin)
for p in ps:
    name=p['name']
    status=p['pm2_env']['status']
    pid=p['pid']
    mem=round(p['monit']['memory']/1024/1024,1)
    cpu=p['monit']['cpu']
    restarts=p['pm2_env']['restart_time']
    print(f'  {name}: {status} | PID:{pid} | RAM:{mem}MB | CPU:{cpu}% | Restarts:{restarts}')
"
    
    echo ""
    echo "=== PostgreSQL ==="
    sudo -u postgres psql -t -c "SELECT 'Connections: ' || numbackends || '/' || setting FROM pg_stat_database d, pg_settings s WHERE d.datname='access_db' AND s.name='max_connections';"
    sudo -u postgres psql -t -c "SELECT 'DB Size: ' || pg_size_pretty(pg_database_size('access_db'));"
    
    echo "=== PgBouncer ==="
    PGPASSWORD=AccessDB2026Secure psql -h 127.0.0.1 -p 6432 -U access_user -d access_db -t -c "SELECT 'Active via PgBouncer: OK'" 2>/dev/null || echo "  PgBouncer: DOWN"
    
    echo "=== Redis ==="
    redis-cli -a AccessRedis2026Secure info memory 2>/dev/null | grep -E 'used_memory_human|maxmemory_human'
    redis-cli -a AccessRedis2026Secure info clients 2>/dev/null | grep connected_clients
    
    echo ""
    echo "=== Nginx Upstream Servers ==="
    grep -E '^\s+server ' $NGINX_UPSTREAM_FILE 2>/dev/null | grep -v '#'
    
    echo ""
    echo "=== System Resources ==="
    echo "  CPUs: $(nproc)"
    echo "  RAM: $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
    echo "  Disk: $(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 " used)"}')"
    echo "  Load: $(cat /proc/loadavg | awk '{print $1, $2, $3}')"
}

# === Add New Server ===
cmd_add_server() {
    local NEW_IP=$1
    if [ -z "$NEW_IP" ]; then
        error "Usage: $0 add-server <IP>"
        exit 1
    fi
    
    log "🖥️ Adding new server: $NEW_IP"
    
    # 1. Add to Nginx upstream
    log "Adding to Nginx upstream..."
    sed -i "/# server NEW_SERVER_IP:3000/a\    server ${NEW_IP}:3000 weight=10 max_fails=3 fail_timeout=30s;" $NGINX_UPSTREAM_FILE
    nginx -t && systemctl reload nginx
    log "✅ Nginx updated"
    
    # 2. Add to PostgreSQL access
    PG_HBA=$(find /etc/postgresql -name pg_hba.conf | head -1)
    echo "host    access_db       access_user     ${NEW_IP}/32        scram-sha-256" >> $PG_HBA
    sudo -u postgres psql -c "SELECT pg_reload_conf();"
    log "✅ PostgreSQL access granted to $NEW_IP"
    
    # 3. Setup the new server via SSH
    log "Setting up new server $NEW_IP..."
    ssh -o StrictHostKeyChecking=no root@$NEW_IP << REMOTE
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx redis-tools

# Install PM2
npm install -g pm2

# Clone/sync app
mkdir -p /var/www/Acces
rsync -avz --exclude='node_modules' --exclude='.env' --exclude='logs' root@${MAIN_SERVER_IP}:${APP_DIR}/ /var/www/Acces/RealisticHonorableDeskscan/

# Create .env for worker (points to main server DB via PgBouncer)
cat > /var/www/Acces/RealisticHonorableDeskscan/.env << ENV
DATABASE_URL=postgresql://access_user:AccessDB2026Secure@${MAIN_SERVER_IP}:6432/access_db
NODE_ENV=production
PORT=3000
REDIS_URL=redis://${MAIN_SERVER_IP}:6379
SERVER_ROLE=worker
MAIN_SERVER=${MAIN_SERVER_IP}
ENV

# Install dependencies
cd /var/www/Acces/RealisticHonorableDeskscan
npm install --production

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

REMOTE
    
}

# === Remove Server ===
cmd_remove_server() {
    local REMOVE_IP=$1
    if [ -z "$REMOVE_IP" ]; then
        error "Usage: $0 remove-server <IP>"
        exit 1
    fi
    
    log "Removing server: $REMOVE_IP"
    
    # Remove from Nginx
    sed -i "/$REMOVE_IP/d" $NGINX_UPSTREAM_FILE
    nginx -t && systemctl reload nginx
    log "✅ Removed from Nginx"
    
    # Remove from PG HBA
    PG_HBA=$(find /etc/postgresql -name pg_hba.conf | head -1)
    sed -i "/$REMOVE_IP/d" $PG_HBA
    sudo -u postgres psql -c "SELECT pg_reload_conf();"
    log "✅ Removed from PostgreSQL"
}

# === Deploy to All Servers ===
cmd_deploy() {
    log "🚀 Deploying to all servers..."
    
    # Get list of upstream servers
    SERVERS=$(grep -oP 'server \K[0-9.]+' $NGINX_UPSTREAM_FILE | grep -v '127.0.0.1')
    
    for SERVER_IP in $SERVERS; do
        log "Deploying to $SERVER_IP..."
        rsync -avz --exclude='node_modules' --exclude='.env' --exclude='logs' --exclude='.pm2'             ${APP_DIR}/ root@${SERVER_IP}:${APP_DIR}/ 2>/dev/null
        ssh root@$SERVER_IP "cd $APP_DIR && npm install --production && pm2 restart all" 2>/dev/null
        log "✅ $SERVER_IP deployed"
    done
    
    # Deploy locally too
    log "Restarting local..."
    cd $APP_DIR && pm2 restart all --update-env
}

# === Health Check All ===
cmd_health() {
    log "🏥 Health Check - All Servers"
    echo ""
    
    # Local
    echo -n "  Main ($MAIN_SERVER_IP): "
    curl -s --max-time 5 http://localhost/api/health && echo " ✅" || echo " ❌ DOWN"
    
    # Remote servers
    SERVERS=$(grep -oP 'server \K[0-9.]+' $NGINX_UPSTREAM_FILE 2>/dev/null | grep -v '127.0.0.1')
    for SERVER_IP in $SERVERS; do
        echo -n "  Worker ($SERVER_IP): "
        curl -s --max-time 5 http://${SERVER_IP}:3000/api/health && echo " ✅" || echo " ❌ DOWN"
    done
}

# === Create Hetzner Server ===
cmd_create_server() {
    local SERVER_NAME=${1:-"access-worker-$(date +%s)"}
    
    if ! command -v hcloud &> /dev/null; then
        error "hcloud CLI not installed. Install with: apt install hcloud-cli"
        exit 1
    fi
    
    log "🏗️ Creating new Hetzner server: $SERVER_NAME"
    
    # Create server (same type as main: cax11)
    NEW_IP=$(hcloud server create --name $SERVER_NAME --type cax11 --image ubuntu-24.04 --location hel1 --ssh-key access-key -o columns=ipv4 -o noheader 2>/dev/null)
    
    if [ -z "$NEW_IP" ]; then
        error "Failed to create server. Make sure hcloud is configured."
        exit 1
    fi
    
    log "✅ Server created: $NEW_IP"
    log "Waiting 30s for server boot..."
    sleep 30
    
    # Setup the new server
    cmd_add_server $NEW_IP
    
}

# === Benchmark ===
cmd_benchmark() {
    log "⚡ Running Quick Benchmark..."
    echo ""
    
    # Test API response time
    echo "=== API Response Time (10 requests) ==="
    for i in $(seq 1 10); do
        TIME=$(curl -s -o /dev/null -w '%{time_total}' --max-time 10 http://localhost/api/health)
        echo "  Request $i: ${TIME}s"
    done
    
    echo ""
    echo "=== Database Query Time ==="
    PGPASSWORD=AccessDB2026Secure psql -h 127.0.0.1 -p 6432 -U access_user -d access_db -c "\timing" -c "SELECT count(*) FROM users;" 2>/dev/null
    
    echo ""
    echo "=== Concurrent Connections Test ==="
    echo "Testing 100 concurrent requests..."
    if command -v ab &> /dev/null; then
        ab -n 100 -c 20 http://localhost/api/health 2>/dev/null | grep -E 'Requests per second|Time per request|Failed'
    else
        echo "  Install apache2-utils for ab testing: apt install apache2-utils"
    fi
}

# === Main ===
case "${1:-status}" in
    status)        cmd_status ;;
    add-server)    cmd_add_server $2 ;;
    remove-server) cmd_remove_server $2 ;;
    deploy)        cmd_deploy ;;
    health)        cmd_health ;;
    create-server) cmd_create_server $2 ;;
    benchmark)     cmd_benchmark ;;
    *)
        echo "Usage: $0 {status|add-server|remove-server|deploy|health|create-server|benchmark}"
        echo ""
        echo "Commands:"
        echo "  status         - Show full system status"
        echo "  add-server IP  - Add existing server to cluster"
        echo "  remove-server  - Remove server from cluster"
        echo "  deploy         - Deploy code to all servers"
        echo "  health         - Health check all servers"
        echo "  create-server  - Create new Hetzner server automatically"
        echo "  benchmark      - Run performance benchmark"
        ;;
esac
