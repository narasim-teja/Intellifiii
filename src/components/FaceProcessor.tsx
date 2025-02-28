import React, { useState, useCallback, useRef } from 'react';
import Webcam from 'react-webcam';
import { useFaceProcessing } from '../hooks/useFaceProcessing';
import { uploadToIPFS } from '../utils/ipfsUtils';
import { CheckCircleIcon, ExclamationTriangleIcon, CameraIcon } from '@heroicons/react/24/outline';

interface FaceProcessorProps {
  onHashGenerated?: (hash: string, embedding?: Float32Array) => void;
  onIpfsHashGenerated?: (ipfsHash: string) => void;
  hasWallet?: boolean;
}

export const FaceProcessor: React.FC<FaceProcessorProps> = ({ 
  onHashGenerated,
  onIpfsHashGenerated,
  hasWallet = false
}) => {
  const webcamRef = useRef<Webcam>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [ipfsHash, setIpfsHash] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{title: string, message: string, type: 'success' | 'error' | 'warning'} | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isCameraTesting, setIsCameraTesting] = useState(false);
  const [cameraTestResult, setCameraTestResult] = useState<'success' | 'warning' | 'error' | null>(null);
  const [cameraTestMessage, setCameraTestMessage] = useState<string | null>(null);

  const { 
    modelLoading, 
    isProcessing, 
    hash, 
    error, 
    isFaceRegistered,
    similarity,
    faceEmbedding,
    processImage,
    resetFaceProcessing
  } = useFaceProcessing();

  // Turn camera on
  const turnOnCamera = useCallback(() => {
    setIsCameraOn(true);
  }, []);

  // Show toast notification
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const showToast = (title: string, message: string, type: 'success' | 'error' | 'warning') => {
    setToastMessage({ title, message, type });
    // Auto-hide toast after 3 seconds
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Check image quality and face presence
  const checkImageQuality = useCallback(async (imageData: string): Promise<{hasIssues: boolean, message: string}> => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        // Create a canvas to analyze the image
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve({hasIssues: true, message: "Could not analyze image"});
          return;
        }
        
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Calculate average brightness
        let totalBrightness = 0;
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          totalBrightness += brightness;
        }
        
        const avgBrightness = totalBrightness / (data.length / 4);
        console.log('Average image brightness:', avgBrightness);
        
        // Check if the image is too dark or too bright
        if (avgBrightness < 40) {
          resolve({
            hasIssues: true, 
            message: "The image is too dark. Please improve lighting conditions."
          });
          return;
        } 
        
        if (avgBrightness > 220) {
          resolve({
            hasIssues: true, 
            message: "The image is too bright. Please reduce direct light on your face."
          });
          return;
        }
        
        // Check for image variance (to detect if camera is covered or showing a static image)
        let pixelVariance = 0;
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          pixelVariance += Math.pow(brightness - avgBrightness, 2);
        }
        
        pixelVariance = Math.sqrt(pixelVariance / (data.length / 4));
        console.log('Image pixel variance:', pixelVariance);
        
        if (pixelVariance < 10) {
          resolve({
            hasIssues: true, 
            message: "Low image variance detected. Camera may be covered or showing a static image."
          });
          return;
        }
        
        // Basic check for face presence - look for skin tone pixels
        let skinTonePixels = 0;
        const totalPixels = data.length / 4;
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Simple skin tone detection heuristic
          if (r > 60 && g > 40 && b > 20 && r > g && g > b && 
              r - g > 15 && g - b > 15 && r < 250 && g < 250) {
            skinTonePixels++;
          }
        }
        
        const skinTonePercentage = (skinTonePixels / totalPixels) * 100;
        console.log('Skin tone pixel percentage:', skinTonePercentage);
        
        if (skinTonePercentage < 5) {
          resolve({
            hasIssues: true, 
            message: "No face detected in the image. Please ensure your face is clearly visible."
          });
          return;
        }
        
        resolve({hasIssues: false, message: ""});
      };
      
      img.onerror = () => {
        resolve({hasIssues: true, message: "Failed to load image for analysis"});
      };
      
      img.src = imageData;
    });
  }, []);

  // Capture image from webcam
  const captureImage = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        setCapturedImage(imageSrc);
        
        // Check if the image has a face before processing
        checkImageQuality(imageSrc).then(qualityCheck => {
          if (qualityCheck.hasIssues) {
            showToast(
              "Image quality issue", 
              qualityCheck.message || "Please ensure good lighting and face visibility", 
              "warning"
            );
            // Still process the image, but warn the user
          }
          processImage(imageSrc);
        });
      }
    }
  }, [processImage, checkImageQuality]);

  // Upload face embedding to IPFS and check for similar faces
  const registerOnline = async () => {
    if (!faceEmbedding) {
      showToast("No face embedding available", "Please capture your face first", "error");
      return null;
    }

    // If already uploaded to IPFS, don't upload again
    if (ipfsHash) {
      showToast("Already uploaded", "Face embedding already uploaded to IPFS", "warning");
      return ipfsHash;
    }

    try {
      setIsUploading(true);
      // Convert Float32Array to regular array for JSON serialization
      const embeddingArray = Array.from(faceEmbedding);
      
      // Upload to IPFS
      const newIpfsHash = await uploadToIPFS({
        embedding: embeddingArray,
        timestamp: Date.now(),
        version: "1.0"
      });
      
      setIpfsHash(newIpfsHash);
      
      // Call the callback with the IPFS hash
      if (onIpfsHashGenerated) {
        onIpfsHashGenerated(newIpfsHash);
      }
      
      // Call the callback with hash and embedding if we have a face hash
      if (onHashGenerated && hash) {
        onHashGenerated(hash, faceEmbedding);
      }
      
      showToast("Face embedding uploaded to IPFS", `Ready to register on blockchain`, "success");
      
      return newIpfsHash;
    } catch (err) {
      console.error("Error uploading to IPFS:", err);
      showToast("Failed to upload to IPFS", "Please try again later", "error");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Reset the captured image and start over
  const resetCapture = () => {
    setCapturedImage(null);
    setIpfsHash(null);
    resetFaceProcessing();
  };

  // Turn off camera and reset
  const turnOffCamera = () => {
    setIsCameraOn(false);
    setCapturedImage(null);
    setIpfsHash(null);
    resetFaceProcessing();
  };

  // Test camera to check if it's working properly
  const testCamera = useCallback(async () => {
    if (!webcamRef.current) {
      showToast("Camera not available", "Please turn on the camera first", "error");
      return;
    }

    try {
      setIsCameraTesting(true);
      setCameraTestResult(null);
      setCameraTestMessage(null);

      // Capture a test image
      const testImage = webcamRef.current.getScreenshot();
      if (!testImage) {
        setCameraTestResult('error');
        setCameraTestMessage('Failed to capture test image from camera');
        return;
      }

      // Create an image element to analyze the captured image
      const img = new Image();
      img.src = testImage;
      
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
      });

      // Check image brightness
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        setCameraTestResult('error');
        setCameraTestMessage('Failed to analyze image');
        return;
      }
      
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Calculate average brightness
      let totalBrightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Convert RGB to brightness (0-255)
        const brightness = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        totalBrightness += brightness;
      }
      
      const avgBrightness = totalBrightness / (data.length / 4);
      console.log('Average image brightness:', avgBrightness);
      
      // Check if the image is too dark or too bright
      if (avgBrightness < 40) {
        setCameraTestResult('warning');
        setCameraTestMessage('The image is too dark. Please improve lighting conditions.');
      } else if (avgBrightness > 220) {
        setCameraTestResult('warning');
        setCameraTestMessage('The image is too bright. Please reduce direct light on your face.');
      } else {
        setCameraTestResult('success');
        setCameraTestMessage('Camera is working properly with good lighting conditions.');
      }
      
      // Also check for image variance (to detect if camera is covered or showing a static image)
      let pixelVariance = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        pixelVariance += Math.pow(brightness - avgBrightness, 2);
      }
      
      pixelVariance = Math.sqrt(pixelVariance / (data.length / 4));
      console.log('Image pixel variance:', pixelVariance);
      
      if (pixelVariance < 10) {
        setCameraTestResult('warning');
        setCameraTestMessage('Low image variance detected. Camera may be covered or showing a static image.');
      }
      
    } catch (err) {
      console.error('Error testing camera:', err);
      setCameraTestResult('error');
      setCameraTestMessage('Failed to test camera: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsCameraTesting(false);
    }
  }, [webcamRef, showToast]);

  // Render the component
  return (
    <div className="border border-gray-700 rounded-lg p-4 w-full max-w-[500px] mx-auto bg-gray-800/80 backdrop-blur-sm shadow-lg">
      <h3 className="text-xl font-bold mb-4 text-center text-white">
        Face Authentication
      </h3>
      
      {/* Camera or captured image */}
      <div className="relative w-full h-auto mb-4">
        {!isCameraOn ? (
          <div className="flex flex-col items-center justify-center bg-gray-900 rounded-lg p-8 h-[320px]">
            <CameraIcon className="h-16 w-16 text-gray-300 mb-4" />
            <p className="text-gray-300 mb-4 text-center">Camera is currently off</p>
            {hasWallet ? (
              <button 
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md"
                onClick={turnOnCamera}
              >
                Turn On Camera
              </button>
            ) : (
              <p className="text-amber-400 text-sm text-center">
                Please connect your wallet first
              </p>
            )}
          </div>
        ) : !capturedImage ? (
          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{
                facingMode: "user",
                width: 480,
                height: 480
              }}
              className="w-full rounded-lg"
            />
          </div>
        ) : (
          <img 
            src={capturedImage} 
            alt="Captured face" 
            className="w-full rounded-lg"
          />
        )}
        
        {/* Loading overlay */}
        {isCameraOn && (modelLoading || isProcessing || isUploading) && (
          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg flex justify-center items-center flex-col">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mb-2"></div>
            <p className="text-white font-bold">
              {modelLoading ? 'Loading model...' : isUploading ? 'Uploading to IPFS...' : 'Processing...'}
            </p>
          </div>
        )}
      </div>
      
      {/* Status and error messages */}
      {error && (
        <div className="mb-4 p-2 bg-red-900/50 rounded-md">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-2" />
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}
      
      {hash && isFaceRegistered && similarity !== undefined && (
        <div className="mb-4 p-2 bg-green-900/50 rounded-md">
          <div className="flex items-center">
            <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2" />
            <p className="text-green-400">
              Face recognized! Similarity: {similarity.toFixed(2)}
            </p>
          </div>
        </div>
      )}
      
      {hash && !isFaceRegistered && similarity !== undefined && (
        <div className="mb-4 p-2 bg-amber-900/50 rounded-md">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-400 mr-2" />
            <p className="text-amber-400">
              Face not recognized. Similarity: {similarity.toFixed(2)}
            </p>
          </div>
        </div>
      )}
      
      {ipfsHash && (
        <div className="mb-4 p-2 bg-gray-900/70 rounded-md border border-gray-700">
          <p className="font-semibold text-gray-300">IPFS Hash:</p>
          <p className="text-sm break-all text-indigo-300">{ipfsHash}</p>
        </div>
      )}
      
      {/* Camera test result */}
      {cameraTestResult && (
        <div className={`mb-4 p-2 rounded-md ${
          cameraTestResult === 'success' ? 'bg-green-900/50' : 
          cameraTestResult === 'warning' ? 'bg-amber-900/50' : 'bg-red-900/50'
        }`}>
          <div className="flex items-center">
            {cameraTestResult === 'success' ? (
              <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2" />
            ) : (
              <ExclamationTriangleIcon className={`h-5 w-5 ${
                cameraTestResult === 'warning' ? 'text-amber-400' : 'text-red-400'
              } mr-2`} />
            )}
            <p className={
              cameraTestResult === 'success' ? 'text-green-400' : 
              cameraTestResult === 'warning' ? 'text-amber-400' : 'text-red-400'
            }>
              {cameraTestMessage}
            </p>
          </div>
        </div>
      )}
      
      {/* Toast notification */}
      {toastMessage && (
        <div className={`fixed top-4 right-4 p-4 rounded-md shadow-lg max-w-sm z-50 ${
          toastMessage.type === 'success' ? 'bg-green-900/90 text-green-300' : 
          toastMessage.type === 'error' ? 'bg-red-900/90 text-red-300' : 
          'bg-amber-900/90 text-amber-300'
        } backdrop-blur-sm`}>
          <div className="flex items-center">
            {toastMessage.type === 'success' ? (
              <CheckCircleIcon className="h-5 w-5 mr-2" />
            ) : (
              <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
            )}
            <div>
              <p className="font-bold">{toastMessage.title}</p>
              <p className="text-sm">{toastMessage.message}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Action buttons */}
      <div className="flex justify-between flex-wrap gap-2">
        {!isCameraOn ? (
          hasWallet && (
            <button 
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md w-full"
              onClick={turnOnCamera}
            >
              Turn On Camera
            </button>
          )
        ) : !capturedImage ? (
          <>
            <button 
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md flex-1"
              onClick={turnOffCamera}
            >
              Turn Off Camera
            </button>
            <button 
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium py-2 px-4 rounded-md flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={captureImage} 
              disabled={modelLoading}
            >
              Capture Face
            </button>
            <button 
              className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-md flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={testCamera}
              disabled={isCameraTesting || modelLoading}
            >
              {isCameraTesting ? 'Testing...' : 'Test Camera'}
            </button>
          </>
        ) : (
          <>
            <button 
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md flex-1 min-w-[120px]"
              onClick={resetCapture}
            >
              Retake
            </button>
            
            {hasWallet && hash && !ipfsHash && (
              <button 
                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium py-2 px-4 rounded-md flex-1 min-w-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={registerOnline}
                disabled={isUploading || !faceEmbedding}
              >
                {isUploading ? 'Uploading...' : 'Register Online'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}; 