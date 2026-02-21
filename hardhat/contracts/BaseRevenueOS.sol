// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BaseRevenueOS is Ownable {

    IERC20 public usdc; // USDC token on Base
    uint256 public platformFee = 500; // 5% fee (denominator 10000)

    struct PaidLink {
        address creator;
        uint256 price; // in USDC smallest unit
        string title; // Link title
        string contentHash; // IPFS hash or URL (now encrypted via frontend)
        uint256 sold;
        uint256 totalEarned; // For creator analytics
        uint256 royaltyPercent; // e.g. 1000 = 10% for resells
    }

    // linkId => PaidLink
    mapping(uint256 => PaidLink) public paidLinks;

    // creator => array of linkIds
    mapping(address => uint256[]) public creatorLinks;

    // linkId => buyer => purchased
    mapping(uint256 => mapping(address => bool)) public hasPurchased;

    // linkId => user => resalePrice (0 means not for resale)
    mapping(uint256 => mapping(address => uint256)) public resalePrices;

    // balance for each creator (for analytics and safety)
    mapping(address => uint256) public creatorBalances;

    uint256 public nextLinkId = 1;

    // Events
    event LinkCreated(uint256 indexed linkId, address indexed creator, uint256 price, string title);
    event LinkPurchased(uint256 indexed linkId, address indexed buyer, address indexed seller, uint256 amount);
    event Withdraw(address indexed creator, uint256 amount);

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    // Creator creates a paid link
    function createLink(uint256 price, string memory title, string memory contentHash, uint256 royalty) external {
        require(price > 0, "Price must be > 0");
        require(royalty <= 3000, "Royalty max 30%");
        
        uint256 linkId = nextLinkId;
        
        paidLinks[linkId] = PaidLink({
            creator: msg.sender,
            price: price,
            title: title,
            contentHash: contentHash,
            sold: 0,
            totalEarned: 0,
            royaltyPercent: royalty
        });

        creatorLinks[msg.sender].push(linkId);
        nextLinkId++;

        emit LinkCreated(linkId, msg.sender, price, title);
    }

    // Get all links for a creator
    function getLinksByCreator(address creator) external view returns (uint256[] memory) {
        return creatorLinks[creator];
    }

    // Buyer pays for link (Primary Sale)
    function buyLink(uint256 linkId) external {
        PaidLink storage link = paidLinks[linkId];
        require(link.price > 0, "Link does not exist");
        require(!hasPurchased[linkId][msg.sender], "Already purchased");

        uint256 amount = link.price;
        uint256 fee = (amount * platformFee) / 10000;
        uint256 creatorAmount = amount - fee;

        // Collect funds into the contract for the creator to withdraw
        require(usdc.transferFrom(msg.sender, address(this), amount), "Payment failed");
        
        creatorBalances[link.creator] += creatorAmount;
        creatorBalances[owner()] += fee;

        hasPurchased[linkId][msg.sender] = true;
        link.sold++;
        link.totalEarned += creatorAmount;

        emit LinkPurchased(linkId, msg.sender, link.creator, amount);
    }

    // Resell Access logic
    function setResalePrice(uint256 linkId, uint256 price) external {
        require(hasPurchased[linkId][msg.sender], "You don't own this link");
        resalePrices[linkId][msg.sender] = price;
    }

    function buyResale(uint256 linkId, address seller) external {
        uint256 price = resalePrices[linkId][seller];
        require(price > 0, "Not for sale");
        require(!hasPurchased[linkId][msg.sender], "Already purchased");

        PaidLink storage link = paidLinks[linkId];
        uint256 royalty = (price * link.royaltyPercent) / 10000;
        uint256 fee = (price * platformFee) / 10000;
        uint256 sellerAmount = price - royalty - fee;

        require(usdc.transferFrom(msg.sender, address(this), price), "Payment failed");

        creatorBalances[seller] += sellerAmount;
        creatorBalances[link.creator] += royalty;
        creatorBalances[owner()] += fee;

        hasPurchased[linkId][msg.sender] = true;
        resalePrices[linkId][seller] = 0; // Remove from sale

        emit LinkPurchased(linkId, msg.sender, seller, price);
    }

    // Creator withdraws their earnings
    function withdrawCreatorEarnings() external {
        uint256 balance = creatorBalances[msg.sender];
        require(balance > 0, "Nothing to withdraw");

        creatorBalances[msg.sender] = 0;
        require(usdc.transfer(msg.sender, balance), "Transfer failed");

        emit Withdraw(msg.sender, balance);
    }

    // Admin can withdraw contract balance if needed
    function adminWithdraw(uint256 amount) external onlyOwner {
        require(usdc.transfer(msg.sender, amount), "Admin withdraw failed");
    }

    // Admin can change platform fee
    function setPlatformFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "Max 10%");
        platformFee = newFee;
    }
}
