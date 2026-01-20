Access Network - Cryptocurrency & Blockchain Platform
Overview
Access Network is a comprehensive cryptocurrency and blockchain platform featuring daily fitness rewards, social interactions, and a custom Layer-1 blockchain. The platform combines a mobile-first web application with an enterprise-grade blockchain infrastructure, supporting wallet management, transaction processing, and a reward system.

Core Purpose: Provide users with a daily reward system for fitness activities while maintaining a fully functional cryptocurrency network with its own blockchain explorer and transaction capabilities.

User Preferences
Preferred communication style: Simple, everyday language.

System Architecture
Frontend Architecture
Technology Stack: Vanilla JavaScript, HTML5, CSS3
Design Pattern: Single Page Application (SPA) with dynamic page loading
UI Framework: Custom component-based system without external frameworks
Key Features:
Multi-page navigation system (dashboard, wallet, blockchain explorer)
Real-time WebSocket connections for live updates
Responsive mobile-first design
Google OAuth integration for authentication
Backend Architecture
Runtime: Node.js (ES Modules)
Web Server: Express.js 5.x
Architecture Pattern: Microservices-oriented with modular API handlers
Key Components:
Custom blockchain implementation with Proof of Stake Authority (PoSA) consensus
Transaction queue system with batch processing
WebSocket server for real-time updates
Multi-tier caching system (L1/L2/L3 cache layers)
Enterprise-grade security and anti-attack monitoring
Blockchain Infrastructure
Consensus Algorithm: Enhanced PoSA (Proof of Stake Authority)
Block Time: 12 seconds (optimized like Ethereum - balanced performance)
Transaction Processing:
Batch processing with 1000+ transactions per batch
Priority queue system based on gas price
Mempool management with retry logic
Network Details:
Chain ID: 22888
Network ID: 22888
Native Currency: ACCESS token (18 decimals)
RPC endpoint on port 5000
Block Archiving (OPTIMIZED 2024-10-15):
Automatic archiving of old blocks (keeps 30 days)
Runs cleanup every 24 hours
Reduces storage footprint and improves performance
Similar to Ethereum's approach to historical data
Data Storage Solutions
Primary Database: PostgreSQL with SSL
Connection Pooling (OPTIMIZED FOR HIGH CONCURRENCY - 2024-10-15):
Max 40 concurrent connections (doubled for scale)
Min 5 idle connections for instant response
Extended timeouts (30-180s) for slow networks
Lock timeout: 120s (extended for complex operations)
Throttled database writes (5s interval per address)
Batch processing for pending writes (2s intervals)
Exponential backoff retry logic for lock conflicts
Handles timeout errors gracefully
Caching Strategy:
L1 Cache: 10K hot addresses (5s TTL)
L2 Cache: 100K warm addresses (30s TTL)
L3 Cache: 1M cold addresses (5min TTL)
File Storage: Ethereum-style persistent storage for blocks, state, and transactions
Key Tables:
users: User accounts, wallet info, processing status
blockchain_transactions: All network transactions
external_wallets: External wallet connections
processing_history: Mining/processing reward history
transaction_queue: Enterprise transaction queue
balance_cache: High-speed balance lookup
Authentication & Authorization
Primary Method: Google OAuth 2.0 (Firebase Authentication)
Session Management: Server-side session tracking with user IDs
Wallet Security:
AES-256-GCM encryption for private keys
Encrypted storage in database
Secure key generation using elliptic curve cryptography
AUTO-WALLET CREATION (OPTIMIZED 2024-10-15):
Wallet automatically generated during signup/account creation
Deterministic wallet generation from user email (SHA256 hash)
Instant display on dashboard and network page without delays
generateWalletForNewUser() called for both standard and Google OAuth signup
No "Generating..." delays - wallet_address available immediately in currentUser
API Security: CORS enabled, request validation, rate limiting considerations
Processing/Mining System
Reward Mechanism: Daily 24-hour processing sessions
Base Reward: 0.24+ ACCESS per session
Boost System: 
- Referral-based multipliers (+0.4 XP/s per active referral)
- Ad Boost System (+1.2 XP/s, equivalent to 3 active referrals)
Time Tracking: Simplified seconds-based countdown system
Session Management (HARDENED 2024-10-13):
Start/stop processing functionality with timeout protection
Automatic accumulation calculation
Protection against session manipulation
Emergency reward recovery system
Duplicate Prevention: Server-side validation prevents duplicate records
Network Resilience: 15-20s timeout on all requests with retry logic
Button Protection: Disabled state during requests prevents double-clicks
Transaction Safety: All processing operations use database transactions

