// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LiveVote} from "../src/LiveVote.sol";

/// Deploys a demo poll. Recipients are our own test wallets (RECIPIENT_0..2 in .env).
contract Deploy is Script {
    function run() external returns (LiveVote poll) {
        string[] memory labels = new string[](3);
        labels[0] = "Food bank";
        labels[1] = "Animal shelter";
        labels[2] = "Winter homeless aid";

        address payable[] memory recipients = new address payable[](3);
        recipients[0] = payable(vm.envAddress("RECIPIENT_0"));
        recipients[1] = payable(vm.envAddress("RECIPIENT_1"));
        recipients[2] = payable(vm.envAddress("RECIPIENT_2"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        poll = new LiveVote("Which cause gets tonight's pot?", labels, recipients, 0.0005 ether);
        vm.stopBroadcast();

        console.log("LiveVote deployed at", address(poll));
    }
}
