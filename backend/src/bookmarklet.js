javascript: (function (s) {
    function findMessagesContainer() {
      // Try different selectors that might match the messages container
      const selectors = [
        // Original selector
        "x78zum5 xdt5ytf x1iyjqo2 xs83m0k x1xzczws x6ikm8r x1rife3k x1n2onr6 xh8yej3",
        // Common parent elements in Messenger
        "x1cy8zhl x78zum5 x1q0g3np",
        "x78zum5"
      ];
  
      for (const selector of selectors) {
        const elements = document.getElementsByClassName(selector);
        for (let i = 0; i < elements.length; i++) {
          // Check if this element contains message content
          if (elements[i].querySelector('img')) {
            return elements[i];
          }
        }
      }
      return null;
    }
  
    async function convertToDownloadableUrl(imgElement) {
      const src = imgElement.src;
      
      // If it's already an https URL, return as is
      if (src.startsWith('https://')) {
        return src;
      }
  
      // If it's a blob URL
      if (src.startsWith('blob:')) {
        try {
          const response = await fetch(src);
          const blob = await response.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          console.error('Error converting blob URL:', error);
          return null;
        }
      }
  
      // If it's a data URL, return as is
      if (src.startsWith('data:')) {
        return src;
      }
  
      return null;
    }
  
    // Function to release payment to a wallet address
    async function releasePayment(walletAddress) {
      try {
        console.log(`Automatically requesting payment release for address: ${walletAddress}`);
        
        // Call the server to release payment
        const releaseRes = await fetch("http://localhost:3103/api/release-payment", {
          method: "POST",
          body: JSON.stringify({ 
            walletAddress: walletAddress 
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });
        
        const releaseData = await releaseRes.json();
        console.log("Payment release result:", releaseData);
        
        return releaseData;
      } catch (error) {
        console.error("Error releasing payment:", error);
        return { success: false, error: error.message };
      }
    }
  
    // Add function to display verification results
    function displayVerificationResult(result, imgElement) {
      const resultDiv = document.createElement('div');
      resultDiv.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px;
        font-size: 12px;
        border-radius: 0 0 4px 4px;
        z-index: 1000;
      `;

      if (result.isFaceRegistered && result.matchingAddress) {
        // Automatically attempt to release payment
        (async () => {
          resultDiv.innerHTML = `
            <div style="color: #4ade80;">✓ Face Matched!</div>
            <div style="font-size: 10px;">Address: ${result.matchingAddress}</div>
            <div style="font-size: 10px;">Similarity: ${(result.similarity * 100).toFixed(2)}%</div>
            <div style="font-size: 10px; color: #f59e0b;">Releasing payment...</div>
          `;

          // Position the result div relative to the image
          const imgContainer = imgElement.parentElement;
          imgContainer.style.position = 'relative';
          imgContainer.appendChild(resultDiv);

          // Call the payment release function
          const releaseResult = await releasePayment(result.matchingAddress);
          
          if (releaseResult.success) {
            resultDiv.innerHTML = `
              <div style="color: #4ade80;">✓ Face Matched!</div>
              <div style="font-size: 10px;">Address: ${result.matchingAddress}</div>
              <div style="font-size: 10px;">Similarity: ${(result.similarity * 100).toFixed(2)}%</div>
              <div style="font-size: 10px; color: #4ade80;">✓ Payment Released!</div>
              <div style="font-size: 8px;">Tx: ${releaseResult.transactionHash?.substring(0, 10)}...</div>
            `;
          } else {
            resultDiv.innerHTML = `
              <div style="color: #4ade80;">✓ Face Matched!</div>
              <div style="font-size: 10px;">Address: ${result.matchingAddress}</div>
              <div style="font-size: 10px;">Similarity: ${(result.similarity * 100).toFixed(2)}%</div>
              <div style="font-size: 10px; color: #f87171;">✗ Payment Failed: ${releaseResult.error?.substring(0, 30) || 'Unknown error'}...</div>
            `;
          }
        })();
      } else {
        resultDiv.innerHTML = `
          <div style="color: #f87171;">✗ No Match Found</div>
          <div style="font-size: 10px;">Best Similarity: ${(result.similarity * 100).toFixed(2)}%</div>
        `;
        
        // Position the result div relative to the image
        const imgContainer = imgElement.parentElement;
        imgContainer.style.position = 'relative';
        imgContainer.appendChild(resultDiv);
      }

      // Remove the result after 15 seconds
      setTimeout(() => {
        resultDiv.remove();
      }, 15000);
    }
  
    function initializeObserver() {
      const container = findMessagesContainer();
      if (!container) {
        console.log("Messages container not found, retrying in 1 second...");
        setTimeout(initializeObserver, 1000);
        return;
      }
  
      console.log("Found messages container, setting up observer...");
  
      // Remove any existing observers
      if (window._messageObserver) {
        window._messageObserver.disconnect();
      }
  
      // Create a new mutation observer to watch for new messages
      window._messageObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.addedNodes && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(async (node) => {
              if (node.nodeType === 1) { // ELEMENT_NODE
                const images = node.getElementsByTagName('img');
                for (let img of images) {
                  if (img.src && !img.dataset.processed) {
                    img.dataset.processed = 'true';
                    try {
                      const downloadableUrl = await convertToDownloadableUrl(img);
                      if (!downloadableUrl) {
                        console.error('Could not convert image URL:', img.src);
                        continue;
                      }
  
                      // First save the image
                      const saveRes = await fetch("http://localhost:3103/api/vision", {
                        method: "POST",
                        body: JSON.stringify({ imageUrl: downloadableUrl }),
                        headers: {
                          "Content-Type": "application/json",
                        },
                      });
                      const saveData = await saveRes.json();
                      console.log("Image saved locally at:", saveData.savedImagePath);

                      // Then verify the face
                      const verifyRes = await fetch("http://localhost:3103/api/verify-face", {
                        method: "POST",
                        body: JSON.stringify({ imagePath: saveData.savedImagePath }),
                        headers: {
                          "Content-Type": "application/json",
                        },
                      });
                      const verifyData = await verifyRes.json();
                      console.log("Face verification result:", verifyData);

                      // Display the verification result
                      displayVerificationResult(verifyData, img);
                    } catch (error) {
                      console.error("Error processing image:", error);
                    }
                  }
                }
              }
            });
          }
        });
      });
  
      // Start observing the container with the configured parameters
      window._messageObserver.observe(container, {
        childList: true,
        subtree: true
      });
  
      alert("Successfully added Messenger Chat Observer with Automatic Face Verification & Payment!");
    }
  
    // Start the initialization process
    initializeObserver();
  })();
  