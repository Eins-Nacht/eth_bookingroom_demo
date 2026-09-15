import fs from "node:fs";
import path from "node:path";
import { network } from "hardhat";

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();
const providerNetwork = await ethers.provider.getNetwork();
const chainId = Number(providerNetwork.chainId);
const networkArgumentIndex = process.argv.indexOf("--network");
const networkName = networkArgumentIndex >= 0
  ? process.argv[networkArgumentIndex + 1]
  : "unknown";

console.log(`Deploying from ${deployer.address}`);

const roomBooking = await ethers.deployContract("RoomBooking");
await roomBooking.waitForDeployment();

const address = await roomBooking.getAddress();
const deployment = {
  contract: "RoomBooking",
  network: networkName,
  chainId,
  address,
};

const deploymentDirectory = path.resolve("deployments");
fs.mkdirSync(deploymentDirectory, { recursive: true });
fs.writeFileSync(
  path.join(deploymentDirectory, `${chainId}.json`),
  `${JSON.stringify(deployment, null, 2)}\n`,
);

console.log(`Network: ${networkName}`);
console.log(`Chain ID: ${chainId}`);
console.log(`Deployed contract address: ${address}`);
console.log(`Saved deployment: deployments/${chainId}.json`);