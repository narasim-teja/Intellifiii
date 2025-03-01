import { useState, useEffect } from "react";
import { ShieldCheckIcon, LockClosedIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { FaceProcessor } from "../components/FaceProcessor";
import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { useContractInteraction } from "../hooks/useContractInteraction";
import { ethers } from "ethers";

export default function Home() {
  const [faceHash, setFaceHash] = useState<string | null>(null);
  const [faceEmbedding, setFaceEmbedding] = useState<Float32Array | null>(null);
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  const [registrationTimestamp, setRegistrationTimestamp] = useState<number | null>(null);
  const [isCheckingUniqueness, setIsCheckingUniqueness] = useState(false);
  const [uniquenessResult, setUniquenessResult] = useState<{
    isUnique: boolean;
    similarity: number | null;
  } | null>(null);
  const [ipfsHash, setIpfsHash] = useState<string | null>(null);
  const [isCheckingRegistration, setIsCheckingRegistration] = useState(false);
  
  const { primaryWallet, user } = useDynamicContext();
  const { 
    registerFaceHash, 
    verifyFaceHash,
    checkFaceUniqueness,
    resetLocalData,
    isRegistering, 
    error: contractError,
    registrationStatus,
    uniquenessStatus,
    getContract
  } = useContractInteraction();

  // Check registration status when wallet connects
  useEffect(() => {
    const checkWalletRegistration = async () => {
      if (primaryWallet) {
        try {
          setIsCheckingRegistration(true);
          
          // Get contract instance
          const contract = await getContract();
          
          // Check if the wallet is registered directly from the contract
          const registration = await contract.getRegistration(primaryWallet.address);
          
          // Check if the wallet is registered (non-zero address)
          const isWalletRegistered = registration.wallet !== ethers.ZeroAddress;
          
          if (isWalletRegistered) {
            setIsRegistered(true);
            // Convert BigInt timestamp to number
            const timestamp = Number(registration.timestamp);
            setRegistrationTimestamp(timestamp);
            
            // Set the face hash from the registration
            if (registration.faceHash) {
              setFaceHash(registration.faceHash);
            }
            
            // Set the IPFS hash from the registration
            if (registration.ipfsHash) {
              setIpfsHash(registration.ipfsHash);
            }
          } else if (faceHash) {
            // If we have a face hash, verify it
            const isVerified = await verifyFaceHash(faceHash);
            setIsRegistered(isVerified);
          }
        } catch (error) {
          console.error("Error checking registration status:", error);
        } finally {
          setIsCheckingRegistration(false);
        }
      }
    };
    
    checkWalletRegistration();
  }, [primaryWallet, faceHash, verifyFaceHash, getContract]);

  // Update state when registration status changes
  useEffect(() => {
    if (registrationStatus === 'success') {
      setIsRegistered(true);
      setRegistrationTimestamp(Math.floor(Date.now() / 1000));
    }
  }, [registrationStatus]);

  // Update state when uniqueness check is completed
  useEffect(() => {
    if (uniquenessStatus && uniquenessStatus !== 'checking') {
      setIsCheckingUniqueness(false);
      setUniquenessResult({
        isUnique: uniquenessStatus === 'unique',
        similarity: null
      });
    }
  }, [uniquenessStatus]);

  // Handle face hash generation
  const handleFaceHashGenerated = (hash: string, embedding?: Float32Array) => {
    setFaceHash(hash);
    if (embedding) {
      setFaceEmbedding(embedding);
    }
    setUniquenessResult(null);
  };

  // Handle IPFS hash generation
  const handleIpfsHashGenerated = (hash: string) => {
    setIpfsHash(hash);
  };

  // Combined function to check uniqueness and register if unique
  const handleRegisterOnChain = async () => {
    if (!faceEmbedding || !faceHash || !ipfsHash) {
      console.error("Missing face data or IPFS hash for registration");
      return;
    }

    console.log("Starting registration process...");
    console.log("Face hash:", faceHash.substring(0, 10) + "...");
    console.log("IPFS hash:", ipfsHash);
    
    // First, check uniqueness
    setIsCheckingUniqueness(true);
    try {
      console.log("Checking face uniqueness...");
      const isUnique = await checkFaceUniqueness(faceEmbedding, ipfsHash);
      console.log("Uniqueness check result:", isUnique);
      
      if (isUnique) {
        // If unique, proceed with registration
        console.log("Face is unique, proceeding with registration...");
        await registerFaceHash(faceHash, ipfsHash);
        console.log("Registration completed");
      } else {
        console.log("Face is not unique, cannot register");
        // Set uniqueness result to show the user
        setUniquenessResult({
          isUnique: false,
          similarity: null
        });
      }
    } catch (error: unknown) {
      console.error("Error during registration process:", error);
      
      // Show error in UI
      setUniquenessResult({
        isUnique: false,
        similarity: null
      });
    } finally {
      setIsCheckingUniqueness(false);
    }
  };

  // Function to reset identity (for testing purposes)
  const resetIdentity = () => {
    resetLocalData();
    setIsRegistered(false);
    setRegistrationTimestamp(null);
    setFaceHash(null);
    setFaceEmbedding(null);
    setUniquenessResult(null);
    setIpfsHash(null);
  };

  // Format timestamp to readable date
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  // Render different UI based on registration status
  if (isRegistered) {
    return (
      <div className="w-full">
        {/* Hero section for registered users */}
        <div className="w-full bg-gradient-to-b from-green-800 via-green-900 to-gray-900 py-20 sm:py-28 relative overflow-hidden">
          {/* Hero background decorative elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-gradient-to-br from-green-500/20 to-emerald-500/20 blur-3xl rounded-full transform -translate-y-1/2"></div>
            <div className="absolute bottom-0 right-0 w-1/3 h-1/3 bg-gradient-to-tl from-teal-500/10 to-green-500/10 blur-3xl rounded-full"></div>
          </div>
          
          <div className="mx-auto max-w-3xl text-center px-4 relative z-10">
            <div className="relative">
              {/* Glow effect behind the text */}
              <div className="absolute inset-0 blur-2xl opacity-30 bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 rounded-full transform scale-110"></div>
              
              <h1 className="text-6xl sm:text-7xl md:text-8xl font-extrabold tracking-tight relative">
                <span className="inline-block animate-fade-in bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400 bg-clip-text text-transparent drop-shadow-sm">
                  IntelliFi
                </span>
              </h1>
            </div>
            
            <div className="mt-8 relative">
              {/* Subtle line separator */}
              <div className="w-24 h-1 bg-gradient-to-r from-green-500/50 to-emerald-500/50 rounded-full mx-auto mb-6"></div>
              
              <p className="text-2xl sm:text-3xl font-medium">
                <span className="inline-block animate-slide-up bg-gradient-to-r from-green-300 to-emerald-400 bg-clip-text text-transparent italic tracking-wide">
                  Verified Identity
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Main content for registered users */}
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 relative">
          <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-md border border-gray-700/70 p-8 mb-8">
            <div className="flex items-center justify-center mb-6">
              <CheckCircleIcon className="h-12 w-12 text-green-400 mr-4" />
              <h2 className="text-3xl font-bold text-white">Identity Verified</h2>
            </div>
            
            <div className="text-center mb-6">
              <p className="text-xl text-gray-300">
                Your identity has been successfully verified and registered on the blockchain.
              </p>
              {registrationTimestamp && (
                <p className="text-gray-400 mt-2">
                  Registered on: {formatTimestamp(registrationTimestamp)}
                </p>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
              <div className="bg-gray-700/50 p-6 rounded-lg">
                <h3 className="text-xl font-medium text-white mb-4">Wallet Information</h3>
                <p className="text-gray-300">
                  <span className="font-medium">Address:</span> {primaryWallet?.address.substring(0, 6)}...{primaryWallet?.address.substring(primaryWallet.address.length - 4)}
                </p>
                <p className="text-gray-300 mt-2">
                  <span className="font-medium">Wallet Provider:</span> {primaryWallet?.connector?.name || "Unknown"}
                </p>
              </div>
              
              <div className="bg-gray-700/50 p-6 rounded-lg">
                <h3 className="text-xl font-medium text-white mb-4">Identity Information</h3>
                {ipfsHash && (
                  <p className="text-gray-300">
                    <span className="font-medium">IPFS Hash:</span> {ipfsHash.substring(0, 6)}...{ipfsHash.substring(ipfsHash.length - 4)}
                  </p>
                )}
                {faceHash && (
                  <p className="text-gray-300 mt-2">
                    <span className="font-medium">Face Hash:</span> {faceHash.substring(0, 6)}...{faceHash.substring(faceHash.length - 4)}
                  </p>
                )}
              </div>
            </div>
            
            {/* Projects Section */}
            <div className="mt-10 border-t border-gray-700 pt-8">
              <h3 className="text-2xl font-bold text-white text-center mb-6">Projects Using Your Verified Identity</h3>
              <p className="text-gray-300 text-center mb-8">
                Your verified identity can now be used across these decentralized applications.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Person Bounty Project */}
                <div className="bg-gray-700/50 rounded-xl overflow-hidden shadow-lg transform transition-all duration-300 hover:scale-105 hover:shadow-xl">
                  <div className="h-48 bg-gradient-to-r from-purple-600 to-indigo-600 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div className="p-6">
                    <h4 className="text-xl font-bold text-white mb-2">Person Bounty</h4>
                    <p className="text-gray-300 mb-4">
                      A decentralized bounty platform that ensures one-person-one-bounty using your verified identity, preventing Sybil attacks and ensuring fair distribution of rewards.
                    </p>
                    <div className="flex justify-between items-center">
                      <span className="bg-green-900/50 text-green-400 text-xs font-medium px-3 py-1 rounded-full">
                        Identity Verified
                      </span>
                      <a 
                        href="#" 
                        className="text-indigo-400 hover:text-indigo-300 font-medium text-sm flex items-center"
                        onClick={(e) => {
                          e.preventDefault();
                          window.open('https://personbounty.xyz', '_blank');
                        }}
                      >
                        Visit Platform
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                    <button 
                      className="w-full mt-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center"
                      onClick={() => {
                        // This would typically connect to the platform's API
                        alert('Connecting your verified identity to Person Bounty...');
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Connect Identity
                    </button>
                  </div>
                </div>
                
                {/* Meta Agent Class Project */}
                <div className="bg-gray-700/50 rounded-xl overflow-hidden shadow-lg transform transition-all duration-300 hover:scale-105 hover:shadow-xl">
                  <div className="h-48 bg-gradient-to-r from-emerald-600 to-teal-600 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="p-6">
                    <h4 className="text-xl font-bold text-white mb-2">Meta Agent Glass</h4>
                    <p className="text-gray-300 mb-4">
                      A decentralized learning platform that verifies unique human participation in AI agent development courses, ensuring authentic credentials and preventing certificate fraud.
                    </p>
                    <div className="flex justify-between items-center">
                      <span className="bg-green-900/50 text-green-400 text-xs font-medium px-3 py-1 rounded-full">
                        Identity Verified
                      </span>
                      <a 
                        href="#" 
                        className="text-indigo-400 hover:text-indigo-300 font-medium text-sm flex items-center"
                        onClick={(e) => {
                          e.preventDefault();
                          window.open('https://metaagentclass.io', '_blank');
                        }}
                      >
                        Visit Platform
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                    <button 
                      className="w-full mt-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center"
                      onClick={() => {
                        // This would typically connect to the platform's API
                        alert('Connecting your verified identity to Meta Agent Class...');
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Connect Identity
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-lg shadow-md border border-gray-700/70 transition-all duration-300 hover:border-green-700/50">
              <div className="flex items-center">
                <ShieldCheckIcon className="h-6 w-6 text-green-400" />
                <h3 className="ml-2 text-lg font-medium text-white">Verified Identity</h3>
              </div>
              <p className="mt-2 text-gray-300">
                Your identity has been verified and securely registered on the blockchain. You can now use your face for authentication across supported applications.
              </p>
            </div>

            <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-lg shadow-md border border-gray-700/70 transition-all duration-300 hover:border-green-700/50">
              <div className="flex items-center">
                <LockClosedIcon className="h-6 w-6 text-green-400" />
                <h3 className="ml-2 text-lg font-medium text-white">Secure Access</h3>
              </div>
              <p className="mt-2 text-gray-300">
                Your biometric data is securely linked to your wallet address, providing a high level of security for your digital assets and identity.
              </p>
            </div>
            
            <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-lg shadow-md border border-gray-700/70 transition-all duration-300 hover:border-green-700/50">
              <div className="flex items-center">
                <CheckCircleIcon className="h-6 w-6 text-green-400" />
                <h3 className="ml-2 text-lg font-medium text-white">Sybil Resistant</h3>
              </div>
              <p className="mt-2 text-gray-300">
                Your unique biometric identity helps prevent Sybil attacks by ensuring one person can only register one wallet, maintaining ecosystem integrity.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Hero section */}
      <div className="w-full bg-gradient-to-b from-gray-800 via-gray-900 to-gray-900 py-20 sm:py-28 relative overflow-hidden">
        {/* Hero background decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 blur-3xl rounded-full transform -translate-y-1/2"></div>
          <div className="absolute bottom-0 right-0 w-1/3 h-1/3 bg-gradient-to-tl from-blue-500/10 to-indigo-500/10 blur-3xl rounded-full"></div>
        </div>
        
        <div className="mx-auto max-w-3xl text-center px-4 relative z-10">
          <div className="relative">
            {/* Glow effect behind the text */}
            <div className="absolute inset-0 blur-2xl opacity-30 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transform scale-110"></div>
            

            
            <h1 className="text-6xl sm:text-7xl md:text-8xl font-extrabold tracking-tight relative">
              <span className="inline-block animate-fade-in bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-sm">
                IntelliFi
              </span>
            </h1>
          </div>
          
          <div className="mt-8 relative">
            {/* Subtle line separator */}
            <div className="w-24 h-1 bg-gradient-to-r from-indigo-500/50 to-purple-500/50 rounded-full mx-auto mb-6"></div>
            
            <p className="text-2xl sm:text-3xl font-medium">
              <span className="inline-block animate-slide-up bg-gradient-to-r from-indigo-300 to-indigo-400 bg-clip-text text-transparent italic tracking-wide">
                Face the Future
              </span>
            </p>
          </div>
          
          {!user && (
            <div className="mt-10">
              <DynamicWidget />
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 relative">
        {/* Content background decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
          <div className="absolute top-1/4 right-0 w-64 h-64 bg-gradient-to-bl from-indigo-600/30 to-transparent blur-3xl rounded-full"></div>
          <div className="absolute bottom-1/3 left-0 w-72 h-72 bg-gradient-to-tr from-purple-600/30 to-transparent blur-3xl rounded-full"></div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start relative z-10">
          {/* Face Processor Section */}
          <div className="space-y-4">
            {isCheckingRegistration ? (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-md border border-gray-700/70 p-6 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mr-3"></div>
                <p className="text-gray-300">Checking registration status...</p>
              </div>
            ) : (
              <FaceProcessor 
                onHashGenerated={handleFaceHashGenerated} 
                onIpfsHashGenerated={handleIpfsHashGenerated}
                hasWallet={!!primaryWallet}
              />
            )}
            
            {/* Uniqueness Check Button */}
            {faceHash && ipfsHash && !isRegistered && !uniquenessResult && !isCheckingRegistration && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-md border border-gray-700/70 p-6">
                <p className="text-gray-300 mb-4">
                  Ready to register your face on the blockchain? Click below to check uniqueness and register.
                </p>
                <button 
                  className={`w-full rounded-lg px-4 py-3 text-base font-medium transition-colors ${
                    !user
                      ? "bg-gray-600 cursor-not-allowed"
                      : isCheckingUniqueness || isRegistering
                        ? "bg-indigo-500 cursor-wait"
                        : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white"
                  }`}
                  onClick={handleRegisterOnChain}
                  disabled={!user || isCheckingUniqueness || isRegistering || !ipfsHash || !faceEmbedding}
                >
                  {!user 
                    ? "Connect Wallet to Register"
                    : isCheckingUniqueness
                      ? "Checking Face Uniqueness..."
                      : isRegistering
                        ? "Registering on Blockchain..."
                        : "Register Identity on Blockchain"
                  }
                </button>
              </div>
            )}
            
            {/* Uniqueness Check Results */}
            {uniquenessResult && !isRegistered && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-md border border-gray-700/70 p-6">
                {uniquenessResult.isUnique ? (
                  <div className="p-4 bg-green-900/50 rounded-lg backdrop-blur-sm">
                    <div className="flex items-center">
                      <CheckCircleIcon className="h-6 w-6 text-green-400" />
                      <p className="ml-2 text-green-400 font-medium">Face is Unique!</p>
                    </div>
                    <p className="mt-2 text-sm text-gray-300">
                      This face hasn't been registered by any other wallet. You can proceed with registration.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-900/50 rounded-lg backdrop-blur-sm">
                    <div className="flex items-center">
                      <ExclamationTriangleIcon className="h-6 w-6 text-amber-400" />
                      <p className="ml-2 text-amber-400 font-medium">Face Already Registered</p>
                    </div>
                    <p className="mt-2 text-sm text-gray-300">
                      This face appears to be already registered by another wallet.
                      {uniquenessResult.similarity !== null && (
                        <span> Similarity score: {(uniquenessResult.similarity * 100).toFixed(1)}%</span>
                      )}
                    </p>
                    
                    <p className="mt-3 text-sm text-amber-400">
                      To prevent identity fraud, you cannot register this face. Please try with a different face.
                    </p>
                  </div>
                )}
                
                {/* Register Button (only shown if face is unique) */}
                {uniquenessResult.isUnique && (
                  <button 
                    className={`w-full mt-4 rounded-lg px-4 py-3 text-base font-medium transition-colors ${
                      !user || !ipfsHash
                        ? "bg-gray-600 cursor-not-allowed"
                        : isRegistering
                          ? "bg-indigo-500 cursor-wait"
                          : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white"
                    }`}
                    onClick={handleRegisterOnChain}
                    disabled={!user || isRegistering || !ipfsHash}
                  >
                    {!user 
                      ? "Connect Wallet to Register"
                      : !ipfsHash
                        ? "Upload to IPFS First"
                        : isRegistering
                          ? "Registering on Blockchain..."
                          : "Register Identity on Blockchain"
                    }
                  </button>
                )}
                
                {contractError && (
                  <div className="mt-4 p-3 bg-red-900/50 rounded-lg text-red-400 text-sm backdrop-blur-sm">
                    {contractError}
                  </div>
                )}
              </div>
            )}

            {/* Registration Success */}
            {isRegistered && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-md border border-gray-700/70 p-6 mt-4">
                <div className="p-4 bg-green-900/50 rounded-lg backdrop-blur-sm">
                  <div className="flex items-center">
                    <CheckCircleIcon className="h-6 w-6 text-green-400" />
                    <p className="ml-2 text-green-400 font-medium">Registration Successful!</p>
                  </div>
                  <p className="mt-2 text-sm text-gray-300">
                    Your face has been successfully registered on the blockchain.
                    {registrationTimestamp && (
                      <span> Registered on: {formatTimestamp(registrationTimestamp)}</span>
                    )}
                  </p>
                </div>
                
                <button 
                  className="w-full mt-4 rounded-lg px-4 py-3 text-base font-medium bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white"
                  onClick={resetIdentity}
                >
                  Start Over
                </button>
              </div>
            )}
          </div>

          {/* Security Information */}
          <div className="space-y-6">
            <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-lg shadow-md border border-gray-700/70 transition-all duration-300 hover:border-indigo-700/50">
              <div className="flex items-center">
                <ShieldCheckIcon className="h-6 w-6 text-indigo-400" />
                <h3 className="ml-2 text-lg font-medium text-white">Privacy First</h3>
              </div>
              <p className="mt-2 text-gray-300">
                Your facial data is processed entirely on your device. No biometric information leaves your browser, ensuring maximum privacy and security.
              </p>
            </div>

            <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-lg shadow-md border border-gray-700/70 transition-all duration-300 hover:border-indigo-700/50">
              <div className="flex items-center">
                <LockClosedIcon className="h-6 w-6 text-indigo-400" />
                <h3 className="ml-2 text-lg font-medium text-white">Blockchain Secured</h3>
              </div>
              <p className="mt-2 text-gray-300">
                Your identity verification is registered directly on the Base Sepolia blockchain, creating an immutable record of your verification that can be used for secure authentication.
              </p>
            </div>
            
            <div className="bg-gray-800/80 backdrop-blur-sm p-6 rounded-lg shadow-md border border-gray-700/70 transition-all duration-300 hover:border-amber-700/50">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="h-6 w-6 text-amber-400" />
                <h3 className="ml-2 text-lg font-medium text-white">Sybil Resistance</h3>
              </div>
              <p className="mt-2 text-gray-300">
                Our system prevents the same face from being registered with multiple wallets. Before registration, we check if your face is already associated with another wallet to prevent identity fraud.
              </p>
            </div>
          </div>

          {/* How It Works Section */}
          <div className="mt-12 border-t border-gray-700 pt-8">
            <h3 className="text-2xl font-bold text-white text-center mb-6">How Decentralized Identity Works</h3>
            
            <div className="bg-gray-800/60 rounded-xl p-6 backdrop-blur-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-white mb-2">Biometric Verification</h4>
                  <p className="text-gray-300">
                    Your facial biometrics are processed locally and never leave your device. Only a secure hash is stored on-chain.
                  </p>
                </div>
                
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-white mb-2">Blockchain Security</h4>
                  <p className="text-gray-300">
                    Your identity is securely linked to your wallet address on the blockchain, creating an immutable and verifiable record.
                  </p>
                </div>
                
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-white mb-2">Sybil Resistance</h4>
                  <p className="text-gray-300">
                    The protocol ensures one-person-one-identity, preventing multiple accounts and maintaining ecosystem integrity.
                  </p>
                </div>
              </div>
              
              <div className="mt-8 border-t border-gray-700 pt-6">
                <h4 className="text-lg font-semibold text-white mb-3">Benefits of Decentralized Identity</h4>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <li className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Privacy-preserving verification without sharing personal data</span>
                  </li>
                  <li className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Self-sovereign identity you control, not corporations</span>
                  </li>
                  <li className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Prevents fake accounts and Sybil attacks in Web3 applications</span>
                  </li>
                  <li className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Seamless authentication across multiple platforms</span>
                  </li>
                  <li className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Enables fair distribution of rewards and resources</span>
                  </li>
                  <li className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">No central authority or single point of failure</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 