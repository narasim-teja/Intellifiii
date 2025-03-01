import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import path from 'path';

export enum ZkProofError {
  INITIALIZATION_FAILED = "INITIALIZATION_FAILED",
  PROOF_GENERATION_FAILED = "PROOF_GENERATION_FAILED",
  VERIFICATION_FAILED = "VERIFICATION_FAILED",
}

export interface ZkProofResult {
  proof: string;
  success: boolean;
  error?: string;
  errorType?: ZkProofError;
}

export class ZkProofService {
  private static zkConfigProvider: NodeZkConfigProvider | null = null;
  private static proofProvider: ReturnType<typeof httpClientProofProvider> | null = null;

  static async initialize(): Promise<void> {
    try {
      if (!this.zkConfigProvider) {
        this.zkConfigProvider = new NodeZkConfigProvider({
          // Configure for Compact language
          compactCircuitPath: path.resolve(
            process.cwd(), 
            'src/circuits/face_verification.compact'
          ),
          // Specify the output directory for compiled circuits
          outputDir: path.resolve(
            process.cwd(), 
            'src/circuits/compiled'
          )
        });
        await this.zkConfigProvider.initialize();
      }

      if (!this.proofProvider) {
        this.proofProvider = httpClientProofProvider({
          baseUrl: import.meta.env.VITE_ZK_PROOF_SERVER_URL || "http://localhost:6300",
          timeout: 60000, // 60 seconds timeout for proof generation
        });
      }
    } catch (error) {
      console.error("Failed to initialize ZK providers:", error);
      throw new Error("ZK proof system initialization failed");
    }
  }

  static async generateProof(
    faceHash: string,
    ipfsHash: string
  ): Promise<ZkProofResult> {
    try {
      if (!faceHash || !ipfsHash) {
        throw new Error("Face hash and IPFS hash are required");
      }

      await this.initialize();

      if (!this.zkConfigProvider || !this.proofProvider) {
        throw new Error("ZK providers not initialized");
      }

      const provingKey = await this.zkConfigProvider.getProvingKey();
      const verificationKey = await this.zkConfigProvider.getVerificationKey();

      // Convert inputs to bytes32 format for the smart contract
      const faceHashBytes32 = this.stringToBytes32(faceHash);
      
      // Clean IPFS hash (remove ipfs:// prefix if present)
      const cleanIpfsHash = ipfsHash.replace('ipfs://', '');

      const proofInput = {
        provingKey,
        publicInputs: [faceHashBytes32],
        privateInputs: [cleanIpfsHash],
      };

      console.log("Generating ZK proof with inputs:", {
        publicInputs: [faceHashBytes32.substring(0, 10) + "..."],
        privateInputsCount: proofInput.privateInputs.length,
      });

      const proof = await this.proofProvider.generateProof(proofInput);

      const verificationResult = await this.proofProvider.verifyProof({
        proof,
        verificationKey,
        publicInputs: [faceHashBytes32], // Include public inputs for verification
      });

      if (!verificationResult) {
        return {
          proof,
          success: false,
          error: "ZK proof verification failed",
          errorType: ZkProofError.VERIFICATION_FAILED,
        };
      }

      return {
        proof,
        success: true,
      };
    } catch (error) {
      console.error("Error generating ZK proof:", error);
      return {
        proof: "",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error generating ZK proof",
        errorType: ZkProofError.PROOF_GENERATION_FAILED,
      };
    }
  }

  static async verifyProof(proof: string, faceHash?: string): Promise<boolean> {
    try {
      await this.initialize();

      if (!this.zkConfigProvider || !this.proofProvider) {
        throw new Error("ZK providers not initialized");
      }

      const verificationKey = await this.zkConfigProvider.getVerificationKey();
      
      const verifyParams: any = {
        proof,
        verificationKey,
      };
      
      // If faceHash is provided, include it as public input
      if (faceHash) {
        verifyParams.publicInputs = [this.stringToBytes32(faceHash)];
      }

      return await this.proofProvider.verifyProof(verifyParams);
    } catch (error) {
      console.error("Error verifying ZK proof:", error);
      return false;
    }
  }

  private static stringToBytes32(str: string): string {
    // Remove '0x' if present
    str = str.startsWith('0x') ? str.slice(2) : str;
    
    // Pad or truncate to 32 bytes (64 characters)
    if (str.length < 64) {
      str = str.padEnd(64, '0');
    } else if (str.length > 64) {
      str = str.slice(0, 64);
    }
    
    return '0x' + str;
  }
}
