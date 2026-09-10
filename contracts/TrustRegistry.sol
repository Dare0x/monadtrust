// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TrustRegistry — on-chain, tamper-evident reputation attestations for Monad
/// @author MonadTrust
/// @notice A minimal, permissionless registry that anchors off-chain-computed
///         trust scores on-chain so that wallets, agents and other contracts can
///         read a portable reputation signal for any address.
///
/// @dev Design principles (aligned with the MonadTrust off-chain scorer):
///
///  1. The *score itself* is always computed off-chain by a deterministic,
///     open-source engine that reads only public chain data — no LLM, no
///     hidden inputs. This contract never invents a score; it only records
///     one an attester chose to publish.
///
///  2. Each attestation commits to a `metricsHash` = keccak256 over the exact
///     canonical metric breakdown that produced the score. Anyone can re-run
///     the open engine against the same chain state, recompute the hash, and
///     verify the attestation was not fabricated or altered. Tamper-evident.
///
///  3. It is permissionless and non-custodial. Anyone may attest about any
///     subject; attestations are namespaced by attester, so readers decide
///     which attester(s) they trust rather than trusting a single admin. There
///     is no owner, no upgrade key, and no way to delete history — events form
///     an append-only log.
///
/// This is intentionally small and dependency-free so it is cheap to deploy on
/// testnet and easy to audit line-by-line.
contract TrustRegistry {
    /// @notice Human-friendly trust bands, mirroring the off-chain engine.
    enum Band {
        New, // 0 - no/insufficient history
        Low, // 1
        Medium, // 2
        High // 3
    }

    /// @notice A single published trust attestation.
    /// @param score       0–100 trust score from the off-chain engine.
    /// @param band        Bucketed band (see Band).
    /// @param metricsHash keccak256 commitment to the canonical metric detail.
    /// @param timestamp   Block timestamp when the attestation was recorded.
    /// @param exists      Distinguishes "never attested" from a real zero score.
    struct Attestation {
        uint8 score;
        Band band;
        bytes32 metricsHash;
        uint64 timestamp;
        bool exists;
    }

    /// @dev attester => subject => latest attestation.
    mapping(address => mapping(address => Attestation)) private _attestations;

    /// @notice Total number of attestations ever recorded (for indexing/UX).
    uint256 public totalAttestations;

    /// @notice Emitted on every attestation. The append-only history lives in
    ///         these logs; the mapping only keeps the latest per (attester, subject).
    event Attested(
        address indexed attester,
        address indexed subject,
        uint8 score,
        Band band,
        bytes32 metricsHash,
        uint64 timestamp
    );

    error ScoreOutOfRange(uint8 score);
    error ZeroSubject();

    /// @notice Publish (or overwrite your own latest) trust attestation about `subject`.
    /// @dev Reverts if the score exceeds 100 or the subject is the zero address.
    ///      `msg.sender` is the attester — you can only ever write under your
    ///      own namespace, never impersonate another attester.
    /// @param subject     The address the attestation is about.
    /// @param score       0–100 trust score.
    /// @param band        Bucketed band consistent with `score`.
    /// @param metricsHash keccak256 of the canonical metric breakdown JSON.
    function attest(
        address subject,
        uint8 score,
        Band band,
        bytes32 metricsHash
    ) external {
        if (score > 100) revert ScoreOutOfRange(score);
        if (subject == address(0)) revert ZeroSubject();

        Attestation storage prev = _attestations[msg.sender][subject];
        if (!prev.exists) {
            // Only count first-time (attester, subject) pairs toward the total.
            totalAttestations += 1;
        }

        _attestations[msg.sender][subject] = Attestation({
            score: score,
            band: band,
            metricsHash: metricsHash,
            timestamp: uint64(block.timestamp),
            exists: true
        });

        emit Attested(
            msg.sender,
            subject,
            score,
            band,
            metricsHash,
            uint64(block.timestamp)
        );
    }

    /// @notice Read the latest attestation `attester` made about `subject`.
    /// @return found Whether such an attestation exists.
    /// @return attestation The stored attestation (zeroed if not found).
    function getAttestation(address attester, address subject)
        external
        view
        returns (bool found, Attestation memory attestation)
    {
        Attestation memory a = _attestations[attester][subject];
        return (a.exists, a);
    }

    /// @notice Convenience: has `attester` ever attested about `subject`?
    function hasAttestation(address attester, address subject)
        external
        view
        returns (bool)
    {
        return _attestations[attester][subject].exists;
    }
}