Ad Boost System (ADDED 2025-01-11)
Purpose: Allow users to boost mining hashrate by watching rewarded ads
Boost Value: +1.2 XP/s (equivalent to 3 active referrals)
Duration: One mining session only (24 hours max)
Cooldown: 24 hours between ad boosts
Architecture:
- Client-Side: Google Publisher Tag (GPT) for rewarded ad display
- Server-Side: Strict verification and fraud prevention
- Database: ad_rewards table tracks all ad transactions
Implementation Details:
- computeHashrateMultiplier(): Single source of truth for hashrate calculations
- Integrates with referral boost system seamlessly
- Auto-activates on mining session start if boost granted
- Auto-clears on session end (completion or manual stop)
- Server-side transaction ID tracking prevents duplicate rewards
API Endpoints:
- GET /api/ad-boost/check - Verify eligibility (24h cooldown check)
- POST /api/ad-boost/grant - Grant boost after ad completion
- GET /api/ad-boost/status - Check current boost status
Security Features:
- Server-side cooldown enforcement (24 hours)
- Transaction ID deduplication
- One boost per mining session maximum
- Automatic boost clearing on session termination
Referral System
Referral Rewards (SIMPLIFIED & OPTIMIZED - 2024-10-15):
Exactly 0.15 ACCESS to referrer (person who shared code)
Exactly 0.15 ACCESS to referee (person who used code)
SIMPLE & FAST PROCESSING:
Direct reward distribution without complex checks
Database UNIQUE constraint on referee_id prevents duplicates automatically
Server generates and manages all referral codes (client never creates codes)
Referral code stays with user forever (even if account recreated)
Security Measures:
Self-referral prevention
Each user can only be referred ONCE (DB constraint enforces this)
Comprehensive logging for audit trail
Balance Protection System (CRITICAL - 2024-10-15)
🛡️ MAXIMUM PROTECTION against balance loss:
NEVER delete users - Only update profile data, preserve all balances
Audit Logging - Every balance change is logged in balance_audit_log table
Protected Update Functions:
logBalanceChange() - Logs all balance modifications
updateUserBalance() - Protected balance update with automatic audit trail
Audit Log Fields:
user_id, email, old_balance, new_balance, change_amount
operation_type (referral, processing, transfer, etc.)
reason, ip_address, timestamp
User Data Safety:
Missing profile data (name/avatar) triggers UPDATE only, not deletion
All user data preserved even if profile incomplete
Balance always protected regardless of account state
Transaction Processing Pipeline
Transaction Creation: Validation of sender, recipient, amount, gas
Queue Addition: Enterprise transaction queue with priority
Batch Processing: 500ms intervals, up to 1000 tx per batch
Balance Updates: Multi-tier cache update + database persistence
Blockchain Recording: Permanent storage in blocks
Confirmation: Real-time WebSocket notifications
Performance Optimizations
Database Indexing: 15+ specialized indexes on critical tables
Batch Operations: Grouped DB operations to reduce round trips
Auto-scaling: Resource optimization for cloud deployment
Debouncing: 5-second debounce on frequent operations
Lazy Loading: On-demand data fetching
Migration & Deployment Support
Multi-Platform Support: Configuration for Replit, Railway, Heroku, DigitalOcean
Migration Tools: Automated database migration scripts
Environment Templates: Pre-configured .env templates per platform
Health Checks: Automated deployment verification
External Dependencies
Third-Party Services
Firebase: Authentication (Google OAuth)
PostgreSQL Database: Primary data storage (Neon/Railway/Heroku compatible)
Replit Object Storage: File persistence (@replit/object-storage)
Blockchain Libraries
ethers.js (v6.15.0): Ethereum-compatible wallet and transaction utilities
viem (v2.37.3): Low-level Ethereum interactions
wagmi (v2.16.9): React hooks for Ethereum (if React integration added)
@reown/appkit: Web3 wallet connection kit
elliptic (v6.6.1): Elliptic curve cryptography for key generation
ethereumjs-util (v7.1.5): Ethereum utility functions
rlp (v3.0.0): Recursive Length Prefix encoding
Infrastructure
Express.js (v5.1.0): HTTP server framework
ws (v8.18.3): WebSocket server implementation
pg (v8.16.0): PostgreSQL client
dotenv (v16.5.0): Environment variable management
node-fetch (v2.7.0): HTTP client for Node.js
Network Configuration
RPC Endpoint: Custom implementation on port 5000
WebSocket: Real-time updates and wallet connections
Block Explorer: Custom Etherscan-compatible API
Chainlist Integration: Network metadata for wallet addition
Security & Monitoring
Anti-Attack System: Built-in DDoS, double-spending, and rapid transaction protection
Error Management: Intelligent error suppression and logging
Data Protection: Multi-level backup and recovery system
Encryption: AES-256-GCM for sensitive data
Development Tools
Migration Helper: Database migration between platforms
Health Check Scripts: Deployment verification
Database Utilities: Schema management, cleanup scripts
Performance Monitoring: Real-time stats and optimization

