import { useState, useEffect } from "react";
import { ShieldCheckIcon, LockClosedIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { FaceProcessor } from "../components/FaceProcessor";
import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { useContractInteraction } from "../hooks/useContractInteraction";

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
  
  const { primaryWallet, user } = useDynamicContext();
  const { 
    registerFaceHash, 
    verifyFaceHash,
    checkFaceUniqueness,
    resetLocalData,
    isRegistering, 
    error: contractError,
    registrationStatus,
    uniquenessStatus
  } = useContractInteraction();

  // Check registration status when wallet connects
  useEffect(() => {
    const checkWalletRegistration = async () => {
      if (primaryWallet && faceHash) {
        try {
          const isVerified = await verifyFaceHash(faceHash);
          setIsRegistered(isVerified);
        } catch (error) {
          console.error("Error checking registration status:", error);
        }
      }
    };
    
    checkWalletRegistration();
  }, [primaryWallet, faceHash, verifyFaceHash]);

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
            <FaceProcessor 
              onHashGenerated={handleFaceHashGenerated} 
              onIpfsHashGenerated={handleIpfsHashGenerated}
              hasWallet={!!primaryWallet}
            />
            
            {/* Uniqueness Check Button */}
            {faceHash && ipfsHash && !isRegistered && !uniquenessResult && (
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
        </div>
      </div>
    </div>
  );
} 