// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LiveVote
/// @notice Live donation poll: every vote is a micro-donation, priced quadratically
///         per voter and option. On close, the whole pot goes to the winning option's recipient.
contract LiveVote is Ownable, ReentrancyGuard {
    string public question;
    string[] private _labels;
    address payable[] private _recipients;
    uint256 public immutable unitPrice;

    bool public open = true;
    uint256 public voterCount;

    uint256[] private _votes;
    mapping(address => mapping(uint256 => uint256)) public votesOf;
    mapping(address => bool) public hasVoted;

    event Voted(address indexed voter, uint256 indexed option, uint256 n, uint256 cost);
    event Closed(uint256 indexed winner, address indexed recipient, uint256 amount);

    error PollClosed();
    error InvalidOption();
    error InvalidCount();
    error InsufficientPayment(uint256 required, uint256 sent);
    error TransferFailed();
    error BadConfig();

    constructor(
        string memory question_,
        string[] memory labels_,
        address payable[] memory recipients_,
        uint256 unitPrice_
    ) Ownable(msg.sender) {
        if (labels_.length < 2 || labels_.length != recipients_.length || unitPrice_ == 0) revert BadConfig();
        for (uint256 i; i < recipients_.length; ++i) {
            if (recipients_[i] == address(0)) revert BadConfig();
        }
        question = question_;
        _labels = labels_;
        _recipients = recipients_;
        unitPrice = unitPrice_;
        _votes = new uint256[](labels_.length);
    }

    /// @notice Cost for `voter` to add `n` votes to `option`: ((k+n)^2 - k^2) * unitPrice.
    function costOf(address voter, uint256 option, uint256 n) public view returns (uint256) {
        uint256 k = votesOf[voter][option];
        return ((k + n) * (k + n) - k * k) * unitPrice;
    }

    function vote(uint256 option, uint256 n) external payable nonReentrant {
        if (!open) revert PollClosed();
        if (option >= _labels.length) revert InvalidOption();
        if (n == 0 || n > 100) revert InvalidCount();

        uint256 cost = costOf(msg.sender, option, n);
        if (msg.value < cost) revert InsufficientPayment(cost, msg.value);

        votesOf[msg.sender][option] += n;
        _votes[option] += n;
        if (!hasVoted[msg.sender]) {
            hasVoted[msg.sender] = true;
            ++voterCount;
        }
        emit Voted(msg.sender, option, n, cost);

        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @notice Ends the poll and pays the whole pot to the option with the most votes
    ///         (ties go to the lower index).
    function close() external onlyOwner nonReentrant {
        if (!open) revert PollClosed();
        open = false;

        uint256 winner;
        for (uint256 i = 1; i < _votes.length; ++i) {
            if (_votes[i] > _votes[winner]) winner = i;
        }
        uint256 amount = address(this).balance;
        address payable recipient = _recipients[winner];
        emit Closed(winner, recipient, amount);

        if (amount > 0) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
    }

    function getResults()
        external
        view
        returns (uint256[] memory votes, uint256 pot, uint256 voters, bool isOpen)
    {
        return (_votes, address(this).balance, voterCount, open);
    }

    function getOptions() external view returns (string[] memory labels, address payable[] memory recipients) {
        return (_labels, _recipients);
    }
}
