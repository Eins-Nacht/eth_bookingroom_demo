// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

contract Counter {
    uint256 public x;

    event Increment(uint256 by);

    function inc() public {
        incBy(1);
    }

    function incBy(uint256 by) public {
        require(by > 0, "Increment must be positive");
        x += by;
        emit Increment(by);
    }
}