# Base Revenue OS

A platform for creating and monetizing on-chain links on Base.

## Project Structure

- **`/hardhat`**: Smart contracts, deployment scripts, and tests. Built with Hardhat.
- **`/my-onchainkit-app`**: The frontend dashboard application. Built with Next.js and OnchainKit.
- **`/docs`**: Project documentation, specification files, and research notes.

## Getting Started

### Smart Contracts
1. Navigate to `/hardhat`
2. Run `npm install`
3. Deploy with `npx hardhat run scripts/deploy.ts --network base-sepolia`

### Frontend
1. Navigate to `/my-onchainkit-app` (recommended to rename to `/frontend`)
2. Run `npm install`
3. Start dev server: `npm run dev`
