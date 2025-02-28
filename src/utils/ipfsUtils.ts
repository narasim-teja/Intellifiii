import axios from 'axios';

// Get Pinata JWT from environment variable
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

// Base URL for Pinata API
const PINATA_API_URL = 'https://api.pinata.cloud';

// Define a type for the data to upload
interface IPFSUploadData {
  embedding?: number[];
  timestamp?: number;
  version?: string;
  [key: string]: unknown;
}

/**
 * Upload data to IPFS via Pinata
 * @param data - The data to upload
 * @param name - Name for the file (optional)
 * @returns The IPFS hash (CID) of the uploaded content
 */
export async function uploadToIPFS(data: IPFSUploadData, name = 'face-embedding'): Promise<string> {
  if (!PINATA_JWT) {
    throw new Error('Pinata JWT not found in environment variables');
  }

  try {
    // Prepare the JSON data
    const jsonData = JSON.stringify(data);
    
    // Create a Blob from the JSON data
    const blob = new Blob([jsonData], { type: 'application/json' });
    
    // Create a File object from the Blob
    const file = new File([blob], `${name}-${Date.now()}.json`, { type: 'application/json' });
    
    // Create FormData
    const formData = new FormData();
    formData.append('file', file);
    
    // Add metadata
    const metadata = JSON.stringify({
      name: `${name}-${Date.now()}`,
      keyvalues: {
        type: 'face-embedding',
        timestamp: Date.now()
      }
    });
    formData.append('pinataMetadata', metadata);
    
    // Add options
    const options = JSON.stringify({
      cidVersion: 1
    });
    formData.append('pinataOptions', options);
    
    // Make the request to Pinata
    const response = await axios.post(
      `${PINATA_API_URL}/pinning/pinFileToIPFS`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${PINATA_JWT}`,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    
    // Return the IPFS hash
    return response.data.IpfsHash;
  } catch (error) {
    console.error('Error uploading to IPFS:', error);
    throw new Error('Failed to upload to IPFS');
  }
}

/**
 * Retrieve data from IPFS via Pinata gateway
 * @param ipfsHash - The IPFS hash (CID) to retrieve
 * @returns The data stored at the IPFS hash
 */
export async function retrieveFromIPFS<T>(ipfsHash: string): Promise<T> {
  try {
    // Use Pinata gateway to retrieve the data
    const response = await axios.get(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
    return response.data as T;
  } catch (error) {
    console.error('Error retrieving from IPFS:', error);
    throw new Error('Failed to retrieve from IPFS');
  }
}

/**
 * Check if an IPFS hash exists on Pinata
 * @param ipfsHash - The IPFS hash (CID) to check
 * @returns Boolean indicating if the hash exists
 */
export async function checkIPFSExists(ipfsHash: string): Promise<boolean> {
  if (!PINATA_JWT) {
    throw new Error('Pinata JWT not found in environment variables');
  }

  try {
    const response = await axios.get(
      `${PINATA_API_URL}/data/pinList?status=pinned&hashContains=${ipfsHash}`,
      {
        headers: {
          'Authorization': `Bearer ${PINATA_JWT}`
        }
      }
    );
    
    return response.data.count > 0;
  } catch (error) {
    console.error('Error checking IPFS existence:', error);
    return false;
  }
}

/**
 * Convert a Float32Array to a regular array for storage
 */
export function float32ArrayToArray(embedding: Float32Array): number[] {
  return Array.from(embedding);
}

/**
 * Convert a regular array back to Float32Array
 */
export function arrayToFloat32Array(array: number[]): Float32Array {
  return new Float32Array(array);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function calculateCosineSimilarity(embedding1: Float32Array | number[], embedding2: Float32Array | number[]): number {
  const arr1 = Array.isArray(embedding1) ? embedding1 : Array.from(embedding1);
  const arr2 = Array.isArray(embedding2) ? embedding2 : Array.from(embedding2);
  
  // Ensure arrays are the same length
  if (arr1.length !== arr2.length) {
    console.error(`Embedding dimension mismatch: ${arr1.length} vs ${arr2.length}`);
    throw new Error('Embeddings must have the same dimensions');
  }
  
  // Sanity check: Verify embeddings are not identical arrays (which would be suspicious for different people)
  let identicalCount = 0;
  for (let i = 0; i < Math.min(10, arr1.length); i++) {
    if (arr1[i] === arr2[i]) {
      identicalCount++;
    }
  }
  
  if (identicalCount >= 10) {
    console.warn('WARNING: First 10 embedding values are identical. This is highly suspicious for different people.');
  }
  
  // Calculate dot product
  let dotProduct = 0;
  for (let i = 0; i < arr1.length; i++) {
    dotProduct += arr1[i] * arr2[i];
  }
  
  // Calculate magnitudes
  let mag1 = 0;
  let mag2 = 0;
  for (let i = 0; i < arr1.length; i++) {
    mag1 += arr1[i] * arr1[i];
    mag2 += arr2[i] * arr2[i];
  }
  
  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);
  
  // Prevent division by zero
  if (mag1 === 0 || mag2 === 0) {
    console.error('Zero magnitude detected in embedding. This indicates a problem with the embedding generation.');
    return 0; // Return 0 similarity for zero vectors
  }
  
  // Calculate cosine similarity
  const similarity = dotProduct / (mag1 * mag2);
  
  // Log suspicious results
  if (similarity > 0.99) {
    console.warn(`Unusually high similarity detected: ${similarity}. This is rare for different people.`);
  }
  
  return similarity;
} 