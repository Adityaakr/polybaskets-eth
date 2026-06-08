// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * WvaraVault — custodies real wVARA on Hoodi for the PolyBaskets-ETH program.
 *
 * On ethexe a Sails program can't hold an arbitrary ERC-20 as collateral, so wVARA lives here.
 *  - deposit(amount): user pre-approves this vault, then we pull real wVARA via transferFrom
 *    and emit Deposited. A relayer (the program owner) mirrors it into the program's ledger
 *    via credit_wvara, so the betting balance is always backed 1:1 by tokens held here.
 *  - release(to, amount): the relayer releases real wVARA after the program authorises a
 *    withdrawal (program.withdraw_wvara debits the ledger and queues the release).
 *
 * Trust model: the relayer is the same trusted operator that runs settlement. The vault never
 * lets the relayer take more than it holds, and tracks per-user deposits for transparency.
 */
contract WvaraVault {
    IERC20 public immutable WVARA;
    address public relayer;
    address public owner;

    uint256 public totalDeposited;
    mapping(address => uint256) public depositedBy;

    event Deposited(address indexed user, uint256 amount, uint256 nonce);
    event Released(address indexed to, uint256 amount);
    event RelayerChanged(address indexed relayer);

    error NotRelayer();
    error NotOwner();
    error ZeroAmount();
    error TransferFailed();

    uint256 public depositNonce;

    constructor(address wvara, address relayer_) {
        WVARA = IERC20(wvara);
        relayer = relayer_;
        owner = msg.sender;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    /// Pull `amount` wVARA from the caller into the vault. Caller must approve first.
    function deposit(uint256 amount) external returns (uint256 nonce) {
        if (amount == 0) revert ZeroAmount();
        if (!WVARA.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        totalDeposited += amount;
        depositedBy[msg.sender] += amount;
        nonce = ++depositNonce;
        emit Deposited(msg.sender, amount, nonce);
    }

    /// Release `amount` wVARA to `to`. Relayer only — called after the program authorises it.
    function release(address to, uint256 amount) external onlyRelayer {
        if (amount == 0) revert ZeroAmount();
        if (!WVARA.transfer(to, amount)) revert TransferFailed();
        emit Released(to, amount);
    }

    function setRelayer(address relayer_) external {
        if (msg.sender != owner) revert NotOwner();
        relayer = relayer_;
        emit RelayerChanged(relayer_);
    }

    function held() external view returns (uint256) {
        return WVARA.balanceOf(address(this));
    }
}
