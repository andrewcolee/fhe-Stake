import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, deployments, fhevm } from "hardhat";
import { EncryptedStaking } from "../types";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("EncryptedStakingSepolia", function () {
  let signers: Signers;
  let stakingContract: EncryptedStaking;
  let stakingAddress: string;

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const deployment = await deployments.get("EncryptedStaking");
      stakingAddress = deployment.address;
      stakingContract = await ethers.getContractAt("EncryptedStaking", stakingAddress);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  it("returns the configured initial grant", async function () {
    this.timeout(120000);

    const initialGrant = await stakingContract.getInitialGrant();
    expect(initialGrant).to.eq(1000);

    const [, , , lastTimestamp, claimed] = await stakingContract.getAccountState(signers.alice.address);
    console.log(`EncryptedStaking deployed at ${stakingAddress}`);
    console.log(`Last accrual timestamp for signer: ${lastTimestamp}`);
    console.log(`Has claimed initial grant        : ${claimed}`);
  });
});
