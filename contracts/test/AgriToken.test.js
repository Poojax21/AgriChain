const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgriToken (ERC-20)", function () {
  let AgriToken;
  let agriToken;
  let deployer, recipient, user1, user2, slasher, nonSlasher;
  const initialMint = ethers.parseEther("1000000"); // 1,000,000 AGRI
  const faucetDrip = ethers.parseEther("1000"); // 1,000 AGRI

  beforeEach(async function () {
    [deployer, recipient, user1, user2, slasher, nonSlasher] = await ethers.getSigners();
    AgriToken = await ethers.getContractFactory("AgriToken");
    agriToken = await AgriToken.deploy(deployer.address, recipient.address, initialMint);
    await agriToken.waitForDeployment();
  });

  describe("Deployment & Configuration", function () {
    it("Should initialize with correct metadata", async function () {
      expect(await agriToken.name()).to.equal("AgriChain Token");
      expect(await agriToken.symbol()).to.equal("AGRI");
      expect(await agriToken.decimals()).to.equal(18n);
    });

    it("Should mint initial supply to designated recipient", async function () {
      expect(await agriToken.balanceOf(recipient.address)).to.equal(initialMint);
      expect(await agriToken.totalSupply()).to.equal(initialMint);
    });

    it("Should assign admin, minter, and slasher roles to deployer", async function () {
      const defaultAdminRole = await agriToken.DEFAULT_ADMIN_ROLE();
      const minterRole = await agriToken.MINTER_ROLE();
      const slasherRole = await agriToken.SLASHER_ROLE();

      expect(await agriToken.hasRole(defaultAdminRole, deployer.address)).to.be.true;
      expect(await agriToken.hasRole(minterRole, deployer.address)).to.be.true;
      expect(await agriToken.hasRole(slasherRole, deployer.address)).to.be.true;
    });

    it("Should revert if initial admin is zero address", async function () {
      await expect(
        AgriToken.deploy(ethers.ZeroAddress, recipient.address, initialMint)
      ).to.be.revertedWith("Invalid admin address");
    });

    it("Should revert if initial recipient is zero address", async function () {
      await expect(
        AgriToken.deploy(deployer.address, ethers.ZeroAddress, initialMint)
      ).to.be.revertedWith("Invalid recipient address");
    });

    it("Should revert if initial mint exceeds MAX_SUPPLY", async function () {
      const excessiveSupply = ethers.parseEther("100000001"); // 100M + 1
      await expect(
        AgriToken.deploy(deployer.address, recipient.address, excessiveSupply)
      ).to.be.revertedWithCustomError(agriToken, "MaxSupplyExceeded");
    });
  });

  describe("Minting & Supply Cap", function () {
    it("Should allow minter to mint within max supply", async function () {
      const mintAmount = ethers.parseEther("50000");
      await expect(agriToken.connect(deployer).mint(user1.address, mintAmount))
        .to.emit(agriToken, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);

      expect(await agriToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should prevent non-minter from minting", async function () {
      const minterRole = await agriToken.MINTER_ROLE();
      await expect(
        agriToken.connect(user1).mint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(agriToken, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, minterRole);
    });

    it("Should revert if minting exceeds max supply cap", async function () {
      const maxSupply = await agriToken.MAX_SUPPLY();
      const currentSupply = await agriToken.totalSupply();
      const overAmount = maxSupply - currentSupply + 1n;

      await expect(
        agriToken.connect(deployer).mint(user1.address, overAmount)
      ).to.be.revertedWithCustomError(agriToken, "MaxSupplyExceeded");
    });
  });

  describe("Faucet Functionality", function () {
    it("Should drip tokens to user on first request", async function () {
      const tx = await agriToken.connect(user1).faucet();
      await expect(tx).to.emit(agriToken, "FaucetDripped");

      expect(await agriToken.balanceOf(user1.address)).to.equal(faucetDrip);
      expect(await agriToken.lastFaucetRequest(user1.address)).to.be.gt(0n);
    });

    it("Should enforce cooldown period between requests", async function () {
      await agriToken.connect(user1).faucet();

      await expect(
        agriToken.connect(user1).faucet()
      ).to.be.revertedWithCustomError(agriToken, "FaucetCooldownActive");

      // Advance time beyond cooldown (12 hours)
      await time.increase(12 * 3600 + 1);

      // Now should succeed
      await expect(agriToken.connect(user1).faucet()).to.not.be.reverted;
      expect(await agriToken.balanceOf(user1.address)).to.equal(faucetDrip * 2n);
    });
  });

  describe("Staking & Unstaking", function () {
    beforeEach(async function () {
      // Fund user1 with tokens via faucet
      await agriToken.connect(user1).faucet();
    });

    it("Should allow user to stake tokens", async function () {
      const stakeAmount = ethers.parseEther("400");

      await expect(agriToken.connect(user1).stake(stakeAmount))
        .to.emit(agriToken, "Staked")
        .withArgs(user1.address, stakeAmount, stakeAmount);

      expect(await agriToken.stakedBalanceOf(user1.address)).to.equal(stakeAmount);
      expect(await agriToken.totalStaked()).to.equal(stakeAmount);
      expect(await agriToken.balanceOf(user1.address)).to.equal(faucetDrip - stakeAmount);
      expect(await agriToken.balanceOf(await agriToken.getAddress())).to.equal(stakeAmount);
    });

    it("Should revert staking zero tokens", async function () {
      await expect(
        agriToken.connect(user1).stake(0)
      ).to.be.revertedWithCustomError(agriToken, "ZeroAmountNotAllowed");
    });

    it("Should allow user to unstake tokens", async function () {
      const stakeAmount = ethers.parseEther("500");
      const unstakeAmount = ethers.parseEther("200");

      await agriToken.connect(user1).stake(stakeAmount);

      await expect(agriToken.connect(user1).unstake(unstakeAmount))
        .to.emit(agriToken, "Unstaked")
        .withArgs(user1.address, unstakeAmount, stakeAmount - unstakeAmount);

      expect(await agriToken.stakedBalanceOf(user1.address)).to.equal(stakeAmount - unstakeAmount);
      expect(await agriToken.totalStaked()).to.equal(stakeAmount - unstakeAmount);
      expect(await agriToken.balanceOf(user1.address)).to.equal(faucetDrip - stakeAmount + unstakeAmount);
    });

    it("Should revert unstaking zero tokens", async function () {
      await expect(
        agriToken.connect(user1).unstake(0)
      ).to.be.revertedWithCustomError(agriToken, "ZeroAmountNotAllowed");
    });

    it("Should revert unstaking more than staked balance", async function () {
      const stakeAmount = ethers.parseEther("100");
      await agriToken.connect(user1).stake(stakeAmount);

      await expect(
        agriToken.connect(user1).unstake(ethers.parseEther("101"))
      ).to.be.revertedWithCustomError(agriToken, "InsufficientStakedBalance")
        .withArgs(ethers.parseEther("101"), stakeAmount);
    });
  });

  describe("Slashing Mechanism", function () {
    const stakeAmount = ethers.parseEther("600");
    const slashAmount = ethers.parseEther("200");

    beforeEach(async function () {
      // Fund user1 and stake
      await agriToken.connect(user1).faucet();
      await agriToken.connect(user1).stake(stakeAmount);

      // Grant slasher role to slasher account
      const slasherRole = await agriToken.SLASHER_ROLE();
      await agriToken.connect(deployer).grantRole(slasherRole, slasher.address);
    });

    it("Should allow authorized slasher to slash and transfer to recipient", async function () {
      const initialUser2Balance = await agriToken.balanceOf(user2.address);

      await expect(
        agriToken.connect(slasher).slash(user1.address, slashAmount, user2.address)
      ).to.emit(agriToken, "Slashed")
        .withArgs(user1.address, slashAmount, slasher.address, user2.address);

      expect(await agriToken.stakedBalanceOf(user1.address)).to.equal(stakeAmount - slashAmount);
      expect(await agriToken.totalStaked()).to.equal(stakeAmount - slashAmount);
      expect(await agriToken.balanceOf(user2.address)).to.equal(initialUser2Balance + slashAmount);
    });

    it("Should burn slashed tokens if recipient is address(0)", async function () {
      const supplyBefore = await agriToken.totalSupply();

      await expect(
        agriToken.connect(slasher).slash(user1.address, slashAmount, ethers.ZeroAddress)
      ).to.emit(agriToken, "Slashed")
        .withArgs(user1.address, slashAmount, slasher.address, ethers.ZeroAddress);

      expect(await agriToken.totalSupply()).to.equal(supplyBefore - slashAmount);
      expect(await agriToken.stakedBalanceOf(user1.address)).to.equal(stakeAmount - slashAmount);
    });

    it("Should revert slashing zero tokens", async function () {
      await expect(
        agriToken.connect(slasher).slash(user1.address, 0, user2.address)
      ).to.be.revertedWithCustomError(agriToken, "ZeroAmountNotAllowed");
    });

    it("Should revert slashing more than staked balance", async function () {
      const excess = ethers.parseEther("700");
      await expect(
        agriToken.connect(slasher).slash(user1.address, excess, user2.address)
      ).to.be.revertedWithCustomError(agriToken, "ExceedsStakedBalance")
        .withArgs(excess, stakeAmount);
    });

    it("Should prevent non-slasher from slashing", async function () {
      const slasherRole = await agriToken.SLASHER_ROLE();
      await expect(
        agriToken.connect(nonSlasher).slash(user1.address, slashAmount, user2.address)
      ).to.be.revertedWithCustomError(agriToken, "AccessControlUnauthorizedAccount")
        .withArgs(nonSlasher.address, slasherRole);
    });
  });

  describe("Voting Power", function () {
    it("Should return 0 voting power when user has no stake", async function () {
      expect(await agriToken.votingPower(user1.address)).to.equal(0n);
    });

    it("Should update voting power in lockstep with staked balance", async function () {
      await agriToken.connect(user1).faucet();
      const stakeAmount = ethers.parseEther("350");

      await agriToken.connect(user1).stake(stakeAmount);
      expect(await agriToken.votingPower(user1.address)).to.equal(stakeAmount);

      await agriToken.connect(user1).unstake(ethers.parseEther("100"));
      expect(await agriToken.votingPower(user1.address)).to.equal(ethers.parseEther("250"));
    });
  });
});
