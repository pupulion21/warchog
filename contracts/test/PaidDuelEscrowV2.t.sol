// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PaidDuelEscrowV2} from "../src/PaidDuelEscrowV2.sol";
import {MockUSDC, EighteenDecimalUSDC, Vm} from "./V2Harness.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Six-decimal token that is deliberately not the audited Circle deployment.
contract LookalikeUSDC is MockUSDC {}

contract PaidDuelEscrowV2Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant SIGNER_KEY = 0xA11CE;
    uint256 constant OTHER_KEY = 0xB0B;
    uint256 constant CHAIN = 31337;
    bytes32 constant RULES = keccak256("combat-build-v2");
    bytes32 constant SALT = keccak256("duel-salt-1");
    bytes32 constant REPLAY = keccak256("replay-bundle");

    MockUSDC token;
    PaidDuelEscrowV2 escrow;

    address treasury = address(0x0000000000000000000000000000000000000456);
    address guardian = address(0x0000000000000000000000000000000000000789);
    address stranger = address(0x0000000000000000000000000000000000000Bad);
    address[2] players = [address(0xA11), address(0xB22)];

    function setUp() public {
        vm.chainId(CHAIN);
        vm.warp(1_000);
        token = new MockUSDC();
        escrow = new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, vm.addr(SIGNER_KEY), treasury, 500, address(this));
        escrow.setGuardian(guardian);
        for (uint256 i = 0; i < 2; i++) {
            token.mint(players[i], 100_000_000);
            vm.prank(players[i]);
            token.approve(address(escrow), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- helpers

    function terms(bytes32 salt) internal view returns (PaidDuelEscrowV2.DuelTerms memory t) {
        t = PaidDuelEscrowV2.DuelTerms({
            salt: salt,
            players: players,
            rulesetHash: RULES,
            signer: escrow.nextSigner(),
            signerEpoch: escrow.nextSignerEpoch(),
            fundingDeadline: uint64(block.timestamp + 10 minutes)
        });
    }

    function createFunded(bytes32 salt) internal returns (bytes32 id) {
        PaidDuelEscrowV2.DuelTerms memory t = terms(salt);
        id = escrow.previewDuelId(t);
        vm.prank(players[0]);
        escrow.createAndFundDuel(t);
    }

    function createActive(bytes32 salt) internal returns (bytes32 id) {
        id = createFunded(salt);
        vm.prank(players[1]);
        escrow.fundDuel(id);
    }

    function resultFor(bytes32 id) internal view returns (PaidDuelEscrowV2.Result memory r) {
        return resultForOn(escrow, id);
    }

    function resultForOn(PaidDuelEscrowV2 target, bytes32 id) internal view returns (PaidDuelEscrowV2.Result memory r) {
        PaidDuelEscrowV2.Duel memory d = target.getDuel(id);
        r = PaidDuelEscrowV2.Result({
            recordId: id,
            matchId: target.matchIdFor(id),
            stage: 0,
            participantA: d.players[0],
            participantB: d.players[1],
            winnerRecipient: players[0],
            outcomeType: 0,
            termsHash: d.termsHash,
            rulesetHash: d.rulesetHash,
            replayHash: REPLAY,
            finishedAt: d.lockedAt,
            resultSequence: 1,
            signerEpoch: d.signerEpoch,
            expiresAt: d.settlementDeadline
        });
    }

    function sign(PaidDuelEscrowV2.Result memory r, uint256 key) internal returns (bytes memory) {
        return signOn(escrow, r, key);
    }

    function signOn(PaidDuelEscrowV2 target, PaidDuelEscrowV2.Result memory r, uint256 key) internal returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(key, target.hashResult(r));
        return abi.encodePacked(rr, s, v);
    }

    function mustRevert(PaidDuelEscrowV2.Result memory r) internal {
        bytes memory sig = sign(r, SIGNER_KEY);
        vm.expectRevert();
        escrow.submitResult(r, sig);
    }

    function assertConserved(bytes32 id) internal view {
        (uint256 deposited, uint256 unallocated, uint256 outstanding, uint256 paid) = escrow.ledgerOf(id);
        require(deposited == unallocated + outstanding + paid, "record ledger not conserved");
        require(token.balanceOf(address(escrow)) >= escrow.totalReserved(), "escrow undercollateralised");
    }

    // ------------------------------------------------------- creation / funding

    function testCreateDepositsFirstEntryAndFundActivatesWithoutRelay() public {
        bytes32 id = createFunded(SALT);
        PaidDuelEscrowV2.Duel memory d = escrow.getDuel(id);
        require(d.state == PaidDuelEscrowV2.State.Funding, "first deposit must not activate");
        require(d.fundedMask == 1, "creator entry not recorded");
        require(escrow.credits(id, players[0]) == 0, "a deposit is not yet a payout credit");
        (uint256 deposited, uint256 unallocated, uint256 outstanding,) = escrow.ledgerOf(id);
        require(deposited == 1_000_000 && unallocated == 1_000_000 && outstanding == 0, "first deposit ledger wrong");

        vm.prank(players[1]);
        escrow.fundDuel(id);
        d = escrow.getDuel(id);
        require(d.state == PaidDuelEscrowV2.State.Active, "second deposit must activate atomically");
        require(d.fundedMask == 3, "second entry not recorded");
        require(d.playDeadline == d.lockedAt + 60 minutes && d.settlementDeadline == d.lockedAt + 75 minutes, "window wrong");
        require(escrow.totalReserved() == 2_000_000, "pool must be reserved on activation");
        assertConserved(id);
    }

    function testOnlyAssignedPlayerMayCreateAndFundingDeadlineIsBounded() public {
        PaidDuelEscrowV2.DuelTerms memory t = terms(SALT);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.createAndFundDuel(t);

        t.fundingDeadline = uint64(block.timestamp + 15 minutes + 1);
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);

        t.fundingDeadline = uint64(block.timestamp);
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);

        t = terms(SALT);
        t.players[1] = t.players[0];
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);

        t = terms(SALT);
        t.rulesetHash = bytes32(0);
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);
    }

    function testRecordIdentifierCannotBeReusedEvenAfterRefund() public {
        bytes32 id = createFunded(SALT);
        vm.prank(players[0]);
        escrow.cancelFunding(id);
        require(escrow.used(id), "cancelled record must stay consumed");
        PaidDuelEscrowV2.DuelTerms memory t = terms(SALT);
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);
    }

    function testStaleSignerConfigurationIsRefusedForNewRecords() public {
        PaidDuelEscrowV2.DuelTerms memory t = terms(SALT);
        escrow.setNextSigner(vm.addr(OTHER_KEY));
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);

        // The same salt with the fresh configuration is a different record and must succeed.
        t = terms(SALT);
        vm.prank(players[0]);
        bytes32 id = escrow.createAndFundDuel(t);
        require(escrow.getDuel(id).signer == vm.addr(OTHER_KEY), "rotated signer must bind");
    }

    function testThirdPartyAndDoubleFundingAreRejected() public {
        bytes32 id = createFunded(SALT);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.fundDuel(id);
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.fundDuel(id);
    }

    function testFundingAfterDeadlineIsRejected() public {
        bytes32 id = createFunded(SALT);
        vm.warp(block.timestamp + 10 minutes + 1);
        vm.prank(players[1]);
        vm.expectRevert();
        escrow.fundDuel(id);
    }

    // ------------------------------------------------------------ cancel/refund

    function testSoleDepositorCancelsAndGetsExactRefundWithoutFee() public {
        bytes32 id = createFunded(SALT);
        uint256 before = token.balanceOf(players[0]);
        vm.prank(players[0]);
        escrow.cancelFunding(id);
        require(escrow.credits(id, players[0]) == 1_000_000, "full entry credit expected");
        require(escrow.credits(id, treasury) == 0, "no fee on a cancelled duel");
        require(escrow.credits(id, players[1]) == 0, "unfunded seat must have no credit");
        require(escrow.totalReserved() == 1_000_000, "reserved must track the single entry");
        escrow.withdrawFor(id, players[0]);
        require(token.balanceOf(players[0]) == before + 1_000_000, "refund must return the exact entry");
        require(escrow.totalReserved() == 0, "reserved must drain to zero");
        assertConserved(id);
    }

    function testOnlyTheSoleDepositorCanCancelAndOnlyWhileFunding() public {
        bytes32 id = createFunded(SALT);
        vm.prank(players[1]);
        vm.expectRevert();
        escrow.cancelFunding(id);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.cancelFunding(id);

        vm.prank(players[1]);
        escrow.fundDuel(id);
        vm.prank(players[0]);
        vm.expectRevert();
        escrow.cancelFunding(id);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.cancelFunding(id);
    }

    function testFundingRefundRequiresTheDeadlineAndIsPermissionless() public {
        bytes32 id = createFunded(SALT);
        vm.expectRevert();
        escrow.refundExpiredFunding(id);
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert();
        escrow.refundExpiredFunding(id);
        vm.warp(block.timestamp + 1);
        vm.prank(stranger);
        escrow.refundExpiredFunding(id);
        require(escrow.credits(id, players[0]) == 1_000_000, "deposited entry must be refundable");
        vm.expectRevert();
        escrow.refundExpiredFunding(id);
        assertConserved(id);
    }

    function testSettlementTimeoutRefundIsPermissionlessAndSingleUse() public {
        bytes32 id = createActive(SALT);
        vm.expectRevert();
        escrow.refundExpired(id);
        vm.warp(block.timestamp + 75 minutes);
        vm.expectRevert();
        escrow.refundExpired(id);
        vm.warp(block.timestamp + 1);
        vm.prank(stranger);
        escrow.refundExpired(id);
        require(escrow.credits(id, players[0]) == 1_000_000 && escrow.credits(id, players[1]) == 1_000_000, "both entries refunded");
        require(escrow.credits(id, treasury) == 0, "timeout refund carries no fee");
        vm.expectRevert();
        escrow.refundExpired(id);
        assertConserved(id);
    }

    // ---------------------------------------------------------------- settlement

    function testWinnerAwardAndTreasuryFeeAllocateExactlyOnce() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        bytes memory sig = sign(r, SIGNER_KEY);
        escrow.submitResult(r, sig);
        require(escrow.credits(id, players[0]) == 1_900_000, "winner award wrong");
        require(escrow.credits(id, treasury) == 100_000, "treasury fee wrong");
        require(escrow.credits(id, players[1]) == 0, "loser must have no credit");
        require(escrow.totalReserved() == 2_000_000, "reserved must hold the whole pool");

        vm.expectRevert();
        escrow.submitResult(r, sig);
        vm.warp(block.timestamp + 75 minutes + 1);
        vm.expectRevert();
        escrow.refundExpired(id);
        require(escrow.credits(id, players[0]) == 1_900_000, "settled credit must not change");
        assertConserved(id);
    }

    function testPayoutsTransferExactAmountsAndDrainReserved() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        uint256 winnerBefore = token.balanceOf(players[0]);
        uint256 treasuryBefore = token.balanceOf(treasury);
        escrow.withdrawFor(id, players[0]);
        escrow.withdrawFor(id, treasury);
        require(token.balanceOf(players[0]) == winnerBefore + 1_900_000, "winner paid wrong amount");
        require(token.balanceOf(treasury) == treasuryBefore + 100_000, "treasury paid wrong amount");
        require(token.balanceOf(address(escrow)) == 0, "escrow must not retain pool tokens");
        require(escrow.totalReserved() == 0, "reserved must be zero after payout");
        assertConserved(id);
    }

    function testLoserPaysTheWinnerAndTreasuryExactlyOnce() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.winnerRecipient = players[1];
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        require(escrow.credits(id, players[1]) == 1_900_000, "second seat must be able to win");
        require(escrow.credits(id, players[0]) == 0, "loser must not keep a claim");
        require(escrow.credits(id, treasury) == 100_000, "treasury fee wrong");
    }

    function testForfeitPaysTheSameSplitAsFinished() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.outcomeType = 1;
        r.winnerRecipient = players[1];
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        require(escrow.credits(id, players[1]) == 1_900_000 && escrow.credits(id, treasury) == 100_000, "forfeit split wrong");
    }

    function testVoidRefundsBothEntriesWithNoTreasuryFee() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.outcomeType = 2;
        r.winnerRecipient = address(0);
        bytes memory sig = sign(r, SIGNER_KEY);
        escrow.submitResult(r, sig);
        require(escrow.credits(id, players[0]) == 1_000_000 && escrow.credits(id, players[1]) == 1_000_000, "both entries refunded");
        require(escrow.credits(id, treasury) == 0, "void carries no fee");
        vm.expectRevert();
        escrow.submitResult(r, sig);
        assertConserved(id);
    }

    function testVoidMustHaveNoWinnerAndSuccessMustHaveAnAssignedOne() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.outcomeType = 2;
        mustRevert(r);

        r = resultFor(id);
        r.winnerRecipient = address(0);
        mustRevert(r);

        r = resultFor(id);
        r.winnerRecipient = stranger;
        mustRevert(r);
    }

    /// @dev Overlapping roles must accumulate credits, never overwrite each other.
    function testTreasuryAsWinnerAccumulatesBothCredits() public {
        address[2] memory pair = [players[0], treasury];
        PaidDuelEscrowV2.DuelTerms memory t = PaidDuelEscrowV2.DuelTerms({
            salt: keccak256("treasury-duel"),
            players: pair,
            rulesetHash: RULES,
            signer: escrow.nextSigner(),
            signerEpoch: escrow.nextSignerEpoch(),
            fundingDeadline: uint64(block.timestamp + 10 minutes)
        });
        token.mint(treasury, 10_000_000);
        vm.prank(treasury);
        token.approve(address(escrow), type(uint256).max);
        bytes32 id = escrow.previewDuelId(t);
        vm.prank(players[0]);
        escrow.createAndFundDuel(t);
        vm.prank(treasury);
        escrow.fundDuel(id);

        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.participantB = treasury;
        r.winnerRecipient = treasury;
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        require(escrow.credits(id, treasury) == 2_000_000, "winner award and fee must accumulate");
        assertConserved(id);
    }

    // --------------------------------------------------------- signature binding

    function testEverySignedFieldIsBound() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory base = resultFor(id);
        bytes32 baseHash = escrow.hashResult(base);
        bytes memory sig = sign(base, SIGNER_KEY);
        bytes32 otherId = createActive(keccak256("second-duel"));
        vm.warp(block.timestamp + 2);
        for (uint8 field = 0; field < 14; field++) {
            // Memory-to-memory assignment aliases structs. Decode a fresh copy so each
            // negative control changes exactly one field and leaves the positive control intact.
            PaidDuelEscrowV2.Result memory r = abi.decode(abi.encode(base), (PaidDuelEscrowV2.Result));
            if (field == 0) r.recordId = otherId;
            else if (field == 1) r.matchId = keccak256("other-slot");
            else if (field == 2) r.stage = 1;
            else if (field == 3) r.participantA = players[1];
            else if (field == 4) r.participantB = players[0];
            else if (field == 5) r.winnerRecipient = players[1];
            else if (field == 6) r.outcomeType = 1;
            else if (field == 7) r.termsHash = keccak256("other-terms");
            else if (field == 8) r.rulesetHash = keccak256("other-rules");
            else if (field == 9) r.replayHash = keccak256("other-replay");
            else if (field == 10) r.finishedAt = base.finishedAt + 1;
            else if (field == 11) r.resultSequence = 2;
            else if (field == 12) r.signerEpoch = base.signerEpoch + 1;
            else r.expiresAt = base.expiresAt - 1;
            require(escrow.hashResult(r) != baseHash, "signed field omitted from digest");
            vm.expectRevert();
            escrow.submitResult(r, sig);
            require(escrow.getDuel(id).state == PaidDuelEscrowV2.State.Active, "invalid result changed state");
        }

        // Nothing above consumed or mutated the record: the genuine result still settles it.
        escrow.submitResult(base, sig);
        require(escrow.credits(id, players[0]) == 1_900_000, "genuine result must still settle");
    }

    function testSignatureIsBoundToChainAndToThisEscrow() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        bytes memory sig = sign(r, SIGNER_KEY);

        vm.chainId(10143);
        vm.expectRevert();
        escrow.submitResult(r, sig);
        vm.chainId(CHAIN);

        // Same signer, same terms salt, different escrow address: another valid world.
        PaidDuelEscrowV2 twin = new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, vm.addr(SIGNER_KEY), treasury, 500, address(this));
        vm.prank(players[0]);
        token.approve(address(twin), type(uint256).max);
        vm.prank(players[1]);
        token.approve(address(twin), type(uint256).max);
        PaidDuelEscrowV2.DuelTerms memory t = terms(SALT);
        vm.prank(players[0]);
        twin.createAndFundDuel(t);
        bytes32 twinId = twin.previewDuelId(t);
        vm.prank(players[1]);
        twin.fundDuel(twinId);
        require(twinId != id, "different escrows must derive different record ids");

        // Positive control: the twin settles its own mirror record with its own signature.
        PaidDuelEscrowV2.Result memory twinResult = resultForOn(twin, twinId);
        // Keep all message fields valid for the receiving escrow and change only the domain.
        bytes memory wrongDomainSig = signOn(escrow, twinResult, SIGNER_KEY);
        vm.expectRevert(bytes("unauthorized signer"));
        twin.submitResult(twinResult, wrongDomainSig);
        bytes memory twinSig = signOn(twin, twinResult, SIGNER_KEY);
        twin.submitResult(twinResult, twinSig);
        require(twin.credits(twinId, players[0]) == 1_900_000, "twin world must be self-consistent");

        // Neither world accepts the other's signature.
        vm.expectRevert();
        escrow.submitResult(twinResult, twinSig);
        vm.expectRevert();
        twin.submitResult(r, sig);

        escrow.submitResult(r, sig);
        require(escrow.credits(id, players[0]) == 1_900_000, "bound signature must settle");
    }

    function testWrongSignerIsRejected() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        bytes memory sig = sign(r, OTHER_KEY);
        vm.expectRevert();
        escrow.submitResult(r, sig);
    }

    function testMalformedSignatureIsRejected() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        vm.expectRevert();
        escrow.submitResult(r, hex"00");
        vm.expectRevert();
        escrow.submitResult(r, new bytes(65));
    }

    function testResultExpiryAndSettlementDeadlineAreEnforced() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        bytes memory sig = sign(r, SIGNER_KEY);
        vm.warp(escrow.getDuel(id).settlementDeadline + 1);
        vm.expectRevert();
        escrow.submitResult(r, sig);
        require(escrow.credits(id, players[0]) == 0, "late result must not allocate");
    }

    function testFinishTimeOutsideThePlayWindowIsRejected() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Duel memory d = escrow.getDuel(id);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.finishedAt = d.lockedAt - 1;
        mustRevert(r);
        r = resultFor(id);
        r.finishedAt = d.playDeadline + 1;
        mustRevert(r);
        r = resultFor(id);
        r.finishedAt = uint64(block.timestamp + 1);
        mustRevert(r);
    }

    // ------------------------------------------------------------------- pauses

    function testIntakePauseBlocksNewMoneyButNeverTrapsIt() public {
        bytes32 id = createFunded(SALT);
        vm.prank(guardian);
        escrow.pauseIntake();

        vm.prank(players[1]);
        vm.expectRevert();
        escrow.fundDuel(id);
        PaidDuelEscrowV2.DuelTerms memory t = terms(keccak256("blocked-create"));
        vm.prank(players[1]);
        vm.expectRevert();
        escrow.createAndFundDuel(t);

        // Money already inside must still be recoverable while intake is paused.
        vm.prank(players[0]);
        escrow.cancelFunding(id);
        escrow.withdrawFor(id, players[0]);
        require(escrow.totalReserved() == 0, "cancel and withdrawal must survive an intake pause");
    }

    function testResultsPauseBlocksSignaturesButNotRefundsOrWithdrawals() public {
        bytes32 id = createActive(SALT);
        vm.prank(guardian);
        escrow.pauseResults();
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        mustRevert(r);

        vm.warp(escrow.getDuel(id).settlementDeadline + 1);
        vm.prank(stranger);
        escrow.refundExpired(id);
        escrow.withdrawFor(id, players[0]);
        escrow.withdrawFor(id, players[1]);
        require(token.balanceOf(address(escrow)) == 0, "refunds must survive a results pause");
        require(escrow.credits(id, treasury) == 0, "no fee while paused");
    }

    function testOnlyGuardianOrOwnerPausesAndOnlyOwnerUnpauses() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.pauseIntake();
        vm.prank(stranger);
        vm.expectRevert();
        escrow.pauseResults();

        vm.prank(guardian);
        escrow.pauseIntake();
        vm.prank(guardian);
        vm.expectRevert();
        escrow.unpauseIntake();
        escrow.unpauseIntake();
        require(!escrow.intakePaused(), "owner must be able to unpause");
    }

    // ------------------------------------------------------------------- signer

    function testSignerRevocationBlocksResultsAndOpensRefunds() public {
        bytes32 id = createActive(SALT);
        bytes32 openId = createFunded(keccak256("open-while-revoked"));
        vm.prank(guardian);
        escrow.revokeSigner(escrow.nextSigner());

        PaidDuelEscrowV2.Result memory r = resultFor(id);
        mustRevert(r);

        vm.prank(stranger);
        escrow.refundRevoked(id);
        require(escrow.credits(id, players[0]) == 1_000_000 && escrow.credits(id, players[1]) == 1_000_000, "both entries released");

        vm.prank(stranger);
        escrow.refundRevoked(openId);
        require(escrow.credits(openId, players[0]) == 1_000_000, "partial deposit released");
        require(escrow.credits(openId, players[1]) == 0, "unfunded seat must not be refunded");
        assertConserved(id);
        assertConserved(openId);
    }

    function testRevokedSignerCannotReceiveNewDeposits() public {
        bytes32 id = createFunded(SALT);
        vm.prank(guardian);
        escrow.revokeSigner(escrow.nextSigner());
        vm.prank(players[1]);
        vm.expectRevert();
        escrow.fundDuel(id);
    }

    function testRevokedSignerCannotCreateNewFundedRecords() public {
        PaidDuelEscrowV2.DuelTerms memory t = terms(SALT);
        escrow.revokeSigner(t.signer);
        uint256 balance = token.balanceOf(players[0]);
        vm.prank(players[0]);
        vm.expectRevert(bytes("signer revoked"));
        escrow.createAndFundDuel(t);
        require(token.balanceOf(players[0]) == balance && escrow.totalReserved() == 0, "revoked signer accepted money");
        vm.expectRevert(bytes("signer revoked"));
        escrow.setNextSigner(t.signer);
    }

    function testOwnershipCannotBeRenouncedDuringPause() public {
        escrow.pauseIntake();
        escrow.pauseResults();
        vm.expectRevert(bytes("ownership renunciation disabled"));
        escrow.renounceOwnership();
        require(escrow.owner() == address(this), "pause recovery owner lost");
        escrow.unpauseIntake();
        escrow.unpauseResults();
    }

    function testDeploymentFeeMustMatchFixedFivePercentPolicy() public {
        address signer = vm.addr(SIGNER_KEY);
        vm.expectRevert(bytes("fee must be five percent"));
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, signer, treasury, 0, address(this));
        vm.expectRevert(bytes("fee must be five percent"));
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, signer, treasury, 1000, address(this));
    }

    function testEscrowCannotBeAssignedAsAPlayer() public {
        PaidDuelEscrowV2.DuelTerms memory t = terms(SALT);
        t.players[1] = address(escrow);
        vm.prank(players[0]);
        vm.expectRevert(bytes("escrow cannot participate"));
        escrow.createAndFundDuel(t);
    }

    function testOutgoingTransferUnderpaymentPreservesCredit() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        token.configure(false, true);
        uint256 balance = token.balanceOf(players[0]);
        vm.expectRevert(bytes("unsupported token transfer"));
        escrow.withdrawFor(id, players[0]);
        require(escrow.credits(id, players[0]) == 1_900_000, "underpayment consumed credit");
        require(token.balanceOf(players[0]) == balance && escrow.totalReserved() == 2_000_000, "underpayment did not roll back");
        assertConserved(id);
    }

    function testRevocationCannotUndoTerminalPayouts() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        uint256 awarded = escrow.credits(id, players[0]);

        vm.prank(stranger);
        vm.expectRevert();
        escrow.refundRevoked(id);
        vm.prank(guardian);
        escrow.revokeSigner(escrow.nextSigner());
        vm.prank(stranger);
        vm.expectRevert();
        escrow.refundRevoked(id);
        require(escrow.credits(id, players[0]) == awarded, "final payout must be untouched");
        escrow.withdrawFor(id, players[0]);
        escrow.withdrawFor(id, treasury);
        require(token.balanceOf(address(escrow)) == 0, "settled pool must remain payable after revocation");
    }

    function testRefundRevokedRequiresAnActualRevocation() public {
        bytes32 id = createActive(SALT);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.refundRevoked(id);
    }

    function testOnlyOwnerRotatesSignerAndExistingRecordsKeepTheirSnapshot() public {
        bytes32 id = createActive(SALT);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setNextSigner(stranger);

        escrow.setNextSigner(vm.addr(OTHER_KEY));
        require(escrow.getDuel(id).signer == vm.addr(SIGNER_KEY), "locked signer must not rotate");
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        require(escrow.credits(id, players[0]) == 1_900_000, "locked signer must remain authoritative");
    }

    // -------------------------------------------------------------- token quirks

    function testDonationsCreateSurplusButNoCredit() public {
        bytes32 id = createActive(SALT);
        token.mint(address(escrow), 5_000_000);
        require(escrow.totalReserved() == 2_000_000, "donation must not reserve");
        require(token.balanceOf(address(escrow)) == 7_000_000, "surplus held");
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        escrow.withdrawFor(id, players[0]);
        escrow.withdrawFor(id, treasury);
        require(escrow.credits(id, stranger) == 0, "donation must not become a claim");
        require(token.balanceOf(address(escrow)) == 5_000_000, "surplus stays stranded by design");
        vm.expectRevert();
        escrow.withdrawFor(id, stranger);
        assertConserved(id);
    }

    function testTransferFailureRetainsTheCredit() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        token.configure(true, false);
        vm.expectRevert();
        escrow.withdrawFor(id, players[0]);
        require(escrow.credits(id, players[0]) == 1_900_000, "credit must survive a failed transfer");
        require(escrow.totalReserved() == 2_000_000, "reserved must survive a failed transfer");
        token.configure(false, false);
        escrow.withdrawFor(id, players[0]);
        require(escrow.credits(id, players[0]) == 0, "retry must pay out");
    }

    function testFrozenRecipientKeepsCreditForLater() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        token.setFrozen(players[0], true);
        vm.expectRevert();
        escrow.withdrawFor(id, players[0]);
        require(escrow.credits(id, players[0]) == 1_900_000, "frozen transfer must retain credit");
        token.setFrozen(players[0], false);
        escrow.withdrawFor(id, players[0]);
        require(escrow.credits(id, players[0]) == 0, "credit released after unfreeze");
    }

    function testFeeOnTransferDepositIsRejected() public {
        MockUSDC fee = new MockUSDC();
        fee.configure(false, true);
        PaidDuelEscrowV2 e = new PaidDuelEscrowV2(IERC20(address(fee)), CHAIN, vm.addr(SIGNER_KEY), treasury, 500, address(this));
        fee.mint(players[0], 10_000_000);
        vm.prank(players[0]);
        fee.approve(address(e), type(uint256).max);
        PaidDuelEscrowV2.DuelTerms memory t = PaidDuelEscrowV2.DuelTerms({
            salt: SALT,
            players: players,
            rulesetHash: RULES,
            signer: e.nextSigner(),
            signerEpoch: e.nextSignerEpoch(),
            fundingDeadline: uint64(block.timestamp + 10 minutes)
        });
        vm.prank(players[0]);
        vm.expectRevert();
        e.createAndFundDuel(t);
        require(fee.balanceOf(address(e)) == 0, "a fee-on-transfer token must never leave value behind");
    }

    function testNonCircleTokenIsRefusedOnTheDeploymentChain() public {
        LookalikeUSDC fake = new LookalikeUSDC();
        vm.chainId(10143);
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(fake)), 10143, vm.addr(SIGNER_KEY), treasury, 500, address(this));
        vm.chainId(CHAIN);
    }

    function testConstructorRejectsWrongChainWrongDecimalsAndBadRoles() public {
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(token)), 1, vm.addr(SIGNER_KEY), treasury, 500, address(this));

        EighteenDecimalUSDC wrong = new EighteenDecimalUSDC();
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(wrong)), CHAIN, vm.addr(SIGNER_KEY), treasury, 500, address(this));

        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, address(0), treasury, 500, address(this));
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, vm.addr(SIGNER_KEY), address(0), 500, address(this));
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, vm.addr(SIGNER_KEY), treasury, 1001, address(this));
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, vm.addr(SIGNER_KEY), treasury, 500, address(0));

        // A token that cannot answer decimals() must be refused, not assumed.
        NoAnswerToken mute = new NoAnswerToken();
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(mute)), CHAIN, vm.addr(SIGNER_KEY), treasury, 500, address(this));
    }

    function testTreasuryCannotBeTheEscrowItself() public {
        // The deployment address is predictable before the CREATE runs.
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert();
        new PaidDuelEscrowV2(IERC20(address(token)), CHAIN, vm.addr(SIGNER_KEY), predicted, 500, address(this));
        require(predicted.code.length == 0, "the rejected deployment must not have been created");
    }

    // ----------------------------------------------------------------- authority

    function testNobodyCanRedirectACreditToAnArbitraryDestination() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(stranger);
            vm.expectRevert();
            escrow.withdrawFor(id, stranger);
        }
        vm.prank(stranger);
        escrow.withdrawFor(id, players[0]);
        require(token.balanceOf(stranger) == 0 && token.balanceOf(players[0]) >= 1_900_000, "payment must reach the bound recipient");
    }

    function testWithdrawForRequiresAnExistingCredit() public {
        bytes32 id = createActive(SALT);
        vm.expectRevert();
        escrow.withdrawFor(id, players[0]);
        vm.expectRevert();
        escrow.withdrawFor(keccak256("unknown"), players[0]);
    }

    function testOwnerHasNoDrainPath() public {
        bytes32 id = createActive(SALT);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        uint256 ownerBefore = token.balanceOf(address(this));
        uint256 escrowBefore = token.balanceOf(address(escrow));

        escrow.pauseIntake();
        escrow.pauseResults();
        escrow.setNextSigner(vm.addr(OTHER_KEY));
        escrow.setGuardian(address(this));
        escrow.unpauseIntake();
        escrow.unpauseResults();

        require(token.balanceOf(address(this)) == ownerBefore, "owner must not receive tokens");
        require(token.balanceOf(address(escrow)) == escrowBefore, "owner must not move escrow tokens");
        require(escrow.totalReserved() == 2_000_000, "reserved must be unchanged");
    }

    function testOwnershipTransferIsTwoStep() public {
        escrow.transferOwnership(stranger);
        require(escrow.owner() == address(this), "ownership must not move before acceptance");
        vm.prank(stranger);
        escrow.acceptOwnership();
        require(escrow.owner() == stranger, "pending owner must be able to accept");
        require(!escrow.intakePaused() && !escrow.resultsPaused(), "transfer must not change pause state");
    }

    function testFuzzOutcomeWithdrawalOrderAndDonationConserveMoney(uint96 rawDonation, uint8 rawOutcome, bool secondWins, bool winnerFirst) public {
        bytes32 id = createActive(SALT);
        uint256 donation = uint256(rawDonation) % 1_000_000_001;
        token.mint(address(escrow), donation);
        PaidDuelEscrowV2.Result memory r = resultFor(id);
        r.outcomeType = rawOutcome % 3;
        address winner = secondWins ? players[1] : players[0];
        r.winnerRecipient = r.outcomeType == 2 ? address(0) : winner;
        escrow.submitResult(r, sign(r, SIGNER_KEY));
        address a = r.outcomeType == 2 ? players[0] : winner;
        address b = r.outcomeType == 2 ? players[1] : treasury;
        uint256 expectedA = r.outcomeType == 2 ? 1_000_000 : 1_900_000;
        uint256 expectedB = r.outcomeType == 2 ? 1_000_000 : 100_000;
        require(escrow.credits(id, a) == expectedA && escrow.credits(id, b) == expectedB, "outcome allocated wrong amounts");
        uint256 balanceA = token.balanceOf(a);
        uint256 balanceB = token.balanceOf(b);
        escrow.withdrawFor(id, winnerFirst ? a : b);
        assertConserved(id);
        escrow.withdrawFor(id, winnerFirst ? b : a);
        require(token.balanceOf(a) == balanceA + expectedA && token.balanceOf(b) == balanceB + expectedB, "withdrawal order changed rights");
        require(token.balanceOf(address(escrow)) == donation && escrow.totalReserved() == 0, "donation subsidized a claim");
        (uint256 deposited, uint256 unallocated, uint256 outstanding, uint256 paid) = escrow.ledgerOf(id);
        require(deposited == 2_000_000 && paid == deposited && unallocated == 0 && outstanding == 0, "final money ledger wrong");
    }
}

/// @dev A contract with code but no decimals() at all.
contract NoAnswerToken {
    fallback() external {}
}