Recent Updates (October 24, 2025)
🔧 Critical RPC Fixes for Trust Wallet Compatibility

✅ Fixed "index out of bounds" Errors:
Problem: Trust Wallet was showing "index 1 out of bounds for length 0" errors
Root Cause: RPC responses returning null or undefined instead of proper arrays
Solution: Implemented comprehensive fixes across all RPC endpoints

RPC Method Improvements:
1. eth_getBlockByNumber:
   - ✅ Now returns proper block object even when blockchain is empty
   - ✅ Transactions array is ALWAYS an array (never null/undefined)
   - ✅ Added genesis block placeholder for empty chains
   - ✅ Added proper fallback values for all fields
   - ✅ Enhanced logging for debugging

2. eth_getTransactionReceipt:
   - ✅ CRITICAL FIX: logs array is ALWAYS an array (prevents index errors)
   - ✅ Added validation for transaction hash
   - ✅ Improved address padding for Transfer events
   - ✅ Enhanced error handling for missing transactions
   - ✅ Added comprehensive Transfer event logs

3. eth_getBalance:
   - ✅ Added parameter validation
   - ✅ Prevents negative or NaN values
   - ✅ Returns 0x0 for invalid addresses instead of errors
   - ✅ Enhanced logging for debugging
   - ✅ Safe error handling

4. web3-rpc-handler.js:
   - ✅ Fixed eth_getBlockByNumber implementation
   - ✅ Added blockchain chain validation
   - ✅ Ensured transactions array is always present
   - ✅ Added fallback values for all fields

Files Modified:
- network-node.js (getBlockByNumber, getBlockByHash, eth_getBalance, eth_getTransactionReceipt)
- web3-rpc-handler.js (eth_getBlockByNumber)
- RPC_FIX_SUMMARY.md (created documentation)

Impact:
✅ Trust Wallet compatibility improved
✅ No more "index out of bounds" errors
✅ All RPC responses follow Ethereum standards
✅ Better error handling and logging

---

Recent Updates (October 22, 2025)
Critical Fixes & Improvements

Database Synchronization:
✅ Fixed hash and tx_hash field synchronization in transactions table
Both fields now always contain identical values to prevent lookup failures
Updated saveConfirmedTransaction() and saveTransactionToDatabase()
Fixed 2 existing records with missing hash values
Storage System:
✅ Created missing storage directories to prevent file system errors
ethereum-network-data/state/
ethereum-network-data/blocks/
ethereum-network-data/transactions/
ethereum-network-data/accounts/
Balance Synchronization:
✅ Created /api/admin/sync-balances endpoint
Syncs all balances from blockchain state (source of truth) to database
Successfully synchronized 15 wallet addresses
Eliminated negative balance issues (-0.10197 ACCESS → 0.09999 ACCESS)
Global Access Node:
✅ Set global.accessNode in network-api.js
Allows server.js to access blockchain instance for administrative tasks
Enables balance synchronization and network monitoring

Technical Details

Transaction Hash Consistency:
Problem: Some transactions had tx_hash populated but hash was empty
Impact: Transaction lookups failed when searching by hash field
Solution: All transaction inserts now populate both hash and tx_hash with same value
SQL Update: UPDATE transactions SET hash = tx_hash WHERE hash IS NULL
Balance Discrepancy Resolution:
Problem: Database showed negative balances due to missing transactions
Impact: Blockchain state (91.48 ACCESS) != Database state (0.40 ACCESS)  
Solution: Created sync endpoint that reads from blockchain.getAllBalances()
Result: All 15 addresses synchronized successfully, no negative balances remain