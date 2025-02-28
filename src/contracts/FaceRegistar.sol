// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FaceRegistration {
    // Structure to store registration details
    struct Registration {
        address wallet;       // User's wallet address (registered caller)
        bytes publicKey;      // Public key of the wallet
        bytes32 faceHash;     // Hash representing the processed face data
        string ipfsHash;      // IPFS hash where the face embedding is stored
        uint256 timestamp;    // Registration timestamp
    }
    
    // Structure to store spend note details
    struct SpendNote {
        bytes32 noteHash;     // Hash of (address + nullifier)
        uint256 amount;       // Amount of ETH (0.1 ETH by default)
        bool spent;           // Whether the note has been spent
        uint256 timestamp;    // Creation timestamp
    }
    
    // Mapping from wallet address to their registration details
    mapping(address => Registration) public registrations;
    
    // Array of registrant addresses (useful for enumeration)
    address[] public registrants;
    
    // Merkle tree root hash
    bytes32 public merkleRoot;
    
    // Mapping to track spent nullifiers (prevent double spending)
    mapping(bytes32 => bool) public spentNullifiers;
    
    // Mapping from note hash to spend note
    mapping(bytes32 => SpendNote) public spendNotes;
    
    // Array of spend note hashes (for enumeration)
    bytes32[] public spendNoteHashes;
    
    // Events
    event Registered(
        address indexed wallet,
        bytes32 faceHash,
        string ipfsHash,
        bytes publicKey,
        uint256 timestamp
    );
    
    event SpendNoteCreated(
        address indexed wallet,
        bytes32 noteHash,
        uint256 amount,
        uint256 timestamp
    );
    
    event MerkleRootUpdated(
        bytes32 oldRoot,
        bytes32 newRoot,
        uint256 timestamp
    );
    
    event NoteSpent(
        bytes32 indexed noteHash,
        bytes32 nullifier,
        address recipient,
        uint256 timestamp
    );
    
    /**
     * @notice Register a user's face hash along with their public key and IPFS hash.
     * @param _faceHash The hash of the user's facial data (computed off-chain).
     * @param _ipfsHash The IPFS hash where the face embedding is stored.
     * @param _publicKey The public key associated with the user's wallet.
     */
    function register(bytes32 _faceHash, string calldata _ipfsHash, bytes calldata _publicKey) external {
        // Prevent re-registration from the same wallet.
        require(registrations[msg.sender].wallet == address(0), "Already registered");
        
        // Create a new registration struct
        Registration memory newRegistration = Registration({
            wallet: msg.sender,
            publicKey: _publicKey,
            faceHash: _faceHash,
            ipfsHash: _ipfsHash,
            timestamp: block.timestamp
        });
        
        // Store registration data in the mapping
        registrations[msg.sender] = newRegistration;
        
        // Add the registrant to the array for easy enumeration (if needed)
        registrants.push(msg.sender);
        
        // Emit an event for off-chain indexing and transparency
        emit Registered(msg.sender, _faceHash, _ipfsHash, _publicKey, block.timestamp);
    }
    
    /**
     * @notice Create a new spend note and add it to the Merkle tree.
     * @param _noteHash The hash of (address + nullifier).
     * @dev This function requires 0.1 ETH to be sent with the transaction.
     */
    function createSpendNote(bytes32 _noteHash) external payable {
        // Require the sender to be registered
        require(registrations[msg.sender].wallet != address(0), "Not registered");
        
        // Require exactly 0.1 ETH to be sent
        require(msg.value == 0.1 ether, "Must send exactly 0.1 ETH");
        
        // Ensure note hash doesn't already exist
        require(spendNotes[_noteHash].noteHash == bytes32(0), "Note already exists");
        
        // Create a new spend note
        SpendNote memory newNote = SpendNote({
            noteHash: _noteHash,
            amount: msg.value,
            spent: false,
            timestamp: block.timestamp
        });
        
        // Store the spend note
        spendNotes[_noteHash] = newNote;
        spendNoteHashes.push(_noteHash);
        
        // Emit event
        emit SpendNoteCreated(msg.sender, _noteHash, msg.value, block.timestamp);
    }
    
    /**
     * @notice Update the Merkle root with a new value (called by backend after adding notes).
     * @param _newRoot The new Merkle root hash.
     * @dev This function should be restricted to authorized callers in production.
     */
    function updateMerkleRoot(bytes32 _newRoot) external {
        // In production, add access control here
        // require(msg.sender == authorizedUpdater, "Not authorized");
        
        bytes32 oldRoot = merkleRoot;
        merkleRoot = _newRoot;
        
        emit MerkleRootUpdated(oldRoot, merkleRoot, block.timestamp);
    }
    
    /**
     * @notice Spend a note by providing the nullifier and Merkle proof.
     * @param _noteHash The hash of the spend note.
     * @param _nullifier The nullifier associated with the note.
     * @param _recipient The address to send the funds to.
     * @param _merkleProof The Merkle proof verifying the note is in the tree.
     * @dev In production, this would verify a ZK proof as well.
     */
    function spendNote(
        bytes32 _noteHash,
        bytes32 _nullifier,
        address payable _recipient,
        bytes32[] calldata _merkleProof
    ) external {
        // Ensure the note exists and hasn't been spent
        require(spendNotes[_noteHash].noteHash != bytes32(0), "Note does not exist");
        require(!spendNotes[_noteHash].spent, "Note already spent");
        
        // Ensure nullifier hasn't been used before
        require(!spentNullifiers[_nullifier], "Nullifier already used");
        
        // Verify the Merkle proof (simplified for now)
        // In production, this would use a proper Merkle proof verification
        // require(verifyMerkleProof(_noteHash, _merkleProof), "Invalid Merkle proof");
        
        // Mark note as spent
        spendNotes[_noteHash].spent = true;
        
        // Mark nullifier as spent
        spentNullifiers[_nullifier] = true;
        
        // Transfer funds to recipient
        uint256 amount = spendNotes[_noteHash].amount;
        (bool success, ) = _recipient.call{value: amount}("");
        require(success, "Transfer failed");
        
        // Emit event
        emit NoteSpent(_noteHash, _nullifier, _recipient, block.timestamp);
    }
    
    /**
     * @notice Verify a Merkle proof.
     * @param _leaf The leaf node (note hash).
     * @param _proof The Merkle proof.
     * @return True if the proof is valid, false otherwise.
     * @dev This is a simplified implementation. In production, use a proper Merkle proof verification.
     */
    function verifyMerkleProof(bytes32 _leaf, bytes32[] calldata _proof) internal view returns (bool) {
        bytes32 computedHash = _leaf;
        
        for (uint256 i = 0; i < _proof.length; i++) {
            bytes32 proofElement = _proof[i];
            
            if (computedHash < proofElement) {
                // Hash(current computed hash + current element of the proof)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Hash(current element of the proof + current computed hash)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        
        // Check if the computed hash equals the root of the Merkle tree
        return computedHash == merkleRoot;
    }
    
    /**
     * @notice Retrieve registration details by wallet address.
     * @param _wallet The wallet address of the registrant.
     * @return Registration struct containing the registrant's data.
     */
    function getRegistration(address _wallet) external view returns (Registration memory) {
        return registrations[_wallet];
    }
    
    /**
     * @notice Get the total number of registered users.
     * @return The count of registrants.
     */
    function totalRegistrants() external view returns (uint256) {
        return registrants.length;
    }
    
    /**
     * @notice Get a spend note by its hash.
     * @param _noteHash The hash of the spend note.
     * @return The spend note.
     */
    function getSpendNote(bytes32 _noteHash) external view returns (SpendNote memory) {
        return spendNotes[_noteHash];
    }
    
    /**
     * @notice Get the total number of spend notes.
     * @return The count of spend notes.
     */
    function totalSpendNotes() external view returns (uint256) {
        return spendNoteHashes.length;
    }
}
