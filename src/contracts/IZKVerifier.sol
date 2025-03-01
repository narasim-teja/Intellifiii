// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IZKVerifier {
    function verifyProof(
        bytes memory proof,
        bytes32[] memory publicInputs
    ) external view returns (bool);
}