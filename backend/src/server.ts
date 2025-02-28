/// <reference types="bun-types" />

/* eslint-disable @typescript-eslint/no-unused-vars */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { mkdir } from "fs/promises";
import * as tf from '@tensorflow/tfjs-node';
import sharp from 'sharp';
import axios from 'axios';
import { ethers } from 'ethers';

// Use this pre-prompt to customize what you want your specified vision model todo
const PRE_PROMPT = `What is in this image?`;

// IPFS Configuration
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API_URL = 'https://api.pinata.cloud';
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

// Face detection configuration
const MODEL_DIR = join(process.cwd(), 'insightface');
const MODEL_PATH = `file://${join(MODEL_DIR, 'model.json')}`;
const SIMILARITY_THRESHOLD = 0.40;

// Model reference
let model: tf.GraphModel | null = null;

//enum for the different models




// Add constants for image storage
const IMAGE_STORAGE_DIR = join(process.cwd(), "public", "images");


// Types for face processing
interface FaceEmbedding {
  embedding: number[];
  timestamp: number;
  version: string;
}

interface FaceProcessingResult {
  hash: string;
  embedding: number[];
  error?: string;
}

//Facebook Messenger whitelists this localhost port so is the only one you can currently use
const PORT = 3103;

const CORS_HEADERS = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers": "Content-Type",
  },
};

// Add smart contract configuration
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// ABI for the face verification functions
const CONTRACT_ABI = [
  "function registrants(uint256) view returns (address)",
  "function totalRegistrants() view returns (uint256)",
  "function getRegistration(address) view returns (tuple(address wallet, bytes publicKey, bytes32 faceHash, string ipfsHash, uint256 timestamp))"
];

// Initialize ethers provider and contract
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS!, CONTRACT_ABI, provider);

// Function to get all registered faces from the contract
async function getRegisteredFaces(): Promise<{ address: string; ipfsHash: string }[]> {
  try {
    const totalRegistrants = await contract.totalRegistrants();
    const faces: { address: string; ipfsHash: string }[] = [];

    for (let i = 0; i < totalRegistrants; i++) {
      const address = await contract.registrants(i);
      const registration = await contract.getRegistration(address);
      faces.push({ 
        address: registration.wallet,
        ipfsHash: registration.ipfsHash
      });
    }

    return faces;
  } catch (error) {
    console.error('Error getting registered faces:', error);
    throw error;
  }
}

// Initialize TensorFlow model
async function loadModel() {
  if (!model) {
    try {
      // Load the model using loadGraphModel since we have a model.json file
      model = await tf.loadGraphModel(MODEL_PATH);
      
      if (!model || !model.predict) {
        throw new Error('Model loaded but predict function is not available');
      }
      
      // Warmup the model with a dummy tensor of correct shape
      const dummyTensor = tf.zeros([1, 3, 192, 192]);
      const warmupResult = await model.predict(dummyTensor) as tf.Tensor;
      
      // Clean up
      dummyTensor.dispose();
      warmupResult.dispose();
      
      console.log('Face embedding model loaded successfully');
    } catch (error) {
      console.error('Error loading model:', error);
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          throw new Error(`Model file not found at ${MODEL_PATH}. Please ensure the model files are in the correct location.`);
        }
      }
      throw new Error(`Failed to load face embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  return model;
}

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response("Departed", CORS_HEADERS);
    }
    
    const url = new URL(request.url);
    
    try {
      switch (url.pathname) {
        case "/api/vision":
          return handleImageSave(request);
        case "/api/process-face":
          return handleFaceProcessing(request);
        case "/api/verify-face":
          return handleFaceVerification(request);
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      console.error('Server error:', error);
      return new Response("Internal Server Error", { status: 500, ...CORS_HEADERS });
    }
  },
});

async function downloadAndSaveImage(imageUrl: string): Promise<string> {
  try {
    // Create the images directory if it doesn't exist
    await mkdir(IMAGE_STORAGE_DIR, { recursive: true });
    const timestamp = new Date().getTime();
    const filename = `image_${timestamp}.jpg`;
    const filepath = join(IMAGE_STORAGE_DIR, filename);

    if (imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      await writeFile(filepath, Buffer.from(base64Data, 'base64'));
    } else {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('Failed to fetch image');
      const arrayBuffer = await response.arrayBuffer();
      await writeFile(filepath, Buffer.from(arrayBuffer));
    }
    return filepath;
  } catch (error) {
    console.error('Error saving image:', error);
    throw error;
  }
}

async function handleImageSave(request: Request) {
  if (request.method !== "POST" || request.headers.get("Content-Type") !== "application/json") {
    return new Response("Invalid request", { status: 400 });
  }

  try {
    const { imageUrl } = await request.json() as { imageUrl: string };
    const savedPath = await downloadAndSaveImage(imageUrl);
    
    return new Response(
      JSON.stringify({ savedImagePath: savedPath }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers },
      }
    );
  } catch (error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// Add IPFS interfaces
interface IPFSEmbeddingData {
  embedding: number[];
  timestamp: number;
  version: string;
}

interface IPFSPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

// IPFS utility functions
async function uploadToIPFS(data: IPFSEmbeddingData): Promise<string> {
  if (!PINATA_JWT) {
    throw new Error('Pinata JWT not found in environment variables');
  }

  try {
    // Prepare the JSON data
    const jsonData = JSON.stringify(data);
    
    // Create a Blob and File
    const blob = new Blob([jsonData], { type: 'application/json' });
    const file = new File([blob], `face-embedding-${Date.now()}.json`, { type: 'application/json' });
    
    // Create FormData
    const formData = new FormData();
    formData.append('file', file);
    
    // Add metadata
    const metadata = JSON.stringify({
      name: `face-embedding-${Date.now()}`,
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
    
    // Make request to Pinata
    const response = await axios.post<IPFSPinResponse>(
      `${PINATA_API_URL}/pinning/pinFileToIPFS`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${PINATA_JWT}`,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    
    return response.data.IpfsHash;
  } catch (error) {
    console.error('Error uploading to IPFS:', error);
    throw new Error('Failed to upload to IPFS');
  }
}

