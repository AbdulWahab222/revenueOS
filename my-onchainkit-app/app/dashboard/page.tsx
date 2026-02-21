"use client";

import { useState, useEffect } from "react";
import { Wallet, ConnectWallet, WalletDropdown, WalletDropdownDisconnect } from "@coinbase/onchainkit/wallet";
import { Identity, Name, Address, Avatar, EthBalance } from "@coinbase/onchainkit/identity";
import { useAccount, useWriteContract, useReadContract, useReadContracts, useSignMessage } from "wagmi";
import { BASE_REVENUE_OS_ADDRESS, BASE_REVENUE_OS_ABI } from "../contracts/config";
import { formatUnits, parseUnits } from "viem";
import CryptoJS from "crypto-js";

interface Link {
  id: number;
  title: string;
  price: number;
  sold: number;
  totalEarned: number;
  royalty: number;
  contentHash: string;
}

// Deterministic message for a given creator + linkId
// This message is FIXED — signing the same message always produces the same key
const buildKeyMessage = (creatorAddress: string, linkId: number) =>
  `BaseRevenueOS: Authorize encryption key for Link #${linkId} created by ${creatorAddress.toLowerCase()}`;

export default function Dashboard() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();

  // Modal state for showing the secure share link after creation
  const [shareModal, setShareModal] = useState<{ url: string; linkId: number } | null>(null);

  // Fetch contract balance (live analytics)
  const { data: creatorBalance, refetch: refetchBalance } = useReadContract({
    address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
    abi: BASE_REVENUE_OS_ABI as any,
    functionName: "creatorBalances",
    args: [address as `0x${string}`],
    query: { enabled: !!address }
  });

  // Read nextLinkId from the contract so we know the EXACT future linkId
  const { data: nextLinkIdData } = useReadContract({
    address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
    abi: BASE_REVENUE_OS_ABI as any,
    functionName: "nextLinkId",
    query: { enabled: !!address },
  });

  // 1. Get the array of Link IDs for this creator
  const { data: creatorLinkIds, refetch: refetchIds } = useReadContract({
    address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
    abi: BASE_REVENUE_OS_ABI as any,
    functionName: "getLinksByCreator",
    args: [address as `0x${string}`],
    query: {
      enabled: !!address,
    }
  }) as { data: readonly bigint[] | undefined, refetch: any };

  // 2. Fetch the details of each Link ID
  const { data: linksData, refetch: refetchLinks } = useReadContracts({
    contracts: (creatorLinkIds || []).map((id) => ({
      address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
      abi: BASE_REVENUE_OS_ABI as any,
      functionName: "paidLinks",
      args: [id],
    })),
    query: {
      enabled: !!creatorLinkIds && creatorLinkIds.length > 0,
    }
  });

  // Map the raw contract data into our Link interface
  const links: Link[] = (linksData || []).map((result, index) => {
    if (result.status === "success" && result.result) {
      const data = result.result as readonly [string, bigint, string, string, bigint, bigint, bigint];
      return {
        id: Number(creatorLinkIds![index]),
        title: data[2] || "Untitled Link",
        price: Number(formatUnits(data[1], 6)),
        contentHash: data[3],
        sold: Number(data[4]),
        totalEarned: Number(formatUnits(data[5], 6)),
        royalty: Number(data[6]) / 100, // 1000 => 10%
      };
    }
    return null;
  }).filter(Boolean) as Link[];

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    price: "",
    contentUrl: "",
    royalty: "10", // Default 10%
  });

  const [isPublishing, setIsPublishing] = useState(false);

  // --- DETERMINISTIC KEY HELPERS ---

  // Derives the encryption key from a wallet signature.
  // Same wallet + same linkId = same signature = same key. ALWAYS recoverable.
  const getDeterministicKey = async (linkId: number): Promise<string> => {
    if (!address) throw new Error("Wallet not connected");
    const message = buildKeyMessage(address, linkId);
    const signature = await signMessageAsync({ message });
    // SHA256 hash the signature → a fixed-length secure key
    return CryptoJS.SHA256(signature).toString();
  };

  // Recover key from localStorage cache first; if missing, re-derive from wallet signature.
  const recoverKey = async (linkId: number): Promise<string | null> => {
    try {
      const cached = JSON.parse(localStorage.getItem("revenue_os_keys") || "{}");
      if (cached[linkId]) return cached[linkId];

      // Cache miss → ask wallet to re-sign and recover
      const key = await getDeterministicKey(linkId);

      // Write back to cache for next time
      cached[linkId] = key;
      localStorage.setItem("revenue_os_keys", JSON.stringify(cached));
      return key;
    } catch {
      return null;
    }
  };

  // --- CREATE LINK ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return alert("Please connect your wallet first");
    if (!nextLinkIdData) return alert("Still loading contract data. Try again in a moment.");
    setIsPublishing(true);

    try {
      // 1. Read the EXACT next linkId from the contract (no guessing)
      const nextId = Number(nextLinkIdData as bigint);

      // 2. Derive the deterministic key from wallet signature + linkId
      //    The wallet popup says exactly what this signature is for.
      const linkKey = await getDeterministicKey(nextId);

      // 3. Encrypt the secret URL with that key
      const encryptedUrl = CryptoJS.AES.encrypt(formData.contentUrl, linkKey).toString();

      const priceInUSDC = Math.floor(parseFloat(formData.price) * 1e6);
      const royaltyPercent = Math.floor(parseFloat(formData.royalty) * 100);

      // 4. Publish to blockchain
      await writeContractAsync({
        address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
        abi: BASE_REVENUE_OS_ABI as any,
        functionName: 'createLink',
        args: [BigInt(priceInUSDC), formData.title, encryptedUrl, BigInt(royaltyPercent)],
      });

      // 5. Cache key in localStorage (convenience cache, NOT the source of truth)
      const keys = JSON.parse(localStorage.getItem("revenue_os_keys") || "{}");
      keys[nextId] = linkKey;
      localStorage.setItem("revenue_os_keys", JSON.stringify(keys));

      const fullLink = `${window.location.origin}/l/${nextId}#key=${linkKey}`;

      // 6. Show modal with the full secure link
      setShareModal({ url: fullLink, linkId: nextId });

      setFormData({ title: "", description: "", price: "", contentUrl: "", royalty: "10" });
      refetchIds();
      refetchLinks();
      refetchBalance();
    } catch (error: any) {
      console.error("Failed to publish link", error);
      if (error?.message?.includes("User rejected")) {
        alert("Signature rejected. The key is needed to encrypt your content.");
      } else {
        alert("Failed to publish link. Check console for details.");
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!address) return;
    try {
      await writeContractAsync({
        address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
        abi: BASE_REVENUE_OS_ABI as any,
        functionName: 'withdrawCreatorEarnings',
      });
      alert("Withdrawal successful!");
      refetchBalance();
    } catch (error) {
      console.error("Withdraw failed", error);
    }
  };

  const copyLink = async (linkId: number) => {
    try {
      const key = await recoverKey(linkId);
      const url = key
        ? `${window.location.origin}/l/${linkId}#key=${key}`
        : `${window.location.origin}/l/${linkId}`;

      navigator.clipboard.writeText(url);
      setShareModal({ url, linkId });
    } catch {
      alert("Could not recover key. Please ensure your wallet is connected.");
    }
  };

  const handleSetResale = async (linkId: number, price: string) => {
    try {
      const priceInUSDC = parseUnits(price, 6);
      await writeContractAsync({
        address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
        abi: BASE_REVENUE_OS_ABI as any,
        functionName: 'setResalePrice',
        args: [BigInt(linkId), priceInUSDC],
      });
      alert("Resale price set! Others can now buy your access.");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">

      {/* ── Share Modal ── */}
      {shareModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 relative border border-gray-100">
            {/* Close */}
            <button
              onClick={() => setShareModal(null)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 font-bold"
            >✕</button>

            {/* Icon */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center text-2xl">🔐</div>
              <div>
                <h2 className="text-xl font-black text-gray-900">Link #{shareModal.linkId} is Live!</h2>
                <p className="text-xs text-green-600 font-bold uppercase tracking-widest">Encrypted & Secured</p>
              </div>
            </div>

            {/* Key security notice */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-6 space-y-2">
              <p className="text-sm font-bold text-blue-900 flex items-center gap-2">
                <span>🛡️</span> Military-Grade Key Recovery
              </p>
              <p className="text-xs text-blue-700 leading-relaxed">
                Your key is <strong>derived from your wallet signature</strong>. Even if you clear your browser, you can always recover it by signing the same message again from your dashboard. <strong>Your wallet IS your key vault.</strong>
              </p>
            </div>

            {/* Secure Share URL */}
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">
              🔗 Your Secure Share Link
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                readOnly
                value={shareModal.url}
                className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs text-gray-700 focus:outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareModal.url);
                  alert("Secure link copied to clipboard! ✅");
                }}
                className="px-4 py-3 bg-[#0052FF] text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20"
              >
                Copy
              </button>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed mb-6">
              ⚠️ Share this <strong>exact link</strong> (including the <code className="bg-gray-100 px-1 rounded">#key=...</code> part) with your buyers. The key is embedded in the URL and never stored on-chain.
            </p>

            <button
              onClick={() => setShareModal(null)}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-sm hover:bg-gray-800 transition-all"
            >
              Done — I've saved my link
            </button>
          </div>
        </div>
      )}

      {/* Top Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#0a0b14] text-white border-b border-gray-800 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#0052FF] flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-white"></div>
              </div>
              <h1 className="text-lg font-bold tracking-tight hidden sm:block">Base Revenue OS</h1>
            </div>

            {/* In-page Nav Links */}
            <nav className="hidden md:flex items-center gap-8">
              <a href="#dashboard" className="text-sm font-bold text-white hover:text-[#0052FF] transition-colors uppercase tracking-widest">Dashboard</a>
              <a href="#create-link" className="text-sm font-bold text-gray-400 hover:text-white transition-colors uppercase tracking-widest">Create Link</a>
              <a href="#my-links" className="text-sm font-bold text-gray-400 hover:text-white transition-colors uppercase tracking-widest">My Links</a>
              <a href="#earnings" className="text-sm font-bold text-gray-400 hover:text-white transition-colors uppercase tracking-widest">Earnings</a>
            </nav>

            {/* Wallet Component */}
            <div className="flex items-center gap-4">
              <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-gray-800/50 rounded-full border border-gray-700">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Base Sepolia</span>
              </div>
              <Wallet>
                <ConnectWallet className="bg-[#0052FF] text-white py-2 px-4 rounded-xl font-bold text-sm shadow-lg hover:bg-blue-600 transition-all flex items-center gap-2">
                  <Avatar className="h-5 w-5" />
                  <Name className="text-xs" />
                </ConnectWallet>
                <WalletDropdown>
                  <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                    <Avatar />
                    <Name />
                    <Address />
                    <EthBalance />
                  </Identity>
                  <WalletDropdownDisconnect />
                </WalletDropdown>
              </Wallet>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-8 lg:p-12">
        {/* Top Header Section */}
        <div id="dashboard" className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6 scroll-mt-24">
          <div className="text-center md:text-left">
            <h2 className="text-4xl font-black text-gray-900 tracking-tight">Creator Dashboard</h2>
            <p className="text-gray-500 font-medium mt-1">Stripe for Web3 Links. Encrypted & Decentralized.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-[#ecfdf5] border border-green-100 rounded-[1.25rem] p-4 flex flex-col items-center min-w-[180px] shadow-sm">
              <span className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Available to Withdraw</span>
              <p className="text-2xl font-black text-[#10b981]">{creatorBalance ? Number(formatUnits(creatorBalance as bigint, 6)).toFixed(2) : "0.00"} <span className="text-sm font-bold text-[#10b981]/80">USDC</span></p>
            </div>
            <button
              onClick={handleWithdraw}
              className="bg-white text-gray-900 border border-gray-200 py-4 px-8 rounded-[1.25rem] font-bold shadow-sm hover:shadow-md hover:border-gray-300 transition-all active:scale-[0.98]"
            >
              Withdraw
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Left Column: Form & Stats */}
          <div className="flex-[1.4] space-y-10">
            {/* Create Paid Link Form */}
            <div id="create-link" className="bg-white rounded-[2.5rem] shadow-2xl shadow-blue-900/5 border border-gray-100 overflow-hidden p-8 md:p-12 scroll-mt-24">
              <div className="flex items-center gap-3 mb-10">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <span className="text-2xl font-bold text-[#0052FF]">+</span>
                </div>
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Create Paid Link</h3>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Title</label>
                    <input
                      type="text"
                      required
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-6 py-5 bg-gray-50/50 border border-gray-200 rounded-2xl focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-[#0052FF] transition-all placeholder:text-gray-300 font-bold text-gray-900 shadow-sm"
                      placeholder="e.g. AI Alpha Report"
                    />
                  </div>
                  <div className="md:w-1/3 space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Price (USDC)</label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        step="0.01"
                        min="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        className="w-full px-6 py-5 bg-gray-50/50 border border-gray-200 rounded-2xl focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-[#0052FF] transition-all font-black text-gray-900 shadow-sm"
                        placeholder="2.00"
                      />
                      <span className="absolute right-6 top-1/2 -translate-y-1/2 text-sm font-black text-gray-400">USDC</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Description (optional)</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-6 py-5 bg-gray-50/50 border border-gray-200 rounded-2xl focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-[#0052FF] transition-all min-h-[140px] font-medium text-gray-600 shadow-sm resize-none"
                    placeholder="e.g. Exclusive 10x AI Tokens report updated daily!"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1 flex justify-between">
                    <span>Content URL or Secret Text</span>
                    <span className="text-[#0052FF] normal-case">🔒 Will be AES Encrypted</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.contentUrl}
                    onChange={(e) => setFormData({ ...formData, contentUrl: e.target.value })}
                    className="w-full px-6 py-5 bg-gray-50/50 border border-gray-200 rounded-2xl focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-[#0052FF] transition-all font-medium text-gray-600 shadow-sm"
                    placeholder="https://..."
                  />
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Resell Royalty %</label>
                    <input
                      type="number"
                      max="30"
                      min="0"
                      value={formData.royalty}
                      onChange={(e) => setFormData({ ...formData, royalty: e.target.value })}
                      className="w-full px-6 py-5 bg-gray-50/50 border border-gray-200 rounded-2xl focus:bg-white transition-all font-bold text-gray-900 shadow-sm"
                      placeholder="10"
                    />
                  </div>
                  <div className="md:w-1/2 flex items-end">
                    <p className="text-xs text-gray-400 mb-6 italic">Earn passive income whenever someone resells access to your link.</p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isPublishing}
                  className="w-full bg-[#0052FF] text-white py-6 rounded-2xl font-black text-lg shadow-xl shadow-blue-500/25 hover:bg-blue-600 hover:shadow-2xl transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {isPublishing ? "Encrypting & Publishing..." : "Create Protected Link"}
                </button>
              </form>
            </div>

            {/* Quick Stats Grid */}
            <div id="earnings" className="grid grid-cols-1 sm:grid-cols-3 gap-6 scroll-mt-24">
              {[
                { label: 'Total Revenue', value: `${links.reduce((acc, curr) => acc + curr.totalEarned, 0).toFixed(2)} USDC`, icon: <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>, bgColor: 'bg-blue-50' },
                { label: 'Total Sales', value: links.reduce((acc, curr) => acc + curr.sold, 0).toString(), icon: <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>, bgColor: 'bg-purple-50' },
                { label: 'Avg Sale Price', value: links.length > 0 ? `${(links.reduce((acc, curr) => acc + curr.totalEarned, 0) / (links.reduce((acc, curr) => acc + curr.sold, 0) || 1)).toFixed(2)} USDC` : "0 USDC", icon: <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>, bgColor: 'bg-green-50' },
              ].map((stat, i) => (
                <div key={i} className="bg-white rounded-[2rem] border border-gray-100 p-8 flex flex-col items-center shadow-sm hover:shadow-lg transition-all">
                  <div className={`${stat.bgColor} w-16 h-16 rounded-[1.25rem] flex items-center justify-center mb-4 shadow-inner`}>
                    {stat.icon}
                  </div>
                  <p className="text-3xl font-black text-gray-900 mb-1">{stat.value}</p>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Your Links */}
          <div className="flex-1 lg:max-w-[420px]">
            <div id="my-links" className="bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-gray-200/20 p-8 md:p-10 h-full flex flex-col scroll-mt-24">
              <div className="flex justify-between items-center mb-10">
                <h3 className="text-xl font-black text-gray-900">Your Links</h3>
                <button className="text-[10px] font-black text-[#0052FF] uppercase tracking-widest hover:opacity-70 transition-opacity">View All</button>
              </div>

              <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {links.length > 0 ? (
                  links.map((link) => (
                    <div key={link.id} className="group p-1">
                      <div className="flex justify-between items-start mb-4">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest block">#{link.id}</span>
                          <h4 className="font-black text-gray-800 text-lg leading-tight group-hover:text-[#0052FF] transition-colors">{link.title}</h4>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-black text-green-600 block">${link.price.toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="flex gap-3 mb-4">
                        <button className="flex-1 flex items-center justify-center gap-2 py-3 bg-gray-50 border border-gray-100 text-gray-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                          Preview
                        </button>
                        <button
                          onClick={() => copyLink(link.id)}
                          className="w-12 h-12 flex items-center justify-center bg-gray-50 border border-gray-100 text-gray-400 rounded-xl hover:bg-blue-50 hover:text-[#0052FF] hover:border-blue-100 transition-all shadow-sm"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
                        </button>
                      </div>

                      <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest pt-2 border-t border-gray-50">
                        <span className="text-gray-400">{link.sold} sales ({link.totalEarned.toFixed(2)} USDC)</span>
                        <span className="text-blue-500 opacity-60">{link.royalty}% Royalty</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 opacity-40">
                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    </div>
                    <div>
                      <p className="font-black text-gray-400 text-sm">No links found</p>
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mt-1">Start monetizing today</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Resell Access Section (Secondary Market) */}
            <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-gray-200/20 p-8 md:p-10 mt-10">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight flex items-center gap-2">
                  <span className="w-2 h-6 bg-purple-500 rounded-full"></span>
                  Resell Your Access
                </h3>
                <span className="text-[10px] font-black text-purple-500 bg-purple-50 px-3 py-1 rounded-full uppercase tracking-widest">Secondary Market</span>
              </div>
              <p className="text-xs text-gray-400 mb-8 font-medium">Any link you've purchased can be resold here. You keep the earnings (minus the creator's royalty).</p>

              <div className="space-y-4">
                <p className="text-center py-8 text-gray-300 text-sm font-bold border-2 border-dashed border-gray-50 rounded-2xl">
                  Connect more links by purchasing access. <br />
                  <span className="text-[10px] uppercase mt-2 block tracking-widest text-[#0052FF]">Visit a Paid Link to Start</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer / Mobile Nav Spacer */}
      <footer className="h-12 border-t border-gray-100 mt-20"></footer>
    </div>
  );
}
