import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

const CONTRACT_NAME = "EncryptedStaking";

task("task:address", "Prints the EncryptedStaking address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;

  const staking = await deployments.get(CONTRACT_NAME);

  console.log(`${CONTRACT_NAME} address is ${staking.address}`);
});

task("task:claim-initial", "Calls claimInitial() for the first signer")
  .addOptionalParam("address", "Optionally specify the contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get(CONTRACT_NAME);
    console.log(`${CONTRACT_NAME}: ${deployment.address}`);

    const signers = await ethers.getSigners();

    const stakingContract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);

    const tx = await stakingContract.connect(signers[0]).claimInitial();
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:stake", "Stake an encrypted amount of mUSDT")
  .addParam("value", "Plain amount to encrypt and stake")
  .addOptionalParam("address", "Optionally specify the contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const value = BigInt(taskArguments.value);
    if (value < 0n) {
      throw new Error(`Argument --value must be positive`);
    }

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get(CONTRACT_NAME);
    console.log(`${CONTRACT_NAME}: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const stakingContract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);

    const encryptedValue = await fhevm
      .createEncryptedInput(deployment.address, signers[0].address)
      .add64(value)
      .encrypt();

    const tx = await stakingContract
      .connect(signers[0])
      .stake(encryptedValue.handles[0], encryptedValue.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:unstake", "Unstake an encrypted amount of mUSDT")
  .addParam("value", "Plain amount to encrypt and unstake")
  .addOptionalParam("address", "Optionally specify the contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const value = BigInt(taskArguments.value);
    if (value < 0n) {
      throw new Error(`Argument --value must be positive`);
    }

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get(CONTRACT_NAME);
    console.log(`${CONTRACT_NAME}: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const stakingContract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);

    const encryptedValue = await fhevm
      .createEncryptedInput(deployment.address, signers[0].address)
      .add64(value)
      .encrypt();

    const tx = await stakingContract
      .connect(signers[0])
      .unstake(encryptedValue.handles[0], encryptedValue.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:claim-interest", "Calls claimInterest() to realize rewards")
  .addOptionalParam("address", "Optionally specify the contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get(CONTRACT_NAME);
    console.log(`${CONTRACT_NAME}: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const stakingContract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);

    const tx = await stakingContract.connect(signers[0]).claimInterest();
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:decrypt-state", "Decrypts the stored state for a user")
  .addOptionalParam("user", "Address to inspect (defaults to first signer)")
  .addOptionalParam("address", "Optionally specify the contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get(CONTRACT_NAME);
    console.log(`${CONTRACT_NAME}: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const target = taskArguments.user ? taskArguments.user : signers[0].address;

    const stakingContract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);

    const [liquid, staked, rewards, lastTimestamp, claimed] = await stakingContract.getAccountState(target);

    const liquidClear = await fhevm.userDecryptEuint(FhevmType.euint64, liquid, deployment.address, signers[0]);
    const stakedClear = await fhevm.userDecryptEuint(FhevmType.euint64, staked, deployment.address, signers[0]);
    const rewardsClear = await fhevm.userDecryptEuint(FhevmType.euint64, rewards, deployment.address, signers[0]);

    console.log(`State for ${target}`);
    console.log(`  Claimed initial grant : ${claimed}`);
    console.log(`  Last accrual timestamp: ${lastTimestamp}`);
    console.log(`  Liquid balance        : ${liquidClear}`);
    console.log(`  Staked balance        : ${stakedClear}`);
    console.log(`  Pending interest      : ${rewardsClear}`);
  });
