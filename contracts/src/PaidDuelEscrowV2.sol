// SPDX-License-Identifier: MIT
pragma solidity ^0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EscrowAccounting} from "./EscrowAccounting.sol";

/// @notice Equal-entry USDC duel escrow. Gameplay truth is trusted to the record's locked signer.
/// @dev Non-upgradeable. No admin drain, no arbitrary call, no token/fee setter. Settlement and
///      refunds allocate pull credits; tokens move only through `withdrawFor` to a bound recipient.
contract PaidDuelEscrowV2 is EIP712, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;
    using EscrowAccounting for EscrowAccounting.Record;

    /// @dev Circle USDC on Monad testnet, as published by Circle and re-verified over RPC.
    ///      On chain 10143 the constructor refuses any other token address.
    address public constant CIRCLE_USDC_MONAD_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    uint256 public constant ENTRY = 1_000_000; // 1 USDC
    uint256 public constant POOL = 2 * ENTRY;
    uint256 public constant MAX_FUNDING_WINDOW = 15 minutes;
    uint256 public constant PLAY_WINDOW = 60 minutes;
    uint256 public constant SETTLEMENT_WINDOW = 75 minutes;
    uint8 public constant OUTCOME_FINISHED = 0;
    uint8 public constant OUTCOME_FORFEIT = 1;
    uint8 public constant OUTCOME_VOID = 2;

    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "Result(bytes32 recordId,bytes32 matchId,uint8 stage,address participantA,address participantB,address winnerRecipient,uint8 outcomeType,bytes32 termsHash,bytes32 rulesetHash,bytes32 replayHash,uint64 finishedAt,uint32 resultSequence,uint32 signerEpoch,uint64 expiresAt)"
    );
    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "DuelTerms(bytes32 salt,address playerA,address playerB,bytes32 rulesetHash,address signer,uint32 signerEpoch,uint64 fundingDeadline)"
    );

    IERC20 public immutable token;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint256 public immutable deploymentChainId;

    struct Policy {
        uint256 entry;
        uint256 pool;
        uint256 winnerAward;
        uint256 treasuryFee;
        uint16 feeBps;
        uint64 maxFundingWindow;
        uint64 playWindow;
        uint64 settlementWindow;
    }

    struct DuelTerms {
        bytes32 salt;
        address[2] players; // ordered: seat 0 then seat 1
        bytes32 rulesetHash;
        address signer;
        uint32 signerEpoch;
        uint64 fundingDeadline;
    }

    struct Result {
        bytes32 recordId;
        bytes32 matchId;
        uint8 stage;
        address participantA;
        address participantB;
        address winnerRecipient;
        uint8 outcomeType; // 0 Finished, 1 Forfeit, 2 Void
        bytes32 termsHash;
        bytes32 rulesetHash;
        bytes32 replayHash;
        uint64 finishedAt;
        uint32 resultSequence;
        uint32 signerEpoch;
        uint64 expiresAt;
    }

    enum State {
        None,
        Funding,
        Active,
        Complete,
        Cancelled
    }

    struct Duel {
        State state;
        address[2] players;
        address signer;
        uint32 signerEpoch;
        uint8 fundedMask;
        uint64 fundingDeadline;
        uint64 lockedAt;
        uint64 playDeadline;
        uint64 settlementDeadline;
        bytes32 rulesetHash;
        bytes32 termsHash;
        EscrowAccounting.Record ledger;
    }

    address public nextSigner;
    uint32 public nextSignerEpoch = 1;
    address public guardian;
    bool public intakePaused;
    bool public resultsPaused;

    uint256 public totalReserved;
    mapping(bytes32 => Duel) private duels;
    mapping(bytes32 => mapping(address => uint256)) public credits;
    mapping(address => bool) public revokedSigner;

    event IntakePaused(address indexed account);
    event IntakeUnpaused(address indexed account);
    event ResultsPaused(address indexed account);
    event ResultsUnpaused(address indexed account);
    event GuardianChanged(address indexed previous, address indexed next);
    event SignerRotated(address indexed signer, uint32 epoch);
    event SignerRevoked(address indexed signer);
    event DuelCreated(bytes32 indexed recordId, address[2] players, bytes32 termsHash, bytes32 rulesetHash, address signer, uint32 signerEpoch, uint64 fundingDeadline);
    event DuelFunded(bytes32 indexed recordId, address indexed player, uint256 amount, uint8 fundedMask);
    event DuelActivated(bytes32 indexed recordId, uint64 lockedAt, uint64 playDeadline, uint64 settlementDeadline);
    event DuelSettled(bytes32 indexed recordId, address winnerRecipient, uint8 outcomeType, bytes32 replayHash, uint256 winnerAward, uint256 treasuryFee);
    event DuelCancelled(bytes32 indexed recordId, uint8 reason);
    event CreditAllocated(bytes32 indexed recordId, address indexed recipient, uint256 amount);
    event Paid(bytes32 indexed recordId, address indexed recipient, uint256 amount, address token);

    modifier whenIntakeOpen() {
        require(!intakePaused, "intake paused");
        _;
    }

    modifier whenResultsOpen() {
        require(!resultsPaused, "results paused");
        _;
    }

    /// @param token_ USDC token. On chain 10143 only the audited Circle address is accepted.
    /// @param expectedChainId Caller's expected network. Must equal block.chainid.
    constructor(IERC20 token_, uint256 expectedChainId, address signer_, address treasury_, uint16 feeBps_, address owner_)
        EIP712("CHOG Paid Duel", "2")
        Ownable(owner_)
    {
        require(expectedChainId == block.chainid, "chain id mismatch");
        require(address(token_).code.length > 0, "token has no code");
        require(signer_ != address(0) && treasury_ != address(0) && owner_ != address(0), "zero role");
        require(treasury_ != address(this), "treasury is escrow");
        require(feeBps_ == 500, "fee must be five percent");
        require(_decimalsOf(address(token_)) == 6, "six-decimal token required");
        // Symbol and decimals alone do not prove the issuer. On the supported network the
        // token must be the address audited against Circle's published deployment list.
        if (block.chainid == 10143) require(address(token_) == CIRCLE_USDC_MONAD_TESTNET, "not audited USDC");
        token = token_;
        treasury = treasury_;
        feeBps = feeBps_;
        deploymentChainId = block.chainid;
        nextSigner = signer_;
        guardian = owner_;
    }

    function _decimalsOf(address token_) private view returns (uint256 value) {
        (bool ok, bytes memory data) = token_.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && data.length >= 32, "token decimals unavailable");
        value = abi.decode(data, (uint256));
    }

    function policy() public view returns (Policy memory) {
        uint256 fee = (POOL * feeBps) / 10000;
        return Policy(ENTRY, POOL, POOL - fee, fee, feeBps, uint64(MAX_FUNDING_WINDOW), uint64(PLAY_WINDOW), uint64(SETTLEMENT_WINDOW));
    }

    function matchIdFor(bytes32 recordId) public pure returns (bytes32) {
        return keccak256(abi.encode(recordId, uint8(0)));
    }

    /// @notice Record identity binds chain, escrow, record kind and the whole terms struct.
    function duelId(DuelTerms calldata terms) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), "CHOG_DUEL_V2", terms));
    }

    /// @notice Terms hash also binds the record to this escrow's token, amounts, treasury and windows.
    function termsHash(DuelTerms calldata terms) public view returns (bytes32) {
        Policy memory p = policy();
        bytes32 structHash = keccak256(
            abi.encode(TERMS_TYPEHASH, terms.salt, terms.players[0], terms.players[1], terms.rulesetHash, terms.signer, terms.signerEpoch, terms.fundingDeadline)
        );
        return keccak256(
            abi.encode(
                _hashTypedDataV4(structHash),
                address(token),
                p.entry,
                p.pool,
                treasury,
                p.feeBps,
                p.maxFundingWindow,
                p.playWindow,
                p.settlementWindow
            )
        );
    }

    function previewDuelId(DuelTerms calldata terms) external view returns (bytes32) {
        return duelId(terms);
    }

    function hashResult(Result calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESULT_TYPEHASH,
                    r.recordId,
                    r.matchId,
                    r.stage,
                    r.participantA,
                    r.participantB,
                    r.winnerRecipient,
                    r.outcomeType,
                    r.termsHash,
                    r.rulesetHash,
                    r.replayHash,
                    r.finishedAt,
                    r.resultSequence,
                    r.signerEpoch,
                    r.expiresAt
                )
            )
        );
    }

    function getDuel(bytes32 id) external view returns (Duel memory) {
        return duels[id];
    }

    function ledgerOf(bytes32 id) external view returns (uint256 totalDeposited, uint256 unallocated, uint256 outstanding, uint256 totalPaid) {
        EscrowAccounting.Record storage r = duels[id].ledger;
        return (r.totalDeposited, r.unallocated, r.outstanding, r.totalPaid);
    }

    /// @notice Record ids are single-use, including ids that were refunded.
    function used(bytes32 id) public view returns (bool) {
        return duels[id].state != State.None;
    }

    /// @notice Creates the record and deposits the creator's own entry atomically.
    function createAndFundDuel(DuelTerms calldata terms) external nonReentrant whenIntakeOpen returns (bytes32 id) {
        require(terms.rulesetHash != bytes32(0), "ruleset required");
        require(terms.players[0] != address(0) && terms.players[1] != address(0) && terms.players[0] != terms.players[1], "two distinct players required");
        require(terms.players[0] != address(this) && terms.players[1] != address(this), "escrow cannot participate");
        uint8 seat = msg.sender == terms.players[0] ? 0 : msg.sender == terms.players[1] ? 1 : 3;
        require(seat < 2, "only an assigned player may create");
        require(terms.fundingDeadline > block.timestamp && terms.fundingDeadline <= block.timestamp + MAX_FUNDING_WINDOW, "funding deadline out of range");
        // A new record must bind the escrow's current signer configuration.
        require(terms.signer == nextSigner && terms.signerEpoch == nextSignerEpoch, "stale signer configuration");
        require(!revokedSigner[terms.signer], "signer revoked");
        id = duelId(terms);
        require(!used(id), "record already exists");

        Duel storage d = duels[id];
        d.state = State.Funding;
        d.players = terms.players;
        d.rulesetHash = terms.rulesetHash;
        d.signer = terms.signer;
        d.signerEpoch = terms.signerEpoch;
        d.fundingDeadline = terms.fundingDeadline;
        d.termsHash = termsHash(terms);
        d.fundedMask = uint8(1 << seat);
        _deposit(d, msg.sender);
        emit DuelCreated(id, terms.players, d.termsHash, terms.rulesetHash, terms.signer, terms.signerEpoch, terms.fundingDeadline);
        emit DuelFunded(id, msg.sender, ENTRY, d.fundedMask);
    }

    /// @notice Deposits the second entry and activates the duel in the same transaction.
    function fundDuel(bytes32 id) external nonReentrant whenIntakeOpen {
        Duel storage d = duels[id];
        require(d.state == State.Funding, "duel not funding");
        require(block.timestamp <= d.fundingDeadline, "funding closed");
        uint8 bit = msg.sender == d.players[0] ? 1 : msg.sender == d.players[1] ? 2 : 0;
        require(bit != 0 && d.fundedMask & bit == 0, "ineligible or already funded");
        require(!revokedSigner[d.signer], "signer revoked");
        d.fundedMask |= bit;
        _deposit(d, msg.sender);
        emit DuelFunded(id, msg.sender, ENTRY, d.fundedMask);
        if (d.fundedMask == 3) {
            d.state = State.Active;
            d.lockedAt = uint64(block.timestamp);
            d.playDeadline = uint64(block.timestamp) + uint64(PLAY_WINDOW);
            d.settlementDeadline = uint64(block.timestamp) + uint64(SETTLEMENT_WINDOW);
            emit DuelActivated(id, d.lockedAt, d.playDeadline, d.settlementDeadline);
        }
    }

    /// @notice While a record is still Funding, its sole depositor may release their own entry.
    function cancelFunding(bytes32 id) external nonReentrant {
        Duel storage d = duels[id];
        require(d.state == State.Funding, "only an open Funding record can be cancelled here");
        uint8 bit = msg.sender == d.players[0] ? 1 : msg.sender == d.players[1] ? 2 : 0;
        require(bit != 0 && d.fundedMask == bit, "only the sole depositor may cancel");
        _cancel(id, d, 0);
    }

    /// @notice After the funding deadline, anyone may release a still-incomplete Funding record.
    function refundExpiredFunding(bytes32 id) external nonReentrant {
        Duel storage d = duels[id];
        require(d.state == State.Funding && block.timestamp > d.fundingDeadline, "funding refund not available");
        _cancel(id, d, 2);
    }

    /// @notice Releases entries once the settlement deadline passed without an accepted result.
    function refundExpired(bytes32 id) external nonReentrant {
        Duel storage d = duels[id];
        require(d.state == State.Active && block.timestamp > d.settlementDeadline, "refund not available");
        _cancel(id, d, 2);
    }

    /// @notice A revoked signer can no longer decide the record, so anyone may release it.
    function refundRevoked(bytes32 id) external nonReentrant {
        Duel storage d = duels[id];
        require(d.state == State.Funding || d.state == State.Active, "record is not refundable");
        require(revokedSigner[d.signer], "signer is not revoked");
        _cancel(id, d, 3);
    }

    /// @notice Permissionless: anyone may deliver a valid signed result.
    function submitResult(Result calldata r, bytes calldata signature) external nonReentrant whenResultsOpen {
        Duel storage d = duels[r.recordId];
        require(d.state == State.Active, "duel not active");
        require(r.matchId == matchIdFor(r.recordId) && r.stage == 0, "wrong match slot");
        require(r.resultSequence == 1, "wrong result sequence");
        require(
            r.participantA == d.players[0] && r.participantB == d.players[1] && r.rulesetHash == d.rulesetHash && r.termsHash == d.termsHash
                && r.signerEpoch == d.signerEpoch,
            "result terms mismatch"
        );
        require(r.outcomeType <= OUTCOME_VOID && r.replayHash != bytes32(0), "invalid outcome");
        require(r.finishedAt >= d.lockedAt && r.finishedAt <= d.playDeadline && r.finishedAt <= block.timestamp, "invalid finish time");
        require(block.timestamp <= d.settlementDeadline && block.timestamp <= r.expiresAt && r.expiresAt <= d.settlementDeadline, "result expired");
        require(!revokedSigner[d.signer], "signer revoked");
        require(ECDSA.recover(hashResult(r), signature) == d.signer, "unauthorized signer");

        uint256 fee;
        if (r.outcomeType == OUTCOME_VOID) {
            require(r.winnerRecipient == address(0), "Void has no winner");
            _cancel(r.recordId, d, 4);
        } else {
            require(r.winnerRecipient == d.players[0] || r.winnerRecipient == d.players[1], "ineligible winner");
            d.state = State.Complete;
            Policy memory p = policy();
            fee = p.treasuryFee;
            _allocate(r.recordId, d, r.winnerRecipient, p.winnerAward);
            if (fee > 0) _allocate(r.recordId, d, treasury, fee);
        }
        emit DuelSettled(r.recordId, r.winnerRecipient, r.outcomeType, r.replayHash, r.outcomeType == OUTCOME_VOID ? 0 : POOL - fee, fee);
    }

    /// @notice Permissionless. Always pays an already-allocated credit to its bound recipient.
    ///         Never callable to a caller-chosen destination and never blocked by an active pause.
    function withdrawFor(bytes32 id, address recipient) external nonReentrant returns (uint256 amount) {
        amount = credits[id][recipient];
        require(amount > 0, "no credit");
        require(recipient != address(this), "escrow cannot receive payout");
        uint256 beforeRecipient = token.balanceOf(recipient);
        uint256 beforeEscrow = token.balanceOf(address(this));
        Duel storage d = duels[id];
        credits[id][recipient] = 0;
        d.ledger.settle(amount);
        totalReserved -= amount;
        emit Paid(id, recipient, amount, address(token));
        token.safeTransfer(recipient, amount);
        require(token.balanceOf(recipient) == beforeRecipient + amount && token.balanceOf(address(this)) == beforeEscrow - amount, "unsupported token transfer");
    }

    function _deposit(Duel storage d, address from) private {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), ENTRY);
        require(token.balanceOf(address(this)) == before + ENTRY, "unsupported token transfer");
        d.ledger.deposit(ENTRY);
        totalReserved += ENTRY;
    }

    function _allocate(bytes32 id, Duel storage d, address recipient, uint256 amount) private {
        if (amount == 0) return;
        credits[id][recipient] += amount;
        d.ledger.allocate(amount);
        emit CreditAllocated(id, recipient, amount);
    }

    /// @dev Returns every deposited entry to the seats that actually paid, with no fee.
    function _cancel(bytes32 id, Duel storage d, uint8 reason) private {
        require(d.state == State.Funding || d.state == State.Active, "record is not cancellable");
        d.state = State.Cancelled;
        for (uint8 i = 0; i < 2; i++) {
            if (d.fundedMask & uint8(1 << i) != 0) _allocate(id, d, d.players[i], ENTRY);
        }
        require(d.ledger.unallocated == 0 && d.ledger.owed() == d.ledger.totalDeposited, "refund accounting mismatch");
        emit DuelCancelled(id, reason);
    }

    /// @notice Rotates the signer used by *new* records. Existing records keep their snapshot.
    function setNextSigner(address signer) external onlyOwner {
        require(signer != address(0), "zero signer");
        require(!revokedSigner[signer], "signer revoked");
        nextSigner = signer;
        nextSignerEpoch += 1;
        emit SignerRotated(signer, nextSignerEpoch);
    }

    /// @notice Emergency: rejects this signer's pending results and opens refunds for its
    ///         non-terminal records. Already-final payouts are untouched; a rotation is required
    ///         before new records can be created.
    function revokeSigner(address signer) external {
        require(msg.sender == owner() || msg.sender == guardian, "not authorized");
        require(signer != address(0), "zero signer");
        revokedSigner[signer] = true;
        emit SignerRevoked(signer);
    }

    function setGuardian(address next) external onlyOwner {
        require(next != address(0), "zero guardian");
        emit GuardianChanged(guardian, next);
        guardian = next;
    }

    /// @dev Intake pause only stops new deposits. Cancel, refund and withdrawal stay available.
    function pauseIntake() external {
        require(msg.sender == owner() || msg.sender == guardian, "not authorized");
        intakePaused = true;
        emit IntakePaused(msg.sender);
    }

    function unpauseIntake() external onlyOwner {
        intakePaused = false;
        emit IntakeUnpaused(msg.sender);
    }

    /// @dev Results pause only stops result acceptance. Refunds and withdrawals stay available.
    function pauseResults() external {
        require(msg.sender == owner() || msg.sender == guardian, "not authorized");
        resultsPaused = true;
        emit ResultsPaused(msg.sender);
    }

    function unpauseResults() external onlyOwner {
        resultsPaused = false;
        emit ResultsUnpaused(msg.sender);
    }

    /// @notice Move an owner-held guardian atomically with the accepted ownership transfer.
    ///         A separately appointed guardian remains an independent emergency role.
    function acceptOwnership() public override {
        address previous = owner();
        super.acceptOwnership();
        if (guardian == previous) {
            guardian = owner();
            emit GuardianChanged(previous, guardian);
        }
    }

    function renounceOwnership() public view override onlyOwner {
        revert("ownership renunciation disabled");
    }
}
