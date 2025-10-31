import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract } from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { Header } from './Header';
import '../styles/StakingApp.css';

type DecryptedState = {
  balance: bigint;
  staked: bigint;
  interest: bigint;
};

type ActionState = {
  claim: boolean;
  stake: boolean;
  unstake: boolean;
  interest: boolean;
};

type AccountStateResult = readonly [string, string, string, bigint, boolean];

// const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const initialActions: ActionState = {
  claim: false,
  stake: false,
  unstake: false,
  interest: false,
};

function formatBigint(value: bigint | null) {
  if (value === null) return '--';
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatTimestamp(timestamp: bigint | null) {
  if (!timestamp || timestamp === 0n) {
    return '—';
  }

  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString();
}

function calculateProjectedInterest(state: DecryptedState | null, extraDays: number) {
  if (!state || extraDays <= 0) {
    return state?.interest ?? null;
  }

  const accrued = (state.staked * BigInt(extraDays)) / 100n;
  return state.interest + accrued;
}

export function StakingApp() {
  const { address, isConnected } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner();

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [actions, setActions] = useState<ActionState>(initialActions);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decryptedState, setDecryptedState] = useState<DecryptedState | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const contractConfigured = true;

  const {
    data: accountData,
    refetch: refetchAccount,
    isPending: accountPending,
  } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: 'getAccountState',
    args: address && contractConfigured ? [address] : undefined,
    query: {
      enabled: Boolean(address && contractConfigured),
    },
  });

  const { data: initialGrant } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: 'getInitialGrant',
    query: {
      enabled: contractConfigured,
    },
  });

  const typedAccount = accountData as AccountStateResult | undefined;
  const hasClaimed = typedAccount ? typedAccount[4] : false;
  const lastAccrualTimestamp = typedAccount ? typedAccount[3] : 0n;

  const daysSinceAccrual = useMemo(() => {
    if (!typedAccount || typedAccount[3] === 0n) {
      return 0;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const diff = nowSeconds - Number(typedAccount[3]);
    return diff > 0 ? Math.floor(diff / 86_400) : 0;
  }, [typedAccount]);

  useEffect(() => {
    if (!instance || !address || !typedAccount || !contractConfigured || !signerPromise) {
      return;
    }

    const handles = typedAccount.slice(0, 3) as string[];
    if (handles.every((handle) => handle === '0x' || /^0x0+$/i.test(handle))) {
      setDecryptedState({ balance: 0n, staked: 0n, interest: 0n });
      return;
    }

    let cancelled = false;

    const decrypt = async () => {
      setIsDecrypting(true);
      setDecryptError(null);

      try {
        const keypair = instance.generateKeypair();
        const contractAddresses = [CONTRACT_ADDRESS];
        const startTimeStamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = '10';

        const handleContractPairs = handles.map((handle) => ({
          handle,
          contractAddress: CONTRACT_ADDRESS,
        }));

        const eip712 = instance.createEIP712(
          keypair.publicKey,
          contractAddresses,
          startTimeStamp,
          durationDays
        );

        const signer = await signerPromise;
        if (!signer) {
          throw new Error('Signer not available');
        }

        const signature = await signer.signTypedData(
          eip712.domain,
          { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
          eip712.message
        );

        const result = await instance.userDecrypt(
          handleContractPairs,
          keypair.privateKey,
          keypair.publicKey,
          signature.replace('0x', ''),
          contractAddresses,
          address,
          startTimeStamp,
          durationDays
        );

        if (cancelled) {
          return;
        }

        const balance = BigInt(result[handles[0]] ?? '0');
        const staked = BigInt(result[handles[1]] ?? '0');
        const interest = BigInt(result[handles[2]] ?? '0');

        setDecryptedState({ balance, staked, interest });
      } catch (error) {
        console.error('Decryption failed:', error);
        if (!cancelled) {
          setDecryptedState(null);
          setDecryptError(error instanceof Error ? error.message : 'Unable to decrypt balances');
        }
      } finally {
        if (!cancelled) {
          setIsDecrypting(false);
        }
      }
    };

    decrypt();

    return () => {
      cancelled = true;
    };
  }, [instance, address, typedAccount, signerPromise, contractConfigured]);

  const projectedInterest = useMemo(
    () => calculateProjectedInterest(decryptedState, daysSinceAccrual),
    [decryptedState, daysSinceAccrual]
  );

  const resetFeedback = () => {
    setFeedback(null);
  };

  const handleClaimInitial = async () => {
    if (!contractConfigured) {
      setFeedback('Contract address is not configured. Deploy the contract and update the dApp.');
      return;
    }

    if (!signerPromise) {
      setFeedback('Connect your wallet to claim mUSDT.');
      return;
    }

    setActions((prev) => ({ ...prev, claim: true }));
    resetFeedback();

    try {
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.claimInitial();
      await tx.wait();

      setFeedback('Initial mUSDT claimed successfully.');
      await refetchAccount?.();
    } catch (error) {
      console.error('Claim failed:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to claim initial mUSDT');
    } finally {
      setActions((prev) => ({ ...prev, claim: false }));
    }
  };

  const encryptAmount = async (amount: bigint) => {
    if (!instance || !address) {
      throw new Error('Encryption service is not ready');
    }

    const input = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
    input.add64(amount);
    return input.encrypt();
  };

  const handleStake = async () => {
    if (!contractConfigured) {
      setFeedback('Contract address is not configured. Deploy the contract and update the dApp.');
      return;
    }

    if (!stakeAmount) {
      setFeedback('Enter an amount to stake.');
      return;
    }

    let value: bigint;
    try {
      value = BigInt(stakeAmount);
    } catch (error) {
      setFeedback('Invalid stake amount. Use whole numbers only.');
      return;
    }

    if (value <= 0n) {
      setFeedback('Stake amount must be greater than zero.');
      return;
    }

    if (!signerPromise) {
      setFeedback('Connect your wallet before staking.');
      return;
    }

    setActions((prev) => ({ ...prev, stake: true }));
    resetFeedback();

    try {
      const encryption = await encryptAmount(value);
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.stake(encryption.handles[0], encryption.inputProof);
      await tx.wait();

      setStakeAmount('');
      setFeedback('Stake successful.');
      await refetchAccount?.();
    } catch (error) {
      console.error('Stake failed:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to stake mUSDT');
    } finally {
      setActions((prev) => ({ ...prev, stake: false }));
    }
  };

  const handleUnstake = async () => {
    if (!contractConfigured) {
      setFeedback('Contract address is not configured. Deploy the contract and update the dApp.');
      return;
    }

    if (!unstakeAmount) {
      setFeedback('Enter an amount to unstake.');
      return;
    }

    let value: bigint;
    try {
      value = BigInt(unstakeAmount);
    } catch (error) {
      setFeedback('Invalid unstake amount. Use whole numbers only.');
      return;
    }

    if (value <= 0n) {
      setFeedback('Unstake amount must be greater than zero.');
      return;
    }

    if (!signerPromise) {
      setFeedback('Connect your wallet before unstaking.');
      return;
    }

    setActions((prev) => ({ ...prev, unstake: true }));
    resetFeedback();

    try {
      const encryption = await encryptAmount(value);
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.unstake(encryption.handles[0], encryption.inputProof);
      await tx.wait();

      setUnstakeAmount('');
      setFeedback('Unstake successful.');
      await refetchAccount?.();
    } catch (error) {
      console.error('Unstake failed:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to unstake mUSDT');
    } finally {
      setActions((prev) => ({ ...prev, unstake: false }));
    }
  };

  const handleClaimInterest = async () => {
    if (!contractConfigured) {
      setFeedback('Contract address is not configured. Deploy the contract and update the dApp.');
      return;
    }

    if (!signerPromise) {
      setFeedback('Connect your wallet to claim interest.');
      return;
    }

    setActions((prev) => ({ ...prev, interest: true }));
    resetFeedback();

    try {
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.claimInterest();
      await tx.wait();

      setFeedback('Interest claimed successfully.');
      await refetchAccount?.();
    } catch (error) {
      console.error('Claim interest failed:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to claim interest');
    } finally {
      setActions((prev) => ({ ...prev, interest: false }));
    }
  };

  const renderConnectionState = () => {
    if (!contractConfigured) {
      return (
        <div className="staking-notice warning">
          The contract address is not configured. Deploy the EncryptedStaking contract and update the configuration in
          <code>config/contracts.ts</code>.
        </div>
      );
    }

    if (!isConnected) {
      return <div className="staking-notice">Connect your wallet to manage your encrypted mUSDT balances.</div>;
    }

    if (zamaLoading || accountPending) {
      return <div className="staking-notice">Loading encrypted account data…</div>;
    }

    if (zamaError) {
      return <div className="staking-notice error">{zamaError}</div>;
    }

    if (decryptError) {
      return <div className="staking-notice error">{decryptError}</div>;
    }

    return null;
  };

  const notice = renderConnectionState();

  return (
    <div className="staking-app">
      <Header />
      {notice}

      <section className="staking-section">
        <div className="section-header">
          <h2>Account Overview</h2>
          {initialGrant !== undefined && (
            <span className="initial-grant">Initial grant: {initialGrant.toString()} mUSDT</span>
          )}
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-label">Liquid balance</span>
            <span className="metric-value">{formatBigint(decryptedState?.balance ?? null)} mUSDT</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Staked balance</span>
            <span className="metric-value">{formatBigint(decryptedState?.staked ?? null)} mUSDT</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Pending interest</span>
            <span className="metric-value">{formatBigint(decryptedState?.interest ?? null)} mUSDT</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Projected interest</span>
            <span className="metric-value">{formatBigint(projectedInterest ?? null)} mUSDT</span>
          </div>
        </div>

        <div className="metadata-grid">
          <div className="metadata-item">
            <span className="metadata-label">Last accrual update</span>
            <span className="metadata-value">{formatTimestamp(lastAccrualTimestamp)}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Full days since update</span>
            <span className="metadata-value">{daysSinceAccrual}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Initial grant claimed</span>
            <span className="metadata-value">{hasClaimed ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </section>

      <section className="staking-section">
        <h2>Actions</h2>

        {!hasClaimed && (
          <div className="action-card">
            <div>
              <h3>Claim initial mUSDT</h3>
              <p>Receive your encrypted starting balance before staking.</p>
            </div>
            <button
              className="primary"
              onClick={handleClaimInitial}
              disabled={actions.claim || !isConnected || !contractConfigured}
            >
              {actions.claim ? 'Claiming…' : 'Claim'}
            </button>
          </div>
        )}

        <div className="action-grid">
          <div className="action-card">
            <div className="action-header">
              <h3>Stake mUSDT</h3>
              <p>Encrypt and stake tokens to earn 1% daily rewards.</p>
            </div>
            <div className="action-body">
              <input
                type="text"
                inputMode="numeric"
                pattern="^[0-9]*$"
                placeholder="Amount"
                value={stakeAmount}
                onChange={(event) => setStakeAmount(event.target.value.replace(/[^0-9]/g, ''))}
                disabled={!hasClaimed || actions.stake || !isConnected}
              />
              <button
                className="primary"
                onClick={handleStake}
                disabled={!hasClaimed || actions.stake || !isConnected || !contractConfigured}
              >
                {actions.stake ? 'Staking…' : 'Stake'}
              </button>
            </div>
          </div>

          <div className="action-card">
            <div className="action-header">
              <h3>Unstake mUSDT</h3>
              <p>Return staked tokens to your liquid balance.</p>
            </div>
            <div className="action-body">
              <input
                type="text"
                inputMode="numeric"
                pattern="^[0-9]*$"
                placeholder="Amount"
                value={unstakeAmount}
                onChange={(event) => setUnstakeAmount(event.target.value.replace(/[^0-9]/g, ''))}
                disabled={!hasClaimed || actions.unstake || !isConnected}
              />
              <button
                onClick={handleUnstake}
                disabled={!hasClaimed || actions.unstake || !isConnected || !contractConfigured}
              >
                {actions.unstake ? 'Unstaking…' : 'Unstake'}
              </button>
            </div>
          </div>

          <div className="action-card">
            <div className="action-header">
              <h3>Claim interest</h3>
              <p>Move accrued rewards into your liquid balance.</p>
            </div>
            <div className="action-body interest">
              <div>
                <span className="interest-label">Pending</span>
                <span className="interest-value">{formatBigint(decryptedState?.interest ?? null)} mUSDT</span>
              </div>
              <button
                onClick={handleClaimInterest}
                disabled={!hasClaimed || actions.interest || !isConnected || !contractConfigured}
              >
                {actions.interest ? 'Claiming…' : 'Claim interest'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {isDecrypting && <div className="staking-notice">Refreshing encrypted balances…</div>}

      {feedback && <div className="staking-feedback">{feedback}</div>}
    </div>
  );
}
