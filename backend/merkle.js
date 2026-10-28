const { ethers } = require("ethers");

/**
 * Constructs an OpenZeppelin-compatible Merkle Tree from checkpoint leaf hashes.
 * Pairwise sorted keccak256 hashing.
 */
function buildMerkleTree(leaves) {
  if (!leaves || leaves.length === 0) {
    throw new Error("Cannot build Merkle tree from empty leaves");
  }

  let sortedLeaves = leaves.map(l => ethers.getBytes(l));
  let layers = [sortedLeaves];

  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1];
    const nextLayer = [];

    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1];
        // Sort pairwise as OpenZeppelin MerkleProof expects
        const combined = ethers.getBytes(
          ethers.solidityPackedKeccak256(
            ["bytes32", "bytes32"],
            ethers.hexlify(left) < ethers.hexlify(right) ? [left, right] : [right, left]
          )
        );
        nextLayer.push(combined);
      } else {
        nextLayer.push(currentLayer[i]);
      }
    }
    layers.push(nextLayer);
  }

  const root = ethers.hexlify(layers[layers.length - 1][0]);

  function getProof(index) {
    const proof = [];
    let currentIndex = index;

    for (let i = 0; i < layers.length - 1; i++) {
      const layer = layers[i];
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < layer.length) {
        proof.push(ethers.hexlify(layer[siblingIndex]));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    return proof;
  }

  return { root, getProof };
}

/**
 * Hashes a single shipment checkpoint event into a 32-byte leaf hash.
 * Geo/weather fields are part of the preimage when the reporter supplies
 * them (empty string / -32768 sentinel otherwise), so telemetry is committed,
 * not just displayed.
 */
function hashCheckpoint(location, timestamp, temperatureCelsius, statusNote, latitude = "", longitude = "", weatherTempC = null) {
  return ethers.solidityPackedKeccak256(
    ["string", "uint256", "int16", "string", "string", "string", "int16"],
    [location, timestamp, temperatureCelsius, statusNote, String(latitude ?? ""), String(longitude ?? ""), weatherTempC === null ? -32768 : Math.round(weatherTempC)]
  );
}

module.exports = {
  buildMerkleTree,
  hashCheckpoint,
};