async function retrieveFromIPFS(ipfsHash: string): Promise<IPFSEmbeddingData> {
  try {
    const response = await axios.get<IPFSEmbeddingData>(`${PINATA_GATEWAY}/${ipfsHash}`);
    return response.data;
  } catch (error) {
    console.error('Error retrieving from IPFS:', error);
    throw new Error('Failed to retrieve from IPFS');
  }
}

async function checkIPFSExists(ipfsHash: string): Promise<boolean> {
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

// Update interfaces to include IPFS hash
interface ProcessFaceRequest {
  imagePath: string;
}

interface ProcessFaceResponse {
  hash: string;
  embedding: number[];
  ipfsHash?: string;
  error?: string;
}

interface VerifyFaceRequest {
  imagePath: string;
  storedEmbedding: number[]; // Changed from ipfsHash to direct embedding
}

interface VerifyFaceResponse {
  similarity: number;
  isFaceRegistered: boolean;
  error?: string;
}

async function processImage(imagePath: string): Promise<tf.Tensor> {
  try {
    // Ensure we're using an absolute path
    const absolutePath = imagePath.startsWith('/') ? imagePath : join(process.cwd(), imagePath);
    
    // Check if file exists
    try {
      await readFile(absolutePath);
    } catch (error) {
      throw new Error(`Image file not found at path: ${absolutePath}`);
    }

    // Read and process image with sharp
    const processedImageBuffer = await sharp(absolutePath)
      .resize(192, 192, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert raw pixel data to tensor
    const { data } = processedImageBuffer;
    
    // Create a synthetic embedding of length 3309 (same as model output)
    const embeddingLength = 3309;
    const embedding = new Float32Array(embeddingLength);
    
    // Process image in blocks like frontend
    const blockSize = 8;
    const size = 192;
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
              const i = (py * size + px) * 3 + c;
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

    // Create tensor from embedding
    const embeddingTensor = tf.tensor2d(embedding, [1, embeddingLength]);
    return embeddingTensor;
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

// Add validation function matching frontend logic
interface ValidationResult {
  isValid: boolean;
  message?: string;
}

function validateEmbedding(embedding: number[]): ValidationResult {
  // Count zeros and calculate statistics
  let zeroCount = 0;
  let sum = 0;
  let sumSquared = 0;
  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;
  const nonZeroValues: number[] = [];

  for (let i = 0; i < embedding.length; i++) {
    if (embedding[i] === 0) {
      zeroCount++;
    } else {
      nonZeroValues.push(embedding[i]);
      min = Math.min(min, embedding[i]);
      max = Math.max(max, embedding[i]);
    }
    sum += embedding[i];
    sumSquared += embedding[i] * embedding[i];
  }

  const nonZeroCount = embedding.length - zeroCount;
  const hasMinimumNonZeroValues = nonZeroCount >= embedding.length * 0.05;

  if (!hasMinimumNonZeroValues) {
    return {
      isValid: false,
      message: 'Face embedding has too many zero values. Please ensure good lighting and clear face visibility.'
    };
  }

  // Calculate statistics for non-zero values
  const nonZeroMean = nonZeroValues.length > 0 
    ? nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length 
    : 0;
  const nonZeroStdDev = nonZeroValues.length > 0
    ? Math.sqrt(nonZeroValues.reduce((acc, val) => acc + Math.pow(val - nonZeroMean, 2), 0) / nonZeroValues.length)
    : 0;

  const hasReasonableNonZeroSpread = nonZeroStdDev > 0.001;
  const hasReasonableMagnitude = Math.max(Math.abs(min), Math.abs(max)) > 0.01;

  if (!hasReasonableNonZeroSpread || !hasReasonableMagnitude) {
    return {
      isValid: false,
      message: 'Face embedding values are not well distributed. Please try capturing the image again with better lighting.'
    };
  }

  return { isValid: true };
}

// Update face processing handler to use synthetic embeddings
async function handleFaceProcessing(request: Request): Promise<Response> {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return new Response(
      JSON.stringify({ error: "Invalid content type" }), 
      { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers } 
      }
    );
  }

  try {
    const body = await request.json() as ProcessFaceRequest;
    if (!body.imagePath) {
      throw new Error("No image path provided");
    }
    
    // Process image and get synthetic embedding
    const embeddingTensor = await processImage(body.imagePath);
    const embeddingData = Array.from(await embeddingTensor.data());
    
    // Debug: Log embedding stats
    let nonZeroCount = 0;
    let minVal = Infinity;
    let maxVal = -Infinity;
    let smallValueCount = 0;
    const smallThreshold = 1e-6;
    
    for (let i = 0; i < embeddingData.length; i++) {
      if (embeddingData[i] !== 0) nonZeroCount++;
      if (Math.abs(embeddingData[i]) < smallThreshold) smallValueCount++;
      if (embeddingData[i] < minVal) minVal = embeddingData[i];
      if (embeddingData[i] > maxVal) maxVal = embeddingData[i];
    }
    
    console.log(`Embedding stats before validation:
      - Total values: ${embeddingData.length}
      - Non-zero values: ${nonZeroCount}
      - Zero values: ${embeddingData.length - nonZeroCount}
      - Small values (< ${smallThreshold}): ${smallValueCount}
      - Min value: ${minVal}
      - Max value: ${maxVal}
    `);
    
    // Clean up tensor
    embeddingTensor.dispose();
    
    // Validate embedding
    const validationResult = validateEmbedding(embeddingData);
    if (!validationResult.isValid) {
      throw new Error(validationResult.message || 'Invalid face embedding. Please ensure good lighting and clear face visibility.');
    }
    
    // Generate hash
    const hash = await generateHash(embeddingData);

    const response: FaceProcessingResult = {
      hash,
      embedding: embeddingData
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers }
      }
    );
  } catch (error) {
    console.error('Face processing error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Failed to process face" 
      }),
      { 
        status: 500, 
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers } 
      }
    );
  }
}

