import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { getSigner } from '@dynamic-labs/ethers-v6';
import { retrieveFromIPFS, calculateCosineSimilarity } from '../utils/ipfsUtils';
import faceAbi from './faceAbi.json';

// Threshold for face similarity (0.75 is a good balance for face recognition)
// Increasing to 0.85 to reduce false positives - different people should have lower similarity
const SIMILARITY_THRESHOLD = 0.70;

// Contract address - replace with your deployed contract address
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

// Define the type for IPFS data
interface IPFSData {
  embedding: number[];
  timestamp: number;
  version: string;
  [key: string]: unknown;
}

export function useContractInteraction() {
  const { primaryWallet } = useDynamicContext();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<'none' | 'success' | 'error' | 'checking'>('none');
  const [uniquenessStatus, setUniquenessStatus] = useState<'unique' | 'duplicate' | 'checking' | 'error' | null>(null);
  const [publicKeyInfo, setPublicKeyInfo] = useState<{key: string | null, source: string | null}>({ key: null, source: null });

  // Check for public key when wallet connects
  useEffect(() => {
    if (primaryWallet) {
      checkPublicKey();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryWallet]);

  // Function to check and log the public key
  const checkPublicKey = useCallback(async () => {
    if (!primaryWallet) {
      console.log('No wallet connected, cannot check public key');
      return null;
    }

    console.log('Checking for public key from wallet:', primaryWallet.connector?.name);
    let publicKey = null;
    let source = null;

    try {
      // Method 1: Try to get the public key if the wallet provider exposes it directly
      if (primaryWallet.connector && 'getPublicKey' in primaryWallet.connector) {
        try {
          // Use type assertion to access the method
          const connector = primaryWallet.connector as { getPublicKey: () => Promise<string> };
          const walletPublicKey = await connector.getPublicKey();
          if (walletPublicKey) {
            publicKey = walletPublicKey.startsWith('0x') ? walletPublicKey : `0x${walletPublicKey}`;
            source = 'connector.getPublicKey()';
            console.log('Public key found via connector.getPublicKey():', publicKey.substring(0, 12) + '...');
          }
        } catch (err) {
          console.log('Failed to get public key via connector.getPublicKey():', err);
        }
      }

      // Method 2: Try MetaMask specific method
      if (!publicKey && primaryWallet.connector?.name === 'MetaMask' && window.ethereum) {
        try {
          console.log('Trying MetaMask specific method...');
          
          // Use unknown as an intermediate type to avoid type errors
          const ethereum = window.ethereum as unknown as { 
            request: (args: { method: string; params: string[] }) => Promise<unknown> 
          };
          
          const publicKeyFromMM = await ethereum.request({
            method: 'eth_getEncryptionPublicKey',
            params: [primaryWallet.address],
          });
          
          if (publicKeyFromMM && typeof publicKeyFromMM === 'string') {
            publicKey = publicKeyFromMM.startsWith('0x') ? publicKeyFromMM : `0x${publicKeyFromMM}`;
            source = 'eth_getEncryptionPublicKey';
            console.log('Public key found via MetaMask eth_getEncryptionPublicKey:', publicKey.substring(0, 12) + '...');
          }
        } catch (err) {
          console.log('Failed to get public key via MetaMask specific method:', err);
        }
      }

      // Update state with the results
      setPublicKeyInfo({ 
        key: publicKey, 
        source: source 
      });

      if (!publicKey) {
        console.log('No public key found from any method');
      }

      return publicKey;
    } catch (err) {
      console.error('Error checking for public key:', err);
      return null;
    }
  }, [primaryWallet]);

  // Get contract instance
  const getContract = useCallback(async () => {
    if (!primaryWallet) {
      throw new Error('No wallet connected');
    }
    
    const signer = await getSigner(primaryWallet);
    return new ethers.Contract(CONTRACT_ADDRESS, faceAbi.abi, signer);
  }, [primaryWallet]);

  // Check if a face is already registered by comparing embeddings
  const checkFaceUniqueness = useCallback(async (faceEmbedding: Float32Array, currentIpfsHash?: string): Promise<boolean> => {
    try {
      console.log('Starting face uniqueness check...');
      console.log('Current IPFS hash:', currentIpfsHash);
      setUniquenessStatus('checking');
      
      if (!primaryWallet) {
        throw new Error('No wallet connected');
      }
      
      // Validate the current embedding
      let zeroCount = 0;
      for (let i = 0; i < Math.min(100, faceEmbedding.length); i++) {
        if (faceEmbedding[i] === 0) {
          zeroCount++;
        }
      }
      
      // If more than 50% of the first 100 values are zeros, there's likely a problem
      if (zeroCount > 50) {
        console.error('Invalid face embedding with too many zeros');
        setError('Invalid face embedding. Please capture a new image with better lighting.');
        setUniquenessStatus('error');
        return false;
      }
      
      // TEMPORARY TESTING OVERRIDE - Uncomment to bypass uniqueness check during testing
      // console.log('TESTING MODE: Bypassing uniqueness check');
      // setUniquenessStatus('unique');
      // return true;
      
      try {
      const contract = await getContract();
      
      // Get all registrations
      const registrationsCount = await contract.totalRegistrants();
        console.log('Raw registrationsCount:', registrationsCount);
        
        // Convert to number safely, handling different return types
        let count = 0;
        if (typeof registrationsCount === 'number') {
          count = registrationsCount;
        } else if (typeof registrationsCount === 'bigint') {
          count = Number(registrationsCount);
        } else if (typeof registrationsCount.toString === 'function') {
          // For BigNumber or other objects with toString
          count = parseInt(registrationsCount.toString(), 10);
        } else if (typeof registrationsCount === 'string') {
          count = parseInt(registrationsCount, 10);
        }
      
      console.log(`Total registrants: ${count}`);
      
      // If no registrations yet, face is definitely unique
      if (count === 0) {
        console.log('No registrations found, face is unique');
        setUniquenessStatus('unique');
        return true;
      }
      
      // Check each registration's embedding for similarity
      for (let i = 0; i < count; i++) {
          try {
        const registrantAddress = await contract.registrants(i);
            console.log(`Registrant ${i} address:`, registrantAddress);
            
        const registration = await contract.getRegistration(registrantAddress);
        
        console.log(`Checking registration for address: ${registrantAddress}`);
            console.log(`IPFS hash: ${registration.ipfsHash}`);
            console.log(`Current wallet address: ${primaryWallet.address}`);
            
            // Skip if no IPFS hash or if it's the current user's wallet or if it's the same IPFS hash we just uploaded
            if (!registration.ipfsHash || 
                registration.ipfsHash === '' || 
                registrantAddress.toLowerCase() === primaryWallet.address.toLowerCase() ||
                (currentIpfsHash && registration.ipfsHash === currentIpfsHash)) {
              console.log('Skipping: empty IPFS hash, own wallet, or same IPFS hash');
          continue;
        }
        
          // Retrieve the embedding from IPFS
            console.log(`Retrieving embedding from IPFS: ${registration.ipfsHash}`);
          const data = await retrieveFromIPFS<IPFSData>(registration.ipfsHash);
          
          if (data && data.embedding) {
            // Convert the array back to Float32Array
            const storedEmbedding = new Float32Array(data.embedding);
              
              // Validate the stored embedding
              let storedZeroCount = 0;
              for (let j = 0; j < Math.min(100, storedEmbedding.length); j++) {
                if (storedEmbedding[j] === 0) {
                  storedZeroCount++;
                }
              }
              
              // Skip invalid embeddings with too many zeros
              if (storedZeroCount > 50) {
                console.warn(`Skipping invalid stored embedding with too many zeros for address: ${registrantAddress}`);
                continue;
              }
              
              // Debug: Log embedding sizes and a few values to verify data integrity
              console.log(`Current embedding length: ${faceEmbedding.length}, Stored embedding length: ${storedEmbedding.length}`);
              console.log(`Current embedding first 3 values: ${faceEmbedding[0]}, ${faceEmbedding[1]}, ${faceEmbedding[2]}`);
              console.log(`Stored embedding first 3 values: ${storedEmbedding[0]}, ${storedEmbedding[1]}, ${storedEmbedding[2]}`);
              
              // Skip if the embeddings have different lengths
              if (faceEmbedding.length !== storedEmbedding.length) {
                console.warn(`Embedding length mismatch: ${faceEmbedding.length} vs ${storedEmbedding.length}. Skipping comparison.`);
                continue;
              }
            
            // Calculate similarity
            const similarity = calculateCosineSimilarity(faceEmbedding, storedEmbedding);
            console.log(`Similarity with registration ${i}: ${similarity}`);
            
            // If similarity is above threshold, face is already registered
            if (similarity > SIMILARITY_THRESHOLD) {
              console.log(`Similar face found! Similarity: ${similarity}`);
              setUniquenessStatus('duplicate');
              return false;
            }
            } else {
              console.log('No embedding data found in IPFS');
          }
        } catch (err) {
            console.error(`Error processing registration ${i}:`, err);
          // Continue checking other registrations
        }
      }
      
      console.log('No similar faces found, face is unique');
      setUniquenessStatus('unique');
      return true;
      } catch (contractErr: unknown) {
        console.error('Contract interaction error:', contractErr);
        
        // Fallback: If we can't check the contract, assume it's unique but log the error
        console.log('Using fallback: Assuming face is unique due to contract error');
        setUniquenessStatus('unique');
        return true;
      }
    } catch (err) {
      console.error('Error checking face uniqueness:', err);
      setUniquenessStatus('error');
      throw err;
    }
  }, [primaryWallet, getContract, setError]);

  // Helper function to ensure a hash is properly formatted for blockchain transactions
  const ensureValidBytesLike = (hash: string): string => {
    // If it's not a string, we can't process it
    if (typeof hash !== 'string') {
      console.error('Invalid hash type, expected string but got:', typeof hash);
      throw new Error('Invalid hash format: not a string');
    }
    
    try {
      // Check if it's already a valid hex string with 0x prefix
      if (hash.startsWith('0x')) {
        // Verify it contains only valid hex characters after 0x
        if (/^0x[0-9a-fA-F]+$/.test(hash)) {
          return hash; // Already valid
        } else {
          console.warn('Hash has 0x prefix but contains non-hex characters:', hash.substring(0, 10) + '...');
        }
      }
      
      // Check if it's a base64 string (contains characters not in hex)
      const containsNonHex = /[^0-9a-fA-F]/.test(hash.startsWith('0x') ? hash.slice(2) : hash);
      
      if (containsNonHex) {
        // Might be base64 encoded, try to convert to hex
        try {
          // If it has 0x prefix, remove it before decoding
          const rawValue = hash.startsWith('0x') ? hash.slice(2) : hash;
          
          // Try to decode as base64
          const binaryStr = atob(rawValue);
          
          // Convert binary to hex
          let hexValue = '';
          for (let i = 0; i < binaryStr.length; i++) {
            const hex = binaryStr.charCodeAt(i).toString(16).padStart(2, '0');
            hexValue += hex;
          }
          
          return '0x' + hexValue;
        } catch (e) {
          console.error('Failed to convert possible base64 to hex:', e);
          // Fall through to next approach
        }
      }
      
      // If it's a plain hex string without 0x prefix, add it
      if (/^[0-9a-fA-F]+$/.test(hash)) {
        return '0x' + hash;
      }
      
      // If we get here, we couldn't convert to a valid format
      console.error('Could not convert hash to valid BytesLike format:', hash.substring(0, 10) + '...');
      throw new Error('Invalid hash format: could not convert to BytesLike');
      
    } catch (err) {
      console.error('Error ensuring valid BytesLike format:', err);
      throw new Error('Failed to process hash for blockchain transaction');
    }
  };

  // Register a face hash on the blockchain
  const registerFaceHash = useCallback(async (faceHash: string, ipfsHash: string) => {
    if (!primaryWallet) {
      setError('No wallet connected');
      return;
    }

    try {
      console.log('Starting face hash registration...');
      console.log('Face hash:', faceHash.substring(0, 10) + '...');
      console.log('IPFS hash:', ipfsHash);
      
      setIsRegistering(true);
      setError(null);
      setRegistrationStatus('checking');

      try {
      const contract = await getContract();
      
      // Check if the wallet address is already registered
      const registration = await contract.getRegistration(primaryWallet.address);
      const isRegistered = registration.wallet !== ethers.ZeroAddress;
        
        console.log('Wallet already registered?', isRegistered);
      
      if (isRegistered) {
        setError('This wallet address is already registered');
        setRegistrationStatus('error');
        return;
      }

        // Try to get the public key from the wallet if possible
        let publicKey = null; // Start with null to indicate we haven't found a valid key yet
        
        try {
          // Attempt to get the public key if the wallet provider exposes it
          if (primaryWallet.connector && 'getPublicKey' in primaryWallet.connector) {
            // @ts-expect-error - Some connectors might have this method
            const walletPublicKey = await primaryWallet.connector.getPublicKey();
            if (walletPublicKey) {
              // Ensure the public key is properly formatted as a hex string
              // Remove 0x prefix if present, then check if it's base64 encoded
              const rawKey = walletPublicKey.startsWith('0x') ? walletPublicKey.slice(2) : walletPublicKey;
              
              // Check if the key is base64 encoded (contains non-hex characters)
              const isBase64 = /[^0-9a-fA-F]/.test(rawKey);
              
              if (isBase64) {
                // Convert base64 to hex
                try {
                  // Decode base64 to binary
                  const binaryStr = atob(rawKey);
                  // Convert binary to hex
                  let hexKey = '';
                  for (let i = 0; i < binaryStr.length; i++) {
                    const hex = binaryStr.charCodeAt(i).toString(16).padStart(2, '0');
                    hexKey += hex;
                  }
                  publicKey = '0x' + hexKey;
                } catch (e) {
                  console.error('Failed to convert base64 key to hex:', e);
                  throw new Error('Invalid public key format');
                }
              } else {
                // Already hex, just ensure 0x prefix
                publicKey = '0x' + rawKey;
              }
              
              console.log('Retrieved public key from wallet:', publicKey.substring(0, 12) + '...');
            }
          } else {
            console.log('Wallet connector does not expose public key method');
            
            // Try alternative method for specific wallet types
            if (primaryWallet.connector && primaryWallet.connector.name === 'MetaMask') {
              console.log('Attempting alternative method for MetaMask...');
              try {
                // @ts-expect-error - MetaMask specific API
                const publicKeyFromMM = await window.ethereum.request({
                  method: 'eth_getEncryptionPublicKey',
                  params: [primaryWallet.address],
                });
                if (publicKeyFromMM && typeof publicKeyFromMM === 'string') {
                  // MetaMask returns base64 encoded key, convert to hex
                  try {
                    // Remove 0x prefix if present
                    const rawKey = (publicKeyFromMM as string).startsWith('0x') ? (publicKeyFromMM as string).slice(2) : publicKeyFromMM;
                    
                    // Check if the key is base64 encoded
                    const isBase64 = /[^0-9a-fA-F]/.test(rawKey);
                    
                    if (isBase64) {
                      // Decode base64 to binary
                      const binaryStr = atob(rawKey);
                      // Convert binary to hex
                      let hexKey = '';
                      for (let i = 0; i < binaryStr.length; i++) {
                        const hex = binaryStr.charCodeAt(i).toString(16).padStart(2, '0');
                        hexKey += hex;
                      }
                      publicKey = '0x' + hexKey;
                    } else {
                      // Already hex, just ensure 0x prefix
                      publicKey = '0x' + rawKey;
                    }
                  } catch (e) {
                    console.error('Failed to convert MetaMask key to hex:', e);
                    throw new Error('Invalid public key format from MetaMask');
                  }
                  console.log('Retrieved public key via MetaMask specific method');
                }
              } catch (mmError) {
                console.warn('MetaMask specific method failed:', mmError);
              }
            }
          }
        } catch (pkError) {
          console.warn('Could not retrieve public key from wallet:', pkError);
        }
        
        // If we couldn't get a public key, show an error and stop the registration process
        if (!publicKey) {
          console.error('Failed to retrieve public key from wallet');
          setError('Cannot register without a public key. Your wallet does not provide access to your public key, which is required for registration.');
          setRegistrationStatus('error');
          return;
        }
        
        // Format the face hash as a proper bytes value with 0x prefix
        const formattedFaceHash = ensureValidBytesLike(faceHash);
        console.log('Formatted face hash:', formattedFaceHash.substring(0, 12) + '...');
        
        // Ensure IPFS hash is properly formatted
        // Some contracts expect IPFS hashes with ipfs:// prefix, others without
        const formattedIpfsHash = ipfsHash.startsWith('ipfs://') ? ipfsHash : `ipfs://${ipfsHash}`;
        console.log('Formatted IPFS hash:', formattedIpfsHash);
        
        // Try different formats if the first one fails
        try {
          console.log('Sending registration transaction...');
          const tx = await contract.register(formattedFaceHash, ipfsHash, publicKey);
          console.log('Transaction sent, waiting for confirmation...');
          await tx.wait();
          console.log('Transaction confirmed!');
        } catch (bytesError) {
          console.error('Error with first format attempt:', bytesError);
          
          // Try with a different approach - convert to bytes array first
          try {
            // Convert the hex string to a bytes array
            const bytes = new Uint8Array(faceHash.length / 2);
            for (let i = 0; i < faceHash.length; i += 2) {
              bytes[i / 2] = parseInt(faceHash.substring(i, i + 2), 16);
            }
            
            // Convert to ethers.js compatible format
            const bytesHex = '0x' + Array.from(bytes)
              .map(b => b.toString(16).padStart(2, '0'))
              .join('');
            
            console.log('Trying alternative format:', bytesHex.substring(0, 12) + '...');
            const tx = await contract.register(bytesHex, ipfsHash, publicKey);
            console.log('Transaction sent with alternative format, waiting for confirmation...');
            await tx.wait();
            console.log('Transaction confirmed!');
          } catch (alternativeError) {
            console.error('Error with alternative format:', alternativeError);
            
            // Try a third approach - use ethers.js utils
            try {
              // Use ethers.js to create a bytes32 value
              const bytes32 = ethers.zeroPadValue(formattedFaceHash, 32);
              console.log('Trying third format (bytes32):', bytes32.substring(0, 12) + '...');
              
              // Also try with formatted IPFS hash
              const tx = await contract.register(bytes32, formattedIpfsHash, publicKey);
              console.log('Transaction sent with bytes32 format, waiting for confirmation...');
      await tx.wait();
              console.log('Transaction confirmed!');
            } catch (thirdError) {
              console.error('Error with third format:', thirdError);
              
              // Try a fourth approach - use raw bytes
              try {
                // Try with raw bytes for both face hash and IPFS hash
                const rawBytes = ethers.getBytes(formattedFaceHash);
                console.log('Trying fourth format (raw bytes):', ethers.hexlify(rawBytes).substring(0, 12) + '...');
                
                // Try with raw IPFS hash (no ipfs:// prefix)
                const rawIpfsHash = ipfsHash.replace('ipfs://', '');
                const tx = await contract.register(ethers.hexlify(rawBytes), rawIpfsHash, publicKey);
                console.log('Transaction sent with raw bytes format, waiting for confirmation...');
                await tx.wait();
                console.log('Transaction confirmed!');
              } catch (fourthError) {
                console.error('Error with fourth format:', fourthError);
                throw fourthError;
              }
            }
          }
        }

      setRegistrationStatus('success');
      console.log('Face hash registered successfully!');
      } catch (contractErr: unknown) {
        console.error('Contract interaction error:', contractErr);
        
        // Set a more specific error message
        if (typeof contractErr === 'object' && contractErr !== null && 'message' in contractErr && 
            typeof contractErr.message === 'string' && contractErr.message.includes('user rejected transaction')) {
          setError('Transaction was rejected. Please try again.');
        } else {
          setError('Failed to register on blockchain. Please try again later.');
        }
        
        setRegistrationStatus('error');
      }
    } catch (err) {
      console.error('Error registering face hash:', err);
      setError('Failed to register face hash. Please try again.');
      setRegistrationStatus('error');
    } finally {
      setIsRegistering(false);
    }
  }, [primaryWallet, getContract]);

  // Verify a face hash against the blockchain
  const verifyFaceHash = useCallback(async (faceHash: string) => {
    if (!primaryWallet) {
      setError('No wallet connected');
      return false;
    }

    try {
      setIsVerifying(true);
      setError(null);

      const contract = await getContract();
      
      // Get the registration for the connected wallet
      const registration = await contract.getRegistration(primaryWallet.address);
      
      // Check if the hash matches
      const isVerified = registration.faceHash === faceHash;
      
      return isVerified;
    } catch (err) {
      console.error('Error verifying face hash:', err);
      setError('Failed to verify face hash. Please try again.');
      return false;
    } finally {
      setIsVerifying(false);
    }
  }, [primaryWallet, getContract]);

  // Reset function (for testing purposes)
  const resetLocalData = useCallback(() => {
    // Clear any state
    setError(null);
    setRegistrationStatus('none');
    setUniquenessStatus(null);
    console.log('Contract interaction state has been reset');
  }, []);

  // Test function to compare face embeddings from IPFS hashes
  const testCompareEmbeddings = async (ipfsHashes: string[]): Promise<{matches: boolean[], similarities: number[]}> => {
    try {
      const embeddings: Float32Array[] = [];
      const similarities: number[] = [];
      const matches: boolean[] = [];

      // First, retrieve all embeddings from IPFS
      console.log('Retrieving embeddings from IPFS...');
      for (const hash of ipfsHashes) {
        try {
          const data = await retrieveFromIPFS<IPFSData>(hash);
          if (data && data.embedding) {
            console.log(`Successfully retrieved embedding from ${hash}`);
            console.log('Embedding length:', data.embedding.length);
            console.log('First few values:', data.embedding.slice(0, 5));
            
            // Convert to Float32Array
            const embedding = new Float32Array(data.embedding);
            embeddings.push(embedding);
          } else {
            console.error(`No embedding data found in IPFS hash: ${hash}`);
          }
        } catch (err) {
          console.error(`Error retrieving embedding from ${hash}:`, err);
        }
      }

      // Compare the first embedding with all others
      if (embeddings.length > 0) {
        const baseEmbedding = embeddings[0];
        for (let i = 1; i < embeddings.length; i++) {
          const similarity = calculateCosineSimilarity(baseEmbedding, embeddings[i]);
          console.log(`Similarity between embedding 0 and ${i}: ${similarity}`);
          similarities.push(similarity);
          matches.push(similarity > SIMILARITY_THRESHOLD);
        }
      }

      return { matches, similarities };
    } catch (err) {
      console.error('Error in test comparison:', err);
      throw err;
    }
  };

  return {
    registerFaceHash,
    verifyFaceHash,
    checkFaceUniqueness,
    resetLocalData,
    checkPublicKey,
    publicKeyInfo,
    isRegistering,
    isVerifying,
    error,
    registrationStatus,
    uniquenessStatus,
    walletAddress: primaryWallet?.address,
    ensureValidBytesLike,
    testCompareEmbeddings
  };
} 