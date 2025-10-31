import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ethers, fhevm } from "hardhat";
import { EncryptedStaking, EncryptedStaking__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("EncryptedStaking")) as EncryptedStaking__factory;
  const stakingContract = (await factory.deploy()) as EncryptedStaking;
  const stakingAddress = await stakingContract.getAddress();

  return { stakingContract, stakingAddress };
}

describe("EncryptedStaking", function () {
  let signers: Signers;
  let stakingContract: EncryptedStaking;
  let stakingAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ stakingContract, stakingAddress } = await deployFixture());
  });

  async function decrypt(value: string, signer: HardhatEthersSigner) {
    return fhevm.userDecryptEuint(FhevmType.euint64, value, stakingAddress, signer);
  }

  it("grants the initial encrypted balance once", async function () {
    await stakingContract.connect(signers.alice).claimInitial();

    const [liquid, staked, rewards, lastTimestamp, claimed] = await stakingContract.getAccountState(signers.alice.address);

    const liquidClear = await decrypt(liquid, signers.alice);
    const stakedClear = await decrypt(staked, signers.alice);
    const rewardsClear = await decrypt(rewards, signers.alice);

    expect(liquidClear).to.eq(1000n);
    expect(stakedClear).to.eq(0n);
    expect(rewardsClear).to.eq(0n);
    expect(lastTimestamp).to.be.gt(0);
    expect(claimed).to.eq(true);

    await expect(stakingContract.connect(signers.alice).claimInitial()).to.be.revertedWith("ALREADY_CLAIMED");
  });

  it("updates balances correctly when staking and unstaking", async function () {
    await stakingContract.connect(signers.alice).claimInitial();

    const stakeAmount = 250n;
    const encryptedStake = await fhevm
      .createEncryptedInput(stakingAddress, signers.alice.address)
      .add64(stakeAmount)
      .encrypt();

    await stakingContract
      .connect(signers.alice)
      .stake(encryptedStake.handles[0], encryptedStake.inputProof);

    const stateAfterStake = await stakingContract.getAccountState(signers.alice.address);
    const liquidAfterStake = await decrypt(stateAfterStake[0], signers.alice);
    const stakedAfterStake = await decrypt(stateAfterStake[1], signers.alice);

    expect(liquidAfterStake).to.eq(1000n - stakeAmount);
    expect(stakedAfterStake).to.eq(stakeAmount);

    const encryptedUnstake = await fhevm
      .createEncryptedInput(stakingAddress, signers.alice.address)
      .add64(stakeAmount)
      .encrypt();

    await stakingContract
      .connect(signers.alice)
      .unstake(encryptedUnstake.handles[0], encryptedUnstake.inputProof);

    const stateAfterUnstake = await stakingContract.getAccountState(signers.alice.address);
    const liquidAfterUnstake = await decrypt(stateAfterUnstake[0], signers.alice);
    const stakedAfterUnstake = await decrypt(stateAfterUnstake[1], signers.alice);

    expect(liquidAfterUnstake).to.eq(1000n);
    expect(stakedAfterUnstake).to.eq(0n);
  });

  it("accrues 1% daily interest on staked balances", async function () {
    await stakingContract.connect(signers.alice).claimInitial();

    const stakeAmount = 500n;
    const encryptedStake = await fhevm
      .createEncryptedInput(stakingAddress, signers.alice.address)
      .add64(stakeAmount)
      .encrypt();

    await stakingContract
      .connect(signers.alice)
      .stake(encryptedStake.handles[0], encryptedStake.inputProof);

    await time.increase(3 * 24 * 60 * 60);

    await stakingContract.connect(signers.alice).claimInterest();

    const [liquid, staked, rewards] = await stakingContract.getAccountState(signers.alice.address);

    const liquidClear = await decrypt(liquid, signers.alice);
    const stakedClear = await decrypt(staked, signers.alice);
    const rewardsClear = await decrypt(rewards, signers.alice);

    const expectedInterest = (stakeAmount * 3n) / 100n;

    expect(liquidClear).to.eq(1000n - stakeAmount + expectedInterest);
    expect(stakedClear).to.eq(stakeAmount);
    expect(rewardsClear).to.eq(0n);
  });
});
