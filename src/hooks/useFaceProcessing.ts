import { useState, useCallback, useEffect } from 'react';
import { uploadToIPFS as uploadToIPFSUtil } from '../utils/ipfsUtils';
import { FaceApiService } from '../services/FaceApiService';

// Define the props for the hook
interface UseFaceProcessingProps {
  onHashGenerated?: (hash: string, embedding?: Float32Array) => void;
  onIpfsHashGenerated?: (hash: string) => void;
}

export function useFaceProcessing({ 
  onHashGenerated, 
  onIpfsHashGenerated
}: UseFaceProcessingProps = {}) {
  const [modelLoading, setModelLoading] = useState(true);
  const [isFaceRegistered, setIsFaceRegistered] = useState(false);
  const [embedding, setEmbedding] = useState<Float32Array | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [similarity, setSimilarity] = useState<number | undefined>();
  const [isUploading, setIsUploading] = useState(false);
  const [ipfsHash, setIpfsHash] = useState<string | null>(null);
  const [isCloudApiHealthy, setIsCloudApiHealthy] = useState<boolean | null>(null);

  // Check cloud API health on component mount
  useEffect(() => {
    async function checkCloudApiHealth() {
      try {
        setModelLoading(true);
        await FaceApiService.healthCheck();
        setIsCloudApiHealthy(true);
        console.log('Cloud API health check successful');
      } catch (err) {
        console.error('Cloud API health check failed:', err);
        setIsCloudApiHealthy(false);
        setError('Failed to connect to face analysis API. Please try again later.');
      } finally {
        setModelLoading(false);
      }
    }

    checkCloudApiHealth();
  }, []);

  // Generate a hash from the face embedding
  const generateHash = useCallback(async (embedding: Float32Array): Promise<string> => {
    try {
      // Convert the embedding to a byte array
      const embeddingBytes = new Uint8Array(embedding.buffer);
      
      // Use the SubtleCrypto API to generate a SHA-256 hash
      const hashBuffer = await crypto.subtle.digest('SHA-256', embeddingBytes);
      
      // Convert the hash to a hex string (ensure it's a valid BytesLike for Ethereum)
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      console.log('Generated hash (hex):', hashHex.substring(0, 18) + '...');
      return hashHex;
    } catch (err) {
      console.error('Error generating hash:', err);
      throw new Error('Failed to generate hash from face embedding');
    }
  }, []);

  // Check if an embedding is valid (not all zeros or very small values)
  const isValidEmbedding = useCallback((embedding: Float32Array): boolean => {
    // Count zeros and very small values
    let zeroCount = 0;
    let smallValueCount = 0;
    const smallThreshold = 1e-6; // Reduced threshold for small values
    
    // Check the entire embedding
    for (let i = 0; i < embedding.length; i++) {
      if (embedding[i] === 0) {
        zeroCount++;
      } else if (Math.abs(embedding[i]) < smallThreshold) {
        smallValueCount++;
      }
    }
    
    // Calculate statistics for logging
    let sum = 0;
    let sumSquared = 0;
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    const nonZeroValues = [];
    
    for (let i = 0; i < embedding.length; i++) {
      sum += embedding[i];
      sumSquared += embedding[i] * embedding[i];
      if (embedding[i] !== 0) {
      min = Math.min(min, embedding[i]);
      max = Math.max(max, embedding[i]);
        nonZeroValues.push(embedding[i]);
      }
    }
    
    const mean = sum / embedding.length;
    const variance = (sumSquared / embedding.length) - (mean * mean);
    const stdDev = Math.sqrt(Math.abs(variance));
    
    // Calculate statistics only for non-zero values
    const nonZeroMean = nonZeroValues.length > 0 
      ? nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length 
      : 0;
    const nonZeroStdDev = nonZeroValues.length > 0
      ? Math.sqrt(nonZeroValues.reduce((acc, val) => acc + Math.pow(val - nonZeroMean, 2), 0) / nonZeroValues.length)
      : 0;
    
    console.log('Embedding validation statistics:');
    console.log(`- Zero count: ${zeroCount}/${embedding.length}`);
    console.log(`- Small value count: ${smallValueCount}/${embedding.length}`);
    console.log(`- Overall mean: ${mean}`);
    console.log(`- Overall standard deviation: ${stdDev}`);
    console.log(`- Non-zero mean: ${nonZeroMean}`);
    console.log(`- Non-zero standard deviation: ${nonZeroStdDev}`);
    console.log(`- Min (non-zero): ${min}`);
    console.log(`- Max (non-zero): ${max}`);
    
    // Validation criteria for sparse embeddings:
    // 1. Must have some non-zero values (at least 5% of the embedding)
    // 2. Non-zero values should have reasonable spread
    // 3. Non-zero values should have reasonable magnitude
    const hasMinimumNonZeroValues = (embedding.length - zeroCount) >= embedding.length * 0.05;
    const hasReasonableNonZeroSpread = nonZeroStdDev > 0.001;
    const hasReasonableMagnitude = Math.max(Math.abs(min), Math.abs(max)) > 0.01;
    
    const isValid = hasMinimumNonZeroValues && hasReasonableNonZeroSpread && hasReasonableMagnitude;
    console.log('Validation checks:');
    console.log(`- Has minimum non-zero values (>5%): ${hasMinimumNonZeroValues}`);
    console.log(`- Has reasonable non-zero spread: ${hasReasonableNonZeroSpread}`);
    console.log(`- Has reasonable magnitude: ${hasReasonableMagnitude}`);
    console.log(`Embedding validity check: ${isValid ? 'VALID' : 'INVALID'}`);
    
    return isValid;
  }, []);

  // Process an image using the cloud API
  const processImage = useCallback(async (imgDataUrl: string) => {
    try {
      console.log('Starting face processing with cloud API...');
      setIsProcessing(true);
      setError(null);
      setHash(null);
      setEmbedding(null);

      // Convert data URL to Blob
      const blob = FaceApiService.dataURLtoBlob(imgDataUrl);
      
      // Send to cloud API
      const result = await FaceApiService.analyzeFace(blob);
      
      if (!result) {
        throw new Error('No response from API');
      }
      
      // Check if the API returned an error
      if (result.error) {
        throw new Error(`API error: ${result.error}`);
      }
      
      // Check if the API returned an embedding
      if (!result.embedding || !Array.isArray(result.embedding) || result.embedding.length === 0) {
        throw new Error('No face embedding returned from API. Make sure your face is clearly visible in the image.');
      }
      
      console.log('Received embedding from cloud API with length:', result.embedding.length);
      
      // Convert the array to Float32Array
      const embeddingArray = new Float32Array(result.embedding);
      
      // Generate hash from the embedding
      const hashHex = await generateHash(embeddingArray);
      console.log('Face hash generated:', hashHex.substring(0, 10) + '...');
      
      // Set state
      setEmbedding(embeddingArray);
      setHash(hashHex);
      
      if (onHashGenerated) {
        onHashGenerated(hashHex, embeddingArray);
      }
      
      console.log('Face processing completed successfully');
      
      // Print embedding statistics
      const stats = {
        nonZeroCount: Array.from(embeddingArray).filter(x => x !== 0).length,
        mean: embeddingArray.reduce((sum, val) => sum + val, 0) / embeddingArray.length,
        min: Math.min(...embeddingArray),
        max: Math.max(...embeddingArray)
      };
      
      console.log('Embedding statistics:');
      console.log(`- Non-zero values: ${stats.nonZeroCount}/${embeddingArray.length}`);
      console.log(`- Mean: ${stats.mean}`);
      console.log(`- Min: ${stats.min}`);
      console.log(`- Max: ${stats.max}`);
      
    } catch (err) {
      console.error('Error processing image with cloud API:', err);
      setError(`Failed to process image with cloud API: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [generateHash, onHashGenerated]);

  // Reset all face processing state
  const resetFaceProcessing = useCallback(() => {
    setEmbedding(null);
    setHash(null);
    setError(null);
    setSimilarity(undefined);
    setIsFaceRegistered(false);
  }, []);

  // Upload the embedding to IPFS
  const uploadToIPFS = useCallback(async () => {
    if (!embedding) {
      setError('No face embedding to upload');
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      
      // Validate the embedding before uploading
      if (!isValidEmbedding(embedding)) {
        console.error('Cannot upload invalid embedding');
        setError('Invalid face embedding. Please capture a new image with better lighting and make sure your face is clearly visible.');
        setIsUploading(false);
        return;
      }
      
      // Convert the Float32Array to a regular array for JSON serialization
      const embeddingArray = Array.from(embedding);
      
      // Create the data object to upload
      const data = {
        embedding: embeddingArray,
        timestamp: Date.now(),
        version: '1.0'
      };
      
      console.log('Uploading embedding to IPFS...');
      const ipfsHash = await uploadToIPFSUtil(data, 'face-embedding');
      console.log('IPFS upload successful, hash:', ipfsHash);
      
      setIpfsHash(ipfsHash);
      onIpfsHashGenerated?.(ipfsHash);
      
    } catch (err) {
      console.error('Error uploading to IPFS:', err);
      setError('Failed to upload to IPFS. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [embedding, onIpfsHashGenerated, isValidEmbedding]);

  // Compare two face embeddings
  const compareFaceEmbeddings = useCallback((embedding1: Float32Array, embedding2: Float32Array): number => {
    // Convert Float32Arrays to regular arrays
    const arr1 = Array.from(embedding1);
    const arr2 = Array.from(embedding2);
    
    // Use FaceApiService for comparison (which now uses a local implementation)
    return FaceApiService.compareFaceEmbeddings(arr1, arr2);
  }, []);

  return {
    modelLoading,
    isFaceRegistered,
    embedding,
    hash,
    error,
    isProcessing,
    similarity,
    processImage,
    resetFaceProcessing,
    faceEmbedding: embedding, // Expose the embedding as faceEmbedding for clarity
    isUploading,
    ipfsHash,
    uploadToIPFS,
    isCloudApiHealthy,
    compareFaceEmbeddings
  };
} 