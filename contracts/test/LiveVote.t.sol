// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LiveVote} from "../src/LiveVote.sol";

contract LiveVoteTest is Test {
    LiveVote poll;
    uint256 constant UNIT = 0.0005 ether;

    address payable r0 = payable(makeAddr("foodBank"));
    address payable r1 = payable(makeAddr("animalShelter"));
    address payable r2 = payable(makeAddr("winterAid"));
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        string[] memory labels = new string[](3);
        labels[0] = "Food bank";
        labels[1] = "Animal shelter";
        labels[2] = "Winter homeless aid";
        address payable[] memory recipients = new address payable[](3);
        recipients[0] = r0;
        recipients[1] = r1;
        recipients[2] = r2;
        poll = new LiveVote("Which cause gets tonight's pot?", labels, recipients, UNIT);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    function test_QuadraticCost() public {
        assertEq(poll.costOf(alice, 0, 1), 1 * UNIT);
        assertEq(poll.costOf(alice, 0, 3), 9 * UNIT);

        vm.prank(alice);
        poll.vote{value: UNIT}(0, 1); // k=0 -> 1
        // next 2 votes: (3^2 - 1^2) = 8 units
        assertEq(poll.costOf(alice, 0, 2), 8 * UNIT);
        vm.prank(alice);
        poll.vote{value: 8 * UNIT}(0, 2);

        assertEq(poll.votesOf(alice, 0), 3);
        // cost is per option: a different option starts fresh
        assertEq(poll.costOf(alice, 1, 1), UNIT);
        (uint256[] memory votes, uint256 pot, uint256 voters,) = poll.getResults();
        assertEq(votes[0], 3);
        assertEq(pot, 9 * UNIT);
        assertEq(voters, 1);
    }

    function test_OverpaymentRefunded() public {
        uint256 before = alice.balance;
        vm.prank(alice);
        poll.vote{value: 0.1 ether}(1, 2); // costs 4 units
        assertEq(alice.balance, before - 4 * UNIT);
        assertEq(address(poll).balance, 4 * UNIT);
    }

    function test_RevertWhen_Underpaid() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LiveVote.InsufficientPayment.selector, 4 * UNIT, 3 * UNIT));
        poll.vote{value: 3 * UNIT}(0, 2);
    }

    function test_ClosePaysWinner() public {
        vm.prank(alice);
        poll.vote{value: 4 * UNIT}(2, 2); // option 2: 2 votes
        vm.prank(bob);
        poll.vote{value: UNIT}(0, 1); // option 0: 1 vote

        uint256 pot = address(poll).balance;
        assertEq(pot, 5 * UNIT);

        vm.expectEmit(true, true, false, true);
        emit LiveVote.Closed(2, r2, pot);
        poll.close();

        assertEq(r2.balance, pot);
        assertEq(address(poll).balance, 0);
        (,,, bool isOpen) = poll.getResults();
        assertFalse(isOpen);
    }

    function test_RevertWhen_VoteAfterClose() public {
        poll.close();
        vm.prank(alice);
        vm.expectRevert(LiveVote.PollClosed.selector);
        poll.vote{value: UNIT}(0, 1);
    }

    function test_RevertWhen_NonOwnerCloses() public {
        vm.prank(alice);
        vm.expectRevert();
        poll.close();
    }

    function test_RevertWhen_InvalidOption() public {
        vm.prank(alice);
        vm.expectRevert(LiveVote.InvalidOption.selector);
        poll.vote{value: UNIT}(3, 1);
    }

    function test_ShardsSumAcrossManyVoters() public {
        // 40 voters land in many different shards; totals and voter count must still add up.
        for (uint256 i = 1; i <= 40; ++i) {
            address v = address(uint160(0x1000 + i));
            vm.deal(v, 1 ether);
            vm.prank(v);
            poll.vote{value: UNIT}(i % 3, 1);
        }
        (uint256[] memory votes, uint256 pot, uint256 voters,) = poll.getResults();
        assertEq(votes[0] + votes[1] + votes[2], 40);
        assertEq(votes[1], 14); // i % 3 == 1 for i in 1..40
        assertEq(voters, 40);
        assertEq(poll.voterCount(), 40);
        assertEq(pot, 40 * UNIT);
    }
}
