/// <reference types="bun-types" />

/* eslint-disable @typescript-eslint/no-unused-vars */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { mkdir } from "fs/promises";
import { ethers } from 'ethers';
import faceAbi from './utils/faceAbi.json';

// IPFS Configuration
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

// Face verification configuration
const SIMILARITY_THRESHOLD = 0.40;

// List of IPFS gateways to try
const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/"
];

// External API endpoints
const COMPARE_API_URL = "https://cdirks4--face-analysis-api-v0-1-compare-face-with-ipfs.modal.run";

// Add constants for image storage
const IMAGE_STORAGE_DIR = join(process.cwd(), "public", "images");

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

// Initialize ethers provider and contract
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS!, faceAbi, provider);

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

// Define a type for the fetch error
interface FetchError extends Error {
  name: string;
}

// Update face verification to use external API with native fetch
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
    const body = await request.json() as { imagePath: string };
    if (!body.imagePath) {
      throw new Error("No image path provided");
    }

    // Read the image file
    const imageBuffer = await readFile(body.imagePath);
    
    // Get all registered faces from the contract
    const registeredFaces = await getRegisteredFaces();
    
    // Find the best match by comparing with IPFS embeddings using the external API
    let bestMatch = {
      address: '',
      similarity: 0
    };

    for (const face of registeredFaces) {
      try {
        // Skip if no IPFS hash
        if (!face.ipfsHash) {
          console.warn(`No IPFS hash for address: ${face.address}`);
          continue;
        }
        
        // Create form data for the API request using Bun's native FormData
        const formData = new FormData();
        const blob = new Blob([imageBuffer], { type: "image/jpeg" });
        formData.append("file", blob, "image.jpg");
        formData.append("ipfs_hash", face.ipfsHash);
        formData.append("threshold", SIMILARITY_THRESHOLD.toString());
        
        // Add fallback gateways
        formData.append("fallback_gateways", JSON.stringify(IPFS_GATEWAYS));
        
        // Use Bun's native fetch instead of axios
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        try {
          // Make the API request with fetch
          const response = await fetch(COMPARE_API_URL, {
            method: "POST",
            body: formData,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`API responded with status: ${response.status}`);
          }
          
          const data = await response.json() as { similarity?: number, success?: boolean, error?: string };
          
          // Get the similarity score from the response
          const similarity = data.similarity || 0;
          
          console.log(`Similarity with ${face.address}: ${similarity}`);
          
          if (similarity > bestMatch.similarity) {
            bestMatch = {
              address: face.address,
              similarity
            };
          }
        } catch (fetchError) {
          const error = fetchError as FetchError;
          if (error.name === 'AbortError') {
            console.error(`Request for ${face.address} timed out`);
          } else {
            console.error(`Error comparing face with ${face.address}:`, error);
          }
          continue;
        }
      } catch (error) {
        console.error(`Error processing face for ${face.address}:`, error);
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

console.log(`Image saving server listening on localhost:${server.port}`);