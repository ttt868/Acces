# AccessRewards - Daily Fitness & Social Rewards Platform

## Overview

AccessRewards is a Web3 cryptocurrency rewards platform built on the Access Network blockchain. The application enables users to earn ACCESS tokens through daily activities, processing sessions, and referral programs. It features a custom EVM-compatible blockchain implementation, wallet management, smart contract support (ERC20/ERC721), and a block explorer.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture
- **Runtime**: Node.js (>=18.0.0) with ES Modules
- **Web Framework**: Express.js v5 for HTTP/API endpoints
- **Real-time Communication**: WebSocket (ws) for live updates and blockchain sync
- **Entry Point**: `start.js` bootstraps the server from `RealisticHonorableDeskscan/server.js`

### Blockchain Implementation
- **Custom EVM-Compatible Network**: Chain ID 22888, Network ID 22888
- **Native Currency**: ACCESS token (18 decimals)
- **State Storage**: Merkle Patricia Trie with LevelDB for persistent storage (Ethereum-style)
- **RLP Encoding**: Uses @ethereumjs/rlp for transaction and account serialization
- **Smart Contracts**: Custom contract engine supporting ERC20 and ERC721 token standards
- **Block Explorer**: Full-featured explorer at `access-explorer.html` with address/transaction/block views

### Data Storage
- **Primary Database**: PostgreSQL via `pg` library with connection pooling
- **State Trie**: LevelDB for blockchain state (accounts, balances, contract storage)
- **Blockchain Data**: JSON files for chain persistence (`blockchain-data.json`)
- **Object Storage**: Replit Object Storage for file assets

### Key Database Tables
- `users`: User accounts with wallet addresses, balances, processing status
- `transactions`: Transaction history and blockchain records
- `blockchain_transactions`: On-chain transaction data
- `processing_history`: Activity/mining session records
- `external_wallets`: External wallet connections

### Authentication & Wallet
- **Web3 Integration**: Reown AppKit (formerly WalletConnect) with wagmi adapter
- **Wallet Generation**: Ethereum-compatible wallets using ethers.js and viem
- **Google OAuth**: Integration for explorer authentication

### Processing System (Mining/Rewards)
- Users start 24-hour processing sessions to earn ACCESS tokens
- Countdown-based system tracking remaining seconds
- Ad boost multipliers for enhanced rewards
- Referral bonuses affect processing rates

### Mobile Support
- **Capacitor**: iOS and Android native app wrappers
- **TWA (Trusted Web Activity)**: Android app integration with Digital Asset Links

### Performance Optimizations
- Multi-tier caching system (L1/L2/L3) for balance lookups
- Database connection pooling with configurable limits
- Batch transaction processing
- Rate limiting for API endpoints

### External Integrations
- **Google AdMob/GPT**: Rewarded ads for boost multipliers
- **Web Push**: Push notifications via web-push library
- **IPFS**: Logo and asset storage

## External Dependencies

### Blockchain & Crypto
- `ethers` (v6): Ethereum wallet and transaction utilities
- `viem`: Modern Ethereum library for type-safe interactions
- `wagmi`: React hooks for Ethereum (used with AppKit)
- `@reown/appkit`: WalletConnect integration
- `@ethereumjs/trie`, `@ethereumjs/rlp`, `@ethereumjs/util`: State trie and encoding
- `elliptic`: Elliptic curve cryptography for signatures

### Database
- `pg`: PostgreSQL client (Neon PostgreSQL in production)
- `level`: LevelDB for blockchain state storage

### Mobile
- `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`: Native app wrappers

### Services
- `web-push`: Push notification delivery
- `@replit/object-storage`: File storage on Replit

### Utilities
- `dotenv`: Environment variable management
- `node-fetch`: HTTP requests
- `ws`: WebSocket server/client