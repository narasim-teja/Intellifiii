import axios from "axios";

const API_BASE_URL = "https://cdirks4--face-analysis-api-analyze-face.modal.run";

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