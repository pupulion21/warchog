// SPDX-License-Identifier: MIT
pragma solidity ^0.8.38;

/// @notice Per-record pull-credit ledger shared by both escrows.
/// @dev This library moves numbers only. Custody stays in the calling contract:
///      each escrow holds its own token balance and its own `totalReserved`.
///      Invariant for every record: totalDeposited == unallocated + outstanding + totalPaid.
library EscrowAccounting {
    struct Record {
        uint256 totalDeposited; // tokens actually received for this record
        uint256 unallocated; // received tokens not yet owned by any recipient
        uint256 outstanding; // allocated credit not yet transferred out
        uint256 totalPaid; // credit already transferred out
    }

    function deposit(Record storage r, uint256 amount) internal {
        r.totalDeposited += amount;
        r.unallocated += amount;
    }

    /// @dev Allocation never changes the total a record owes; it only names an owner.
    function allocate(Record storage r, uint256 amount) internal {
        r.unallocated -= amount;
        r.outstanding += amount;
    }

    function settle(Record storage r, uint256 amount) internal {
        r.outstanding -= amount;
        r.totalPaid += amount;
    }

    function owed(Record storage r) internal view returns (uint256) {
        return r.unallocated + r.outstanding;
    }

    function conserved(Record storage r) internal view returns (bool) {
        return r.totalDeposited == r.unallocated + r.outstanding + r.totalPaid;
    }
}