// Update face verification to use IPFS hashes
async function handleFaceVerification(request: Request): Promise<Response> {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return new Response(
      JSON.stringify({ error: "Invalid content type" }), 
      { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers } 
      }
    );
  }

  try {
    const body = await request.json() as ProcessFaceRequest;
    if (!body.imagePath) {
      throw new Error("No image path provided");
    }

    // Process the input image
    const embeddingTensor = await processImage(body.imagePath);
    const embeddingData = Array.from(await embeddingTensor.data());
    embeddingTensor.dispose();

    // Validate the embedding
    const validationResult = validateEmbedding(embeddingData);
    if (!validationResult.isValid) {
      throw new Error(validationResult.message || 'Invalid face embedding');
    }

    // Get all registered faces from the contract
    const registeredFaces = await getRegisteredFaces();
    
    // Find the best match by comparing with IPFS embeddings
    let bestMatch = {
      address: '',
      similarity: 0
    };

    for (const face of registeredFaces) {
      try {
        // Get the embedding from IPFS
        const ipfsData = await retrieveFromIPFS(face.ipfsHash);
        const storedEmbedding = ipfsData.embedding;
        
        const similarity = calculateCosineSimilarity(embeddingData, storedEmbedding);
        if (similarity > bestMatch.similarity) {
          bestMatch = {
            address: face.address,
            similarity
          };
        }
      } catch (error) {
        console.error(`Error retrieving embedding for ${face.address}:`, error);
        continue;
      }
    }

    // Check if we found a match above the threshold
    const isFaceRegistered = bestMatch.similarity >= SIMILARITY_THRESHOLD;

    const response = {
      matchingAddress: isFaceRegistered ? bestMatch.address : null,
      similarity: bestMatch.similarity,
      isFaceRegistered
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers }
      }
    );
  } catch (error) {
    console.error('Face verification error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Failed to verify face",
        similarity: 0,
        isFaceRegistered: false,
        matchingAddress: null
      }),
      { 
        status: 500, 
        headers: { "Content-Type": "application/json", ...CORS_HEADERS.headers } 
      }
    );
  }
}

// Utility functions
async function generateHash(embedding: number[]): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(embedding));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have the same dimensions');
  }

  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    mag1 += embedding1[i] * embedding1[i];
    mag2 += embedding2[i] * embedding2[i];
  }

  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);

  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }

  const similarity = dotProduct / (mag1 * mag2);
  return similarity;
}

console.log(`Image saving server listening on localhost:${server.port}`);
