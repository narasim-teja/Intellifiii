# IntelliFi: Decentralized Biometric Identity Verification

IntelliFi is a privacy-preserving decentralized identity verification system that uses facial biometrics to create unique, Sybil-resistant identities on the blockchain.

## 🌟 Features

- **Privacy-First Biometrics**: All facial processing happens locally in your browser - your biometric data never leaves your device
- **Blockchain Verification**: Only secure hashes are stored on-chain, linked to your wallet address
- **Sybil Resistance**: Prevents the same person from creating multiple identities, ensuring ecosystem integrity
- **IPFS Integration**: Encrypted face embeddings stored on IPFS for decentralized verification
- **Cross-Platform Identity**: Use your verified identity across multiple dApps

## 🔧 Technology Stack

- **Frontend**: React, TypeScript, TailwindCSS
- **Blockchain**: Ethereum (Base Sepolia testnet)
- **Authentication**: Dynamic.xyz wallet connection
- **Face Processing**: TensorFlow.js face-api
- **Storage**: IPFS via Pinata
- **Backend**: Bun server for face comparison

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- npm or yarn
- MetaMask or other Web3 wallet

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/narasim-teja/Intellifiii.git
   cd Intellifiii
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with the following variables:
   ```
   VITE_CONTRACT_ADDRESS=your_contract_address
   VITE_PINATA_JWT=your_pinata_jwt
   ```

4. Start the development server:
   ```
   npm run dev
   ```

## 🔒 How It Works

1. **Face Capture**: Your browser captures your face using your webcam
2. **Local Processing**: Face embeddings are generated locally using TensorFlow.js
3. **Uniqueness Check**: The system verifies your face hasn't been registered before
4. **IPFS Storage**: Encrypted face data is stored on IPFS
5. **Blockchain Registration**: A hash linking your face to your wallet is stored on-chain
6. **Cross-Platform Use**: Your verified identity can be used across integrated applications

## 🌐 Integrated Applications

IntelliFi currently integrates with:

- **Person Bounty**: A decentralized bounty platform that prevents Sybil attacks
- **Meta Agent Class**: A learning platform that verifies unique participation in AI courses

## 🛡️ Privacy & Security

- No raw biometric data is ever stored or transmitted
- All face processing happens locally in your browser
- Only cryptographic hashes and encrypted embeddings are stored
- Self-sovereign identity - you control your data
