import hre from "hardhat";

async function main() {
    console.log("HRE keys:", Object.keys(hre));

    console.log("Connecting to network...");
    const connection = await hre.network.connect();
    console.log("Connection keys:", Object.keys(connection));

    if (connection.ethers) {
        console.log("Ethers found in connection");
        console.log("Ethers keys:", Object.keys(connection.ethers));
    } else {
        console.log("Ethers NOT found in connection");
    }
}

main().catch(console.error);
