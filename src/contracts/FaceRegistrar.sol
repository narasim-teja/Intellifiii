// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IZKVerifier.sol";

contract FaceRegistrar {
    // ZK Verifier contract
    IZKVerifier public zkVerifier;
    
    // Structure to store registration details
    struct Registration {
        address wallet;
        bytes publicKey;
        bytes32 faceHash;
        string ipfsHash;
        uint256 timestamp;
    }
    
    // Mapping from wallet address to their registration details
    mapping(address => Registration) public registrations;
    
    // Array of registrant addresses
    address[] public registrants;
    
    // Events
    event Registered(
        address indexed wallet,
        bytes32 faceHash,
        string ipfsHash,
        bytes publicKey,
        uint256 timestamp
    );
    
    constructor(address _zkVerifier) {
        zkVerifier = IZKVerifier(_zkVerifier);
    }
    
    function register(
        bytes32 _faceHash,
        string memory _ipfsHash,
        bytes memory _publicKey,
        bytes memory _zkProof
    ) public {
        // Verify the ZK proof
        bytes32[] memory publicInputs = new bytes32[](1);
        publicInputs[0] = _faceHash;
        require(
            zkVerifier.verifyProof(_zkProof, publicInputs),
            "Invalid ZK proof"
        );
        
        // Prevent re-registration
        require(registrations[msg.sender].wallet == address(0), "Already registered");
        
        // Create a new registration struct
        Registration memory newRegistration = Registration({
            wallet: msg.sender,
            publicKey: _publicKey,
            faceHash: _faceHash,
            ipfsHash: _ipfsHash,
            timestamp: block.timestamp
        });
        
        // Store registration data
        registrations[msg.sender] = newRegistration;
        registrants.push(msg.sender);
        
        // Emit registration event
        emit Registered(msg.sender, _faceHash, _ipfsHash, _publicKey, block.timestamp);
    }
    
    function getRegistration(address _wallet) external view returns (Registration memory) {
        return registrations[_wallet];
    }
    
    function totalRegistrants() external view returns (uint256) {
        return registrants.length;
    }
    
    function isFaceHashRegistered(bytes32 _faceHash) external view returns (bool) {
        for (uint256 i = 0; i < registrants.length; i++) {
            if (registrations[registrants[i]].faceHash == _faceHash) {
                return true;
            }
        }
        return false;
    }
    
    function updateZkVerifier(address _newVerifier) external {
        // In production, add access control here
        zkVerifier = IZKVerifier(_newVerifier);
    }
}
