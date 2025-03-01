import axios from "axios";

// List of IPFS gateways to try
const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/"
];

const API_BASE_URL = "https://cdirks4--face-analysis-api-analyze-face.modal.run";
const COMPARE_API_URL = "https://cdirks4--face-analysis-api-v0-1-compare-face-with-ipfs.modal.run";

export class FaceApiService {
  static async analyzeFace(imageBuffer: Buffer | Blob) {
    try {
      const formData = new FormData();
      
      // Handle both Buffer and Blob inputs
      const blob = imageBuffer instanceof Blob 
        ? imageBuffer 
        : new Blob([imageBuffer], { type: "image/jpeg" });
      
      formData.append("file", blob, "image.jpg");

      const response = await axios.post(
        API_BASE_URL,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      console.log("Face analysis response:", response.data);
      return response.data;
    } catch (error) {
      console.error("Face analysis error:", error);
      throw error;
    }
  }

  static async healthCheck() {
    try {
      // Create a minimal 1x1 transparent PNG as a test image
      const minimalImageBlob = createMinimalTestImage();
      
      // Create form data with the test image
      const formData = new FormData();
      formData.append("file", minimalImageBlob, "test.png");
      
      // Create a cancel token
      const source = axios.CancelToken.source();
      
      // Set a timeout to cancel the request after 1 second
      setTimeout(() => {
        source.cancel('Health check completed');
      }, 1000);
      
      // Make a POST request with a timeout
      await axios.post(API_BASE_URL, formData, {
        timeout: 5000,
        headers: {
          "Content-Type": "multipart/form-data",
        },
        cancelToken: source.token
      });
      
      // If we get here, the API is reachable
      return { status: 'ok', message: 'API is reachable' };
    } catch (error) {
      // Check if the error is because we canceled the request (which means it's actually working)
      if (axios.isCancel(error)) {
        return { status: 'ok', message: 'API is reachable' };
      }
      
      console.error("Health check failed:", error);
      throw error;
    }
  }

  /**
   * Compares a face image with a face stored in IPFS using the external API
   * @param imageData The image data as a Blob or Buffer
   * @param ipfsHash The IPFS hash of the stored face embedding
   * @param threshold Optional similarity threshold (default: 0.5)
   * @returns The comparison result with similarity score and match status
   */
  static async compareFaceWithIpfs(
    imageData: Blob | Buffer,
    ipfsHash: string,
    threshold: string = "0.5"
  ) {
    try {
      console.log('Starting face comparison with IPFS hash:', ipfsHash);
      
      // Create form data
      const formData = new FormData();
      
      // Handle both Buffer and Blob inputs
      const blob = imageData instanceof Blob 
        ? imageData 
        : new Blob([imageData], { type: "image/jpeg" });
      
      // Clean the IPFS hash (remove any ipfs:// prefix)
      const cleanIpfsHash = ipfsHash.replace('ipfs://', '');
      
      // Append the image file, IPFS hash, and threshold to the form data
      formData.append("file", blob, "image.jpg");
      formData.append("ipfs_hash", cleanIpfsHash);
      formData.append("threshold", threshold);
      
      // Add a list of fallback gateways to try if the primary one fails
      formData.append("fallback_gateways", JSON.stringify([
        "https://gateway.pinata.cloud/ipfs/",
        "https://ipfs.io/ipfs/",
        "https://cloudflare-ipfs.com/ipfs/",
        "https://dweb.link/ipfs/"
      ]));
      
      // Make the API request
      const response = await axios.post(
        COMPARE_API_URL,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          timeout: 15000, // Increase timeout to 15 seconds to allow for gateway fallbacks
        }
      );
      
      console.log("Face comparison response:", response.data);
      
      // Handle error in the response data
      if (!response.data.success && response.data.error) {
        console.error("API returned error:", response.data.error);
        
        // If it's an IPFS gateway error, try a local comparison as fallback
        if (response.data.error.includes('IPFS') || 
            response.data.error.includes('403') || 
            response.data.error.includes('gateway')) {
          
          console.log("IPFS gateway error detected, trying alternative approach...");
          
          // Try to fetch the IPFS content directly
          try {
            console.log("Attempting to fetch IPFS content directly using multiple gateways...");
            
            // Define the expected structure of the IPFS content
            interface IPFSEmbeddingData {
              embedding: number[];
              timestamp: number;
              version: string;
            }
            
            // Fetch the embedding data from IPFS
            const embeddingData = await FaceApiService.fetchFromIPFS<IPFSEmbeddingData>(cleanIpfsHash);
            
            if (embeddingData && Array.isArray(embeddingData.embedding)) {
              console.log("Successfully retrieved embedding from IPFS directly");
              
              // Convert the blob to an array buffer
              const arrayBuffer = await blob.arrayBuffer();
              // Create a Float32Array from the buffer
              const imageEmbedding = new Float32Array(arrayBuffer);
              
              // If we have a valid embedding from the image, compare them
              if (imageEmbedding.length > 0) {
                // Use our local comparison method
                const similarity = FaceApiService.compareFaceEmbeddings(
                  Array.from(imageEmbedding), 
                  embeddingData.embedding
                );
                
                console.log("Local comparison similarity:", similarity);
                const thresholdValue = parseFloat(threshold);
                
                return {
                  success: true,
                  similarity,
                  isMatch: similarity > thresholdValue,
                  method: "local_fallback"
                };
              }
            }
          } catch (fallbackError) {
            console.error("Fallback IPFS retrieval failed:", fallbackError);
          }
          
          // If the fallback also failed, return the error
          return {
            success: false,
            similarity: 0,
            isMatch: false,
            error: `IPFS access error: ${response.data.error}. The IPFS gateway cannot access this content. Please try again later or use a different gateway.`
          };
        }
        
        throw new Error(response.data.error);
      }
      
      return response.data;
    } catch (error) {
      console.error("Face comparison error:", error);
      
      // Provide a more helpful error message
      let errorMessage = "Failed to compare faces";
      if (axios.isAxiosError(error)) {
        if (error.response) {
          errorMessage += `: Server returned ${error.response.status}`;
          if (error.response.data && typeof error.response.data === 'object' && 'error' in error.response.data) {
            errorMessage += ` - ${error.response.data.error}`;
          }
        } else if (error.request) {
          errorMessage += ": No response received from server. Please check your internet connection.";
        } else {
          errorMessage += `: ${error.message}`;
        }
      } else if (error instanceof Error) {
        errorMessage += `: ${error.message}`;
      }
      
      return {
        success: false,
        similarity: 0,
        isMatch: false,
        error: errorMessage
      };
    }
  }

