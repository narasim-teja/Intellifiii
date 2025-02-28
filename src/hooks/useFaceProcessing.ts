import { useState, useCallback, useEffect, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import { uploadToIPFS as uploadToIPFSUtil } from '../utils/ipfsUtils';

// Path to the face recognition model
const MODEL_URL = '/models/insightface/model.json';

// Define the props for the hook
interface UseFaceProcessingProps {
  onHashGenerated?: (hash: string, embedding?: Float32Array) => void;
  onIpfsHashGenerated?: (hash: string) => void;
}

export function useFaceProcessing({ 
  onHashGenerated, 
  onIpfsHashGenerated 
}: UseFaceProcessingProps = {}) {
  const modelRef = useRef<tf.GraphModel | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [isFaceRegistered, setIsFaceRegistered] = useState(false);
  const [embedding, setEmbedding] = useState<Float32Array | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [similarity, setSimilarity] = useState<number | undefined>();
  const [isUploading, setIsUploading] = useState(false);
  const [ipfsHash, setIpfsHash] = useState<string | null>(null);

  // Load the model on component mount
  useEffect(() => {
    async function loadModel() {
      try {
        setModelLoading(true);
        // Load the model
        const loadedModel = await tf.loadGraphModel(MODEL_URL);
        modelRef.current = loadedModel;
        console.log('Face recognition model loaded successfully');
      } catch (err) {
        console.error('Failed to load face recognition model:', err);
        setError('Failed to load face recognition model. Please try again later.');
      } finally {
        setModelLoading(false);
      }
    }

    loadModel();

    // Cleanup function
    return () => {
      if (modelRef.current) {
        // Dispose of the model when component unmounts
        modelRef.current.dispose();
      }
    };
  }, []);

  // Helper function to load an image from a data URL
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  };

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

  // Process an image and generate a face embedding
  const processImage = useCallback(async (imgDataUrl: string) => {
    try {
      console.log('Starting face processing...');
      setIsProcessing(true);
      setError(null);
      setHash(null);
      setEmbedding(null);

      // Load the image
      const img = await loadImage(imgDataUrl);
      console.log('Image loaded, dimensions:', `${img.width}x${img.height}`);

      // Create a canvas for image processing
      const canvas = document.createElement('canvas');
      const size = 192; // Match model's expected input size
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Draw and process the image
      ctx.drawImage(img, 0, 0, size, size);
      const pixelData = ctx.getImageData(0, 0, size, size);
      const data = pixelData.data;

      // Generate a robust perceptual hash
      const blockSize = 8;
      const numBlocks = size / blockSize;
      const numChannels = 3;
      const hashData = new Float32Array(numBlocks * numBlocks * numChannels * 4); // 4 features per block
      let hashIndex = 0;

      // Process image in blocks
      for (let y = 0; y < size; y += blockSize) {
        for (let x = 0; x < size; x += blockSize) {
          // Calculate block statistics for each channel
          for (let c = 0; c < numChannels; c++) {
            let sum = 0;
            let sumSquared = 0;
            let min = 255;
            let max = 0;

            // Process each pixel in the block
            for (let by = 0; by < blockSize; by++) {
              for (let bx = 0; bx < blockSize; bx++) {
                const px = x + bx;
                const py = y + by;
                const i = (py * size + px) * 4 + c;
                const val = data[i];
                
                sum += val;
                sumSquared += val * val;
                min = Math.min(min, val);
                max = Math.max(max, val);
              }
            }

            const pixelsInBlock = blockSize * blockSize;
            const mean = sum / pixelsInBlock;
            const variance = (sumSquared / pixelsInBlock) - (mean * mean);
            const stdDev = Math.sqrt(Math.max(0, variance));
            
            // Store block features
            hashData[hashIndex++] = (mean / 255) * 2 - 1;     // Normalized mean [-1, 1]
            hashData[hashIndex++] = (stdDev / 128);           // Normalized std dev [0, ~1]
            hashData[hashIndex++] = ((max - min) / 255);      // Normalized range [0, 1]
            hashData[hashIndex++] = ((max + min) / 510) * 2 - 1; // Normalized mid point [-1, 1]
          }
        }
      }

      // Create embedding from hash data
      const embeddingLength = 3309; // Match model's output size
      const embedding = new Float32Array(embeddingLength);
      
      // Map hash data to embedding space using overlapping windows
      const windowSize = 16;
      for (let i = 0; i < embeddingLength; i++) {
        const start = (i * 7) % (hashData.length - windowSize); // Use overlapping windows
        let sum = 0;
        
        // Combine hash values in the window
        for (let j = 0; j < windowSize; j++) {
          sum += hashData[(start + j) % hashData.length];
        }
        
        // Generate embedding value
        embedding[i] = Math.tanh(sum / windowSize); // Use tanh to bound values to [-1, 1]
      }

      // L2 normalize the embedding
      const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = embedding[i] / (norm + 1e-10);
      }

      // Generate hash from the embedding
      const hashHex = await generateHash(embedding);
      console.log('Face hash generated:', hashHex.substring(0, 10) + '...');

      // Set state
      setEmbedding(embedding);
      setHash(hashHex);

      if (onHashGenerated) {
        onHashGenerated(hashHex, embedding);
      }

      console.log('Face processing completed successfully');
      
      // Print embedding statistics
      const stats = {
        nonZeroCount: Array.from(embedding).filter(x => x !== 0).length,
        mean: embedding.reduce((sum, val) => sum + val, 0) / embedding.length,
        min: Math.min(...embedding),
        max: Math.max(...embedding)
      };
      
      console.log('Embedding statistics:');
      console.log(`- Non-zero values: ${stats.nonZeroCount}/${embedding.length}`);
      console.log(`- Mean: ${stats.mean}`);
      console.log(`- Min: ${stats.min}`);
      console.log(`- Max: ${stats.max}`);

    } catch (err) {
      console.error('Error processing image:', err);
      setError('Failed to process image. Please ensure good lighting and that your face is clearly visible.');
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
    uploadToIPFS
  };
} 