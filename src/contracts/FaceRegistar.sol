// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FaceRegistration {
    // Owner of the contract
    address public owner;

    constructor() {
        owner = msg.sender;
    }
    
    // Modifier to restrict functions to the owner only
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    // Structure to store registration details
    struct Registration {
        address wallet;       // User's wallet address (msg.sender)
        bytes publicKey;      // Public key of the wallet
        bytes32 faceHash;     // Hash representing the processed face data
        string ipfsHash;      // IPFS hash pointing to additional registration data
        uint256 timestamp;    // Registration timestamp
    }
    
    // Mapping from wallet address to registration details
    mapping(address => Registration) public registrations;
    
    // Array of registrant addresses (for enumeration if needed)
    address[] public registrants;
    
    // Separate mapping to track if payment has been sent
    mapping(address => bool) public paymentSent;
    
    // Events for transparency
    event Registered(
        address indexed wallet,
        bytes32 faceHash,
        bytes publicKey,
        string ipfsHash,
        uint256 timestamp
    );
    event PaymentSent(address indexed wallet, uint256 amount);
    
    /**
     * @notice Register a user's face hash along with their public key and IPFS hash.
     * @param _faceHash The hash of the user's facial data (computed off-chain).
     * @param _publicKey The public key associated with the user's wallet.
     * @param _ipfsHash The IPFS hash containing additional registration data.
     */
    function register(
        bytes32 _faceHash,
        bytes calldata _publicKey,
        string calldata _ipfsHash
    ) external {
        require(registrations[msg.sender].wallet == address(0), "Already registered");
        
        Registration memory newRegistration = Registration({
            wallet: msg.sender,
            publicKey: _publicKey,
            faceHash: _faceHash,
            ipfsHash: _ipfsHash,
            timestamp: block.timestamp
        });
        
        registrations[msg.sender] = newRegistration;
        registrants.push(msg.sender);
        
        emit Registered(msg.sender, _faceHash, _publicKey, _ipfsHash, block.timestamp);
    }
    
    /**
     * @notice Allows the owner to release a payment of 0.01 ETH to a registered wallet.
     * @param _wallet The wallet address of the registrant to receive the payment.
     */
    function releasePayment(address _wallet) external onlyOwner {
        require(registrations[_wallet].wallet != address(0), "Not registered");
        require(!paymentSent[_wallet], "Payment already sent");
        
        uint256 payment = 0.01 ether;
        require(address(this).balance >= payment, "Insufficient contract balance");
        
        // Mark payment as sent to prevent reentrancy
        paymentSent[_wallet] = true;
        payable(_wallet).transfer(payment);
        
        emit PaymentSent(_wallet, payment);
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
     * @notice Deposit ETH into the contract so that funds are available for payments.
     */
    function deposit() external payable {}
    
    // Fallback function to accept ETH directly
    receive() external payable {}
}
