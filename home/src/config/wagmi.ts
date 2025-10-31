import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Encrypted mUSDT Staking',
  projectId: '00000000000000000000000000000000',
  chains: [sepolia],
  ssr: false,
});
