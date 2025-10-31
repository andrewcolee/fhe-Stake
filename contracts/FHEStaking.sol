// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title FHE staking manager for mUSDT balances
/// @notice Tracks user balances, stakes, and interest entirely over encrypted values
contract FHEStaking is SepoliaConfig {
    uint64 public constant INITIAL_GRANT = 1_000;

    mapping(address => euint64) private liquidBalances;
    mapping(address => euint64) private stakedBalances;
    mapping(address => euint64) private pendingInterest;
    mapping(address => uint256) private lastAccrualTimestamp;
    mapping(address => bool) private hasClaimed;

    event TokensClaimed(address indexed user, uint64 amount);
    event TokensStaked(address indexed user);
    event TokensUnstaked(address indexed user);
    event InterestClaimed(address indexed user, uint256 daysAccrued);

    /// @notice Grants the initial mUSDT balance to the caller (one-time action)
    function claimInitial() external {
        address user = msg.sender;
        require(!hasClaimed[user], "ALREADY_CLAIMED");

        euint64 grantAmount = FHE.asEuint64(INITIAL_GRANT);
        liquidBalances[user] = grantAmount;
        _allowValue(grantAmount, user);

        euint64 zeroValue = FHE.asEuint64(0);
        stakedBalances[user] = zeroValue;
        _allowValue(zeroValue, user);

        pendingInterest[user] = zeroValue;
        _allowValue(zeroValue, user);

        hasClaimed[user] = true;
        lastAccrualTimestamp[user] = block.timestamp;

        emit TokensClaimed(user, INITIAL_GRANT);
    }

    /// @notice Stakes an encrypted amount of mUSDT
    /// @param encryptedAmount Encrypted stake amount handle
    /// @param proof Input proof generated alongside the ciphertext
    function stake(externalEuint64 encryptedAmount, bytes calldata proof) external {
        address user = msg.sender;
        require(hasClaimed[user], "CLAIM_REQUIRED");

        _settleRewards(user);

        euint64 amount = FHE.fromExternal(encryptedAmount, proof);

        euint64 updatedBalance = FHE.sub(liquidBalances[user], amount);
        liquidBalances[user] = updatedBalance;
        _allowValue(updatedBalance, user);

        euint64 updatedStake = FHE.add(stakedBalances[user], amount);
        stakedBalances[user] = updatedStake;
        _allowValue(updatedStake, user);

        lastAccrualTimestamp[user] = block.timestamp;

        emit TokensStaked(user);
    }

    /// @notice Unstakes an encrypted amount of mUSDT back to the liquid balance
    /// @param encryptedAmount Encrypted amount to withdraw
    /// @param proof Input proof generated alongside the ciphertext
    function unstake(externalEuint64 encryptedAmount, bytes calldata proof) external {
        address user = msg.sender;
        require(hasClaimed[user], "CLAIM_REQUIRED");

        _settleRewards(user);

        euint64 amount = FHE.fromExternal(encryptedAmount, proof);

        euint64 updatedStake = FHE.sub(stakedBalances[user], amount);
        stakedBalances[user] = updatedStake;
        _allowValue(updatedStake, user);

        euint64 updatedBalance = FHE.add(liquidBalances[user], amount);
        liquidBalances[user] = updatedBalance;
        _allowValue(updatedBalance, user);

        lastAccrualTimestamp[user] = block.timestamp;

        emit TokensUnstaked(user);
    }

    /// @notice Claims accumulated interest, moving it into the liquid balance
    function claimInterest() external {
        address user = msg.sender;
        require(hasClaimed[user], "CLAIM_REQUIRED");

        uint256 daysAccrued = _settleRewards(user);

        euint64 rewards = pendingInterest[user];

        euint64 updatedBalance = FHE.add(liquidBalances[user], rewards);
        liquidBalances[user] = updatedBalance;
        _allowValue(updatedBalance, user);

        euint64 zeroValue = FHE.asEuint64(0);
        pendingInterest[user] = zeroValue;
        _allowValue(zeroValue, user);

        lastAccrualTimestamp[user] = block.timestamp;

        emit InterestClaimed(user, daysAccrued);
    }

    /// @notice Returns the full encrypted state for a user
    /// @param user Address whose data is requested
    /// @return liquid Current encrypted liquid balance
    /// @return staked Current encrypted staked amount
    /// @return rewards Current encrypted pending interest
    /// @return lastTimestamp Timestamp when rewards were last updated
    /// @return claimed Whether the user already claimed their initial grant
    function getAccountState(address user)
        external
        view
        returns (euint64 liquid, euint64 staked, euint64 rewards, uint256 lastTimestamp, bool claimed)
    {
        return (liquidBalances[user], stakedBalances[user], pendingInterest[user], lastAccrualTimestamp[user], hasClaimed[user]);
    }

    /// @notice Exposes whether an address has already claimed the initial grant
    function hasUserClaimed(address user) external view returns (bool) {
        return hasClaimed[user];
    }

    /// @notice Returns the timestamp of the last accrual checkpoint for an address
    function getLastAccrualTimestamp(address user) external view returns (uint256) {
        return lastAccrualTimestamp[user];
    }

    /// @notice Returns the initial grant amount available to each user
    function getInitialGrant() external pure returns (uint64) {
        return INITIAL_GRANT;
    }

    function _settleRewards(address user) private returns (uint256) {
        uint256 lastTimestamp = lastAccrualTimestamp[user];
        if (lastTimestamp == 0) {
            lastAccrualTimestamp[user] = block.timestamp;
            return 0;
        }

        uint256 elapsedDays = (block.timestamp - lastTimestamp) / 1 days;
        if (elapsedDays == 0) {
            return 0;
        }

        euint64 stakeAmount = stakedBalances[user];
        euint64 daysCount = FHE.asEuint64(uint64(elapsedDays));
        euint64 accrued = FHE.mul(stakeAmount, daysCount);
        accrued = FHE.div(accrued, 100);

        euint64 updatedRewards = FHE.add(pendingInterest[user], accrued);
        pendingInterest[user] = updatedRewards;
        _allowValue(updatedRewards, user);

        lastAccrualTimestamp[user] = lastTimestamp + (elapsedDays * 1 days);

        return elapsedDays;
    }

    function _allowValue(euint64 value, address user) private {
        FHE.allowThis(value);
        FHE.allow(value, user);
    }
}