  // Local implementation for comparing face embeddings
  static compareFaceEmbeddings(
    embedding1: number[],
    embedding2: number[]
  ): number {
    // Ensure arrays are the same length
    if (embedding1.length !== embedding2.length) {
      console.error(`Embedding dimension mismatch: ${embedding1.length} vs ${embedding2.length}`);
      throw new Error('Embeddings must have the same dimensions');
    }
    
    // Calculate dot product
    let dotProduct = 0;
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
    }
    
    // Calculate magnitudes
    let mag1 = 0;
    let mag2 = 0;
    for (let i = 0; i < embedding1.length; i++) {
      mag1 += embedding1[i] * embedding1[i];
      mag2 += embedding2[i] * embedding2[i];
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
    return similarity;
  }

  // Helper method to convert data URL to Blob
  static dataURLtoBlob(dataURL: string): Blob {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new Blob([u8arr], { type: mime });
  }
  
  /**
   * Attempts to fetch content from IPFS using multiple gateways
   * @param ipfsHash The IPFS hash (CID) to retrieve
   * @returns The content as JSON if successful, null if all gateways fail
   */
  static async fetchFromIPFS<T = unknown>(ipfsHash: string): Promise<T | null> {
    // Clean the hash (remove ipfs:// prefix if present)
    const cleanHash = ipfsHash.replace('ipfs://', '');
    
    // Try each gateway in sequence
    for (const gateway of IPFS_GATEWAYS) {
      try {
        console.log(`Trying IPFS gateway: ${gateway}`);
        const url = `${gateway}${cleanHash}`;
        
        const response = await axios.get(url, {
          timeout: 5000, // 5 second timeout per gateway
        });
        
        if (response.status === 200) {
          console.log(`Successfully retrieved content from ${gateway}`);
          return response.data;
        }
      } catch (error) {
        console.warn(`Failed to fetch from gateway ${gateway}:`, error);
        // Continue to the next gateway
      }
    }
    
    // If we get here, all gateways failed
    console.error('All IPFS gateways failed to retrieve content');
    return null;
  }
}

// Helper function to create a minimal test image for health checks
function createMinimalTestImage(): Blob {
  // This is a minimal 1x1 transparent PNG
  const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const byteString = atob(base64Image);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  
  return new Blob([uint8Array], { type: 'image/png' });
} 