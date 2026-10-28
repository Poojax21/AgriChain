const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReputationSBT (Soulbound Token)", function () {
  let ReputationSBT;
  let reputationSBT;
  let admin, operator, user1, user2, nonOperator;

  beforeEach(async function () {
    [admin, operator, user1, user2, nonOperator] = await ethers.getSigners();
    ReputationSBT = await ethers.getContractFactory("ReputationSBT");
    reputationSBT = await ReputationSBT.deploy(admin.address);
    await reputationSBT.waitForDeployment();

    const operatorRole = await reputationSBT.OPERATOR_ROLE();
    await reputationSBT.connect(admin).grantRole(operatorRole, operator.address);
  });

  describe("Registration & Baseline Score", function () {
    it("Should allow a user to self-register", async function () {
      await expect(reputationSBT.connect(user1).register())
        .to.emit(reputationSBT, "UserRegistered")
        .withArgs(user1.address, 1n, 100n);

      expect(await reputationSBT.ownerOf(1n)).to.equal(user1.address);
      expect(await reputationSBT.userTokenId(user1.address)).to.equal(1n);
      expect(await reputationSBT.isRegistered(user1.address)).to.be.true;

      const [score, trades, won, lost] = await reputationSBT.getReputation(user1.address);
      expect(score).to.equal(100n);
      expect(trades).to.equal(0n);
      expect(won).to.equal(0n);
      expect(lost).to.equal(0n);
    });

    it("Should allow operator to register user", async function () {
      await expect(reputationSBT.connect(operator).registerUser(user2.address))
        .to.emit(reputationSBT, "UserRegistered")
        .withArgs(user2.address, 1n, 100n);

      expect(await reputationSBT.ownerOf(1n)).to.equal(user2.address);
    });

    it("Should revert if user tries to register twice", async function () {
      await reputationSBT.connect(user1).register();
      await expect(
        reputationSBT.connect(user1).register()
      ).to.be.revertedWithCustomError(reputationSBT, "UserAlreadyRegistered")
        .withArgs(user1.address);
    });

    it("Should return zeros for unregistered user", async function () {
      const [score, trades, won, lost] = await reputationSBT.getReputation(nonOperator.address);
      expect(score).to.equal(0n);
      expect(trades).to.equal(0n);
      expect(won).to.equal(0n);
      expect(lost).to.equal(0n);
    });
  });

  describe("Soulbound Non-Transferability", function () {
    beforeEach(async function () {
      await reputationSBT.connect(user1).register();
    });

    it("Should revert any attempt to transfer token via transferFrom", async function () {
      await expect(
        reputationSBT.connect(user1).transferFrom(user1.address, user2.address, 1n)
      ).to.be.revertedWithCustomError(reputationSBT, "SoulboundTokenNonTransferable");
    });

    it("Should revert any attempt to transfer token via safeTransferFrom", async function () {
      await expect(
        reputationSBT.connect(user1)["safeTransferFrom(address,address,uint256)"](
          user1.address,
          user2.address,
          1n
        )
      ).to.be.revertedWithCustomError(reputationSBT, "SoulboundTokenNonTransferable");
    });
  });

  describe("Reputation Updates", function () {
    beforeEach(async function () {
      await reputationSBT.connect(user1).register();
    });

    it("Should boost score and trade count upon successful trade", async function () {
      await expect(reputationSBT.connect(operator).recordTradeSuccess(user1.address, 15n))
        .to.emit(reputationSBT, "ReputationUpdated")
        .withArgs(user1.address, 115n, 15n, "TRADE_SUCCESS");

      const [score, trades] = await reputationSBT.getReputation(user1.address);
      expect(score).to.equal(115n);
      expect(trades).to.equal(1n);
    });

    it("Should boost score upon dispute win", async function () {
      await expect(reputationSBT.connect(operator).recordDisputeWin(user1.address, 20n))
        .to.emit(reputationSBT, "ReputationUpdated")
        .withArgs(user1.address, 120n, 20n, "DISPUTE_WON");

      const [score, , won] = await reputationSBT.getReputation(user1.address);
      expect(score).to.equal(120n);
      expect(won).to.equal(1n);
    });

    it("Should penalize score upon dispute loss", async function () {
      await expect(reputationSBT.connect(operator).recordDisputeLoss(user1.address, 30n))
        .to.emit(reputationSBT, "ReputationUpdated")
        .withArgs(user1.address, 70n, -30n, "DISPUTE_LOST");

      const [score, , , lost] = await reputationSBT.getReputation(user1.address);
      expect(score).to.equal(70n);
      expect(lost).to.equal(1n);
    });

    it("Should clamp score at zero if penalty exceeds current score", async function () {
      await reputationSBT.connect(operator).recordDisputeLoss(user1.address, 150n);
      const [score] = await reputationSBT.getReputation(user1.address);
      expect(score).to.equal(0n);
    });

    it("Should auto-register user if operator updates an unregistered address", async function () {
      expect(await reputationSBT.isRegistered(user2.address)).to.be.false;

      await reputationSBT.connect(operator).recordTradeSuccess(user2.address, 10n);

      expect(await reputationSBT.isRegistered(user2.address)).to.be.true;
      const [score, trades] = await reputationSBT.getReputation(user2.address);
      expect(score).to.equal(110n); // 100 baseline + 10 boost
      expect(trades).to.equal(1n);
    });

    it("Should revert if non-operator tries to modify reputation", async function () {
      const operatorRole = await reputationSBT.OPERATOR_ROLE();
      await expect(
        reputationSBT.connect(nonOperator).recordTradeSuccess(user1.address, 10n)
      ).to.be.revertedWithCustomError(reputationSBT, "AccessControlUnauthorizedAccount")
        .withArgs(nonOperator.address, operatorRole);
    });
  });
});
