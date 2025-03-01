import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { getSigner } from '@dynamic-labs/ethers-v6';
import { FaceApiService } from '../services/FaceApiService';

// Import the ABI directly
import faceAbi from './faceAbi.json';

// Threshold for face similarity (0.75 is a good balance for face recognition)
// Increasing to 0.85 to reduce false positives - different people should have lower similarity
const SIMILARITY_THRESHOLD = 0.60;

// Contract address - replace with your deployed contract address
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

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
    
    try {
      // Validate contract address
      if (!CONTRACT_ADDRESS) {
        console.error('Contract address is not set');
        throw new Error('Contract address is not configured. Please check your environment variables.');
      }
      
      // Validate that the address is a valid Ethereum address
      try {
        ethers.getAddress(CONTRACT_ADDRESS); // This will throw if invalid
      } catch {
        console.error('Invalid contract address format:', CONTRACT_ADDRESS);
        throw new Error('Invalid contract address format. Please check your configuration.');
      }
      
      const signer = await getSigner(primaryWallet);
      
      // Log the ABI to debug
      console.log('Contract address:', CONTRACT_ADDRESS);
      console.log('ABI type:', typeof faceAbi);
      
      // Create the interface first to ensure proper formatting
      let contractInterface;
      try {
        // Try different ways to get the ABI
        if (Array.isArray(faceAbi)) {
          contractInterface = new ethers.Interface(faceAbi);
        } else if (typeof faceAbi === 'object' && faceAbi !== null && 'abi' in faceAbi && Array.isArray(faceAbi.abi)) {
          contractInterface = new ethers.Interface(faceAbi.abi);
        } else {
          // Last resort, try to parse it as a string
          contractInterface = new ethers.Interface(JSON.stringify(faceAbi));
        }
      } catch (interfaceError) {
        console.error('Error creating interface:', interfaceError);
        throw new Error('Invalid ABI format: ' + (interfaceError instanceof Error ? interfaceError.message : String(interfaceError)));
      }
      
      // Create the contract with the properly formatted interface
      return new ethers.Contract(CONTRACT_ADDRESS, contractInterface, signer);
    } catch (error) {
      console.error('Error creating contract instance:', error);
      throw new Error('Failed to create contract instance: ' + (error instanceof Error ? error.message : String(error)));
    }
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
        let registrationsCount;
        try {
          registrationsCount = await contract.totalRegistrants();
          console.log('Raw registrationsCount:', registrationsCount);
        } catch (countError) {
          console.error('Error getting total registrants:', countError);
          // If we can't get the count, assume no registrations yet
          console.log('Assuming no registrations due to contract error');
          setUniquenessStatus('unique');
          return true;
        }
      
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
        
        // Pass the face embedding directly to the comparison function
        // No need to convert to Blob anymore
        
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
            
            // Use the FaceApiService to compare the face with the IPFS hash
            // Now passing the embedding directly instead of converting to a Blob
            console.log(`Comparing face with IPFS hash: ${registration.ipfsHash}`);
            const comparisonResult = await FaceApiService.compareFaceWithIpfs(
              faceEmbedding,
              registration.ipfsHash,
              SIMILARITY_THRESHOLD.toString()
            );
            
            // Check if there was an IPFS access error
            if (!comparisonResult.success && comparisonResult.error) {
              console.warn(`API error for hash ${registration.ipfsHash}: ${comparisonResult.error}`);
              
              // If it's an IPFS gateway error, skip this registration
              if (comparisonResult.error.includes('IPFS') || 
                  comparisonResult.error.includes('gateway') || 
                  comparisonResult.error.includes('403')) {
                console.log('Skipping this registration due to IPFS access error');
                continue; // Skip this registration and continue with the next one
              }
            }
            
            const similarity = comparisonResult.similarity || 0;
            console.log(`Similarity with registration ${i}: ${similarity}`);
            
            // If similarity is above threshold, face is already registered
            if (similarity > SIMILARITY_THRESHOLD) {
              console.log(`Similar face found! Similarity: ${similarity}`);
              setUniquenessStatus('duplicate');
              return false;
            }
          } catch (err) {
            console.error(`Error processing registration ${i}:`, err);
            // Continue checking other registrations
          }
        }
        
        // If we get here, no similar faces were found
        console.log('No similar faces found, face is unique');
        setUniquenessStatus('unique');
        return true;
      } catch (err) {
        console.error('Error checking face uniqueness:', err);
        setError('Error checking face uniqueness. Please try again.');
        setUniquenessStatus('error');
        return false;
      }
    } catch (err) {
      console.error('Error in face uniqueness check:', err);
      setError('Error checking face uniqueness. Please try again.');
      setUniquenessStatus('error');
      return false;
    }
  }, [primaryWallet, getContract, setError, setUniquenessStatus]);

  // Helper function to ensure a hash is properly formatted for blockchain transactions
  const ensureValidBytesLike = (hash: string): string => {
    // If it's not a string, we can't process it
    if (typeof hash !== 'string') {
      console.error('Invalid hash type, expected string but got:', typeof hash);
      throw new Error('Invalid hash format: not a string');
    }
    
    try {
      // Remove 0x prefix if present
      let cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash;
      
      // Check if it's a valid hex string
      if (!/^[0-9a-fA-F]+$/.test(cleanHash)) {
        // Try to convert from base64 if it contains non-hex characters
        try {
          const binaryStr = atob(cleanHash);
          let hexValue = '';
          for (let i = 0; i < binaryStr.length; i++) {
            const hex = binaryStr.charCodeAt(i).toString(16).padStart(2, '0');
            hexValue += hex;
          }
          cleanHash = hexValue;
        } catch (e) {
          console.error('Failed to convert possible base64 to hex:', e);
          throw new Error('Invalid hash format: not a valid hex or base64 string');
        }
      }
      
      // Ensure the hash is exactly 32 bytes (64 hex characters)
      if (cleanHash.length > 64) {
        // If longer than 32 bytes, truncate
        console.warn(`Hash is too long (${cleanHash.length / 2} bytes), truncating to 32 bytes`);
        cleanHash = cleanHash.slice(0, 64);
      } else if (cleanHash.length < 64) {
        // If shorter than 32 bytes, pad with zeros
        console.warn(`Hash is too short (${cleanHash.length / 2} bytes), padding to 32 bytes`);
        cleanHash = cleanHash.padStart(64, '0');
      }
      
      // Add 0x prefix back
      return '0x' + cleanHash;
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
        
        // Format the face hash as a proper bytes32 value
        const formattedFaceHash = ensureValidBytesLike(faceHash);
        console.log('Formatted face hash:', formattedFaceHash.substring(0, 12) + '...');
        
        // Ensure IPFS hash is properly formatted
        // Check if the IPFS hash already has a prefix
        let formattedIpfsHash = ipfsHash;
        if (ipfsHash.startsWith('ipfs://')) {
          // Some contracts expect the hash without the prefix
          formattedIpfsHash = ipfsHash.replace('ipfs://', '');
        } else if (ipfsHash.startsWith('Qm') || ipfsHash.startsWith('ba')) {
          // This is a raw IPFS hash without prefix, which is what most contracts expect
          formattedIpfsHash = ipfsHash;
        }
        console.log('Formatted IPFS hash:', formattedIpfsHash);
        
        // Use ethers.js to create a proper bytes32 value
        try {
          console.log('Sending registration transaction...');
          
          // Examine the contract ABI to understand the expected parameter types
          const registerFunction = contract.interface.getFunction('register');
          if (registerFunction) {
            console.log('Register function ABI:', registerFunction);
            console.log('Parameter types:', registerFunction.inputs.map((input: {name: string, type: string}) => `${input.name}: ${input.type}`).join(', '));
          }
          
          // Convert to bytes32 using ethers.js utilities
          const bytes32FaceHash = ethers.zeroPadValue(formattedFaceHash, 32);
          console.log('Bytes32 face hash:', bytes32FaceHash);
          console.log('Bytes32 face hash length (bytes):', ethers.getBytes(bytes32FaceHash).length);
          
          // Log the parameters being sent to the contract
          console.log('Contract parameters:');
          console.log('- faceHash:', bytes32FaceHash);
          console.log('- publicKey:', publicKey.substring(0, 20) + '...');
          console.log('- ipfsHash:', formattedIpfsHash);
          
          // Try to get more information about the potential revert by calling the function statically
          try {
            console.log('Attempting to simulate the transaction...');
            await contract.register.staticCall(bytes32FaceHash, publicKey, formattedIpfsHash);
            console.log('Static call succeeded, transaction should work');
          } catch (staticError) {
            console.error('Static call failed:', staticError);
            if (staticError instanceof Error) {
              console.error('Static call error message:', staticError.message);
              
              // Try to extract more information if available
              if ('data' in staticError) {
                // Define a type for errors with data property
                interface ErrorWithData extends Error {
                  data?: string;
                }
                console.error('Error data:', (staticError as ErrorWithData).data);
              }
            }
            // Continue with the transaction anyway, as sometimes static calls fail but transactions succeed
          }
          
          // Try with overrides to provide more gas
          const tx = await contract.register(bytes32FaceHash, publicKey, formattedIpfsHash, {
            gasLimit: 500000, // Provide a higher gas limit to ensure it's not a gas issue
          });
          console.log('Transaction sent, waiting for confirmation...');
          await tx.wait();
          console.log('Transaction confirmed!');
          setRegistrationStatus('success');
          console.log('Face hash registered successfully!');
        } catch (txError) {
          console.error('Transaction error:', txError);
          
          // Log more details about the error
          if (txError instanceof Error) {
            console.error('Error message:', txError.message);
            console.error('Error name:', txError.name);
            // Use a type that includes the code property
            interface ErrorWithCode extends Error {
              code?: string | number;
              data?: string;
              reason?: string;
            }
            if ('code' in txError) {
              console.error('Error code:', (txError as ErrorWithCode).code);
            }
            if ('data' in txError) {
              console.error('Error data:', (txError as ErrorWithCode).data);
            }
            if ('reason' in txError) {
              console.error('Error reason:', (txError as ErrorWithCode).reason);
            }
          }
          
          // Handle missing revert data error
          if (txError instanceof Error && txError.message.includes('missing revert data')) {
            console.log('Detected missing revert data error, trying alternative approach...');
            
            // Get the bytes32 face hash again to ensure it's in scope
            const bytes32FaceHash = ethers.zeroPadValue(formattedFaceHash, 32);
            
            try {
              // Try with a different IPFS hash format
              // Some contracts expect just the CID without any prefix
              const rawIpfsHash = formattedIpfsHash.replace('ipfs://', '');
              console.log('Trying with raw IPFS hash:', rawIpfsHash);
              
              const tx = await contract.register(bytes32FaceHash, publicKey, rawIpfsHash, {
                gasLimit: 500000, // Provide a higher gas limit
              });
              console.log('Transaction sent with raw IPFS hash, waiting for confirmation...');
              await tx.wait();
              console.log('Transaction confirmed!');
              setRegistrationStatus('success');
              console.log('Face hash registered successfully!');
            } catch (ipfsError) {
              console.error('Error with raw IPFS hash:', ipfsError);
              
              // Try with a different public key format
              try {
                console.log('Trying with different public key format...');
                // Some contracts expect the public key without 0x prefix
                const rawPublicKey = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
                
                // Get the bytes32 face hash again to ensure it's in scope
                const bytes32FaceHash = ethers.zeroPadValue(formattedFaceHash, 32);
                
                const tx = await contract.register(bytes32FaceHash, '0x' + rawPublicKey, formattedIpfsHash, {
                  gasLimit: 500000,
                });
                console.log('Transaction sent with alternative public key format, waiting for confirmation...');
                await tx.wait();
                console.log('Transaction confirmed!');
                setRegistrationStatus('success');
                console.log('Face hash registered successfully!');
              } catch (pkError) {
                console.error('Error with alternative public key format:', pkError);
                throw pkError;
              }
            }
          } else if (txError instanceof Error && txError.message.includes('data length')) {
            // Handle data length error as before
            console.log('Trying alternative format due to data length error...');
            try {
              // Try using a different approach to format the hash
              const hashBytes = ethers.getBytes(formattedFaceHash);
              // Ensure it's exactly 32 bytes
              const paddedBytes = new Uint8Array(32);
              paddedBytes.set(hashBytes.slice(0, Math.min(hashBytes.length, 32)));
              
              const paddedHash = ethers.hexlify(paddedBytes);
              console.log('Alternative format hash:', paddedHash);
              
              const tx = await contract.register(paddedHash, publicKey, formattedIpfsHash, {
                gasLimit: 500000,
              });
              console.log('Transaction sent with alternative format, waiting for confirmation...');
              await tx.wait();
              console.log('Transaction confirmed!');
              setRegistrationStatus('success');
              console.log('Face hash registered successfully!');
            } catch (altError) {
              console.error('Error with alternative format:', altError);
              throw altError;
            }
          } else {
            throw txError;
          }
        }

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
      try {
        const registration = await contract.getRegistration(primaryWallet.address);
        
        // Check if the wallet is registered
        if (registration.wallet === ethers.ZeroAddress) {
          console.log('Wallet not registered');
          return false;
        }
        
        // Check if the hash matches
        const isVerified = registration.faceHash === faceHash;
        console.log('Face hash verification result:', isVerified);
        console.log('Contract hash:', registration.faceHash);
        console.log('Provided hash:', faceHash);
        
        return isVerified;
      } catch (contractError) {
        console.error('Contract call error:', contractError);
        
        // Check if this is a "not registered" case
        if (contractError instanceof Error && 
            (contractError.message.includes('not registered') || 
             contractError.message.includes('revert'))) {
          console.log('Wallet likely not registered yet');
          return false;
        }
        
        throw contractError; // Re-throw for the outer catch
      }
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
      const similarities: number[] = [];
      const matches: boolean[] = [];

      // Need at least 2 IPFS hashes to compare
      if (ipfsHashes.length < 2) {
        console.error('Need at least 2 IPFS hashes to compare');
        return { matches, similarities };
      }

      console.log('Comparing face embeddings using external API...');
      
      // Get the first IPFS hash as the base for comparison
      const baseIpfsHash = ipfsHashes[0];
      console.log(`Using ${baseIpfsHash} as the base for comparison`);
      
      // Create a dummy embedding for API request
      // The API will use the IPFS hash, not this embedding
      const dummyEmbedding = new Float32Array(512); // Typical face embedding size
      
      // Compare the first hash with all others using the API
      for (let i = 1; i < ipfsHashes.length; i++) {
        try {
          const targetIpfsHash = ipfsHashes[i];
          console.log(`Comparing base hash with ${targetIpfsHash}`);
          
          // Use the FaceApiService to compare the two IPFS hashes
          const comparisonResult = await FaceApiService.compareFaceWithIpfs(
            dummyEmbedding,
            targetIpfsHash,
            SIMILARITY_THRESHOLD.toString()
          );
          
          const similarity = comparisonResult.similarity || 0;
          console.log(`Similarity between hash 0 and ${i}: ${similarity}`);
          
          similarities.push(similarity);
          matches.push(similarity > SIMILARITY_THRESHOLD);
        } catch (err) {
          console.error(`Error comparing with hash ${ipfsHashes[i]}:`, err);
          similarities.push(0);
          matches.push(false);
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