"use client";

import { useState, useEffect, use } from "react";
import { Wallet } from "@coinbase/onchainkit/wallet";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { BASE_REVENUE_OS_ADDRESS, BASE_REVENUE_OS_ABI } from "../../contracts/config";
import { parseUnits, formatUnits } from "viem";
import CryptoJS from "crypto-js";

// Interface matching our smart contract structure
interface PaidLink {
  creator: string;
  price: bigint;
  title: string;
  contentHash: string;
  sold: bigint;
  totalEarned: bigint;
  royaltyPercent: bigint;
}

export default function LinkPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId: linkIdRaw } = use(params);
  const [hasPurchasedLocal, setHasPurchasedLocal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { address } = useAccount();
  const linkId = BigInt(linkIdRaw);

  // Read Link details from Contract
  const { data: linkData, refetch: refetchLink } = useReadContract({
    address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
    abi: BASE_REVENUE_OS_ABI as any,
    functionName: "paidLinks",
    args: [linkId],
  }) as { data: readonly [string, bigint, string, string, bigint, bigint, bigint] | undefined, refetch: any };

  // Check if current user has purchased
  const { data: hasPurchasedContract } = useReadContract({
    address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
    abi: BASE_REVENUE_OS_ABI as any,
    functionName: "hasPurchased",
    args: [linkId, address as `0x${string}`],
    query: {
      enabled: !!address,
    }
  });

  const isPurchased = hasPurchasedContract || hasPurchasedLocal;

  const { writeContractAsync } = useWriteContract();

  // Basic USDC ABI for approval
  const USDC_ABI = [
    {
      inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
      name: "approve",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function",
    },
  ] as const;
  const USDC_ADDRESS = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"; // Base Sepolia Official USDC

  const handlePurchase = async () => {
    if (!address) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!linkData) return;

    setIsLoading(true);
    try {
      const priceInUSDC = linkData[1]; // Price is the second element returned from paidLinks tuple

      // 1. Approve USDC spend
      await writeContractAsync({
        address: USDC_ADDRESS as `0x${string}`,
        abi: USDC_ABI,
        functionName: "approve",
        args: [BASE_REVENUE_OS_ADDRESS as `0x${string}`, priceInUSDC],
      });

      // Simple delay to allow RPC catchup - in prod use waitForTransaction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 2. Buy the link
      await writeContractAsync({
        address: BASE_REVENUE_OS_ADDRESS as `0x${string}`,
        abi: BASE_REVENUE_OS_ABI as any,
        functionName: "buyLink",
        args: [linkId],
      });

      setHasPurchasedLocal(true);
      alert("Purchase successful! Decrypting content...");
      refetchLink();
    } catch (error) {
      console.error("Purchase failed:", error);
      alert("Purchase failed. Check console for details.");
    } finally {
      setIsLoading(false);
    }
  };

  // Safe destructure if missing
  const creator = linkData ? linkData[0] : "Loading...";
  const price = linkData ? formatUnits(linkData[1], 6) : "0";
  const title = linkData ? linkData[2] : "Premium Content";
  const encryptedContent = linkData ? linkData[3] : "";

  // Decryption Logic
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState("");

  const attemptDecryption = (key: string) => {
    if (!encryptedContent) return;
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedContent, key);
      const originalText = bytes.toString(CryptoJS.enc.Utf8);
      if (originalText && originalText.startsWith('http')) {
        setDecryptedUrl(originalText);
      } else if (originalText) {
        setDecryptedUrl(originalText); // Secret text
      } else {
        alert("Invalid Key. Please check and try again.");
      }
    } catch (e) {
      alert("Decryption failed. Invalid format.");
    }
  };

  useEffect(() => {
    if (isPurchased && encryptedContent) {
      const hash = window.location.hash;
      const keyParam = hash.split('key=')[1];
      if (keyParam) {
        attemptDecryption(keyParam);
      }
    }
  }, [isPurchased, encryptedContent]);

  const contentUrl = isPurchased ? (decryptedUrl || "Encryption Protected") : "Locked Content";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-bold text-gray-900">Base Revenue OS</h1>
            <Wallet />
          </div>
        </div>
      </header>

      <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
        {/* Content Preview */}
        <div className="p-8 md:p-12">
          <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
            <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-bold bg-[#0052FF]/10 text-[#0052FF] border border-[#0052FF]/20">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
              Secure Paid Link #{linkId.toString()}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-blue-400 to-indigo-500"></div>
              <span className="text-sm font-medium text-gray-600">
                {creator.slice(0, 6)}...{creator.slice(-4)}
              </span>
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">
            {title}
          </h1>

          <p className="text-xl text-gray-600 mb-10 leading-relaxed max-w-2xl mx-auto text-center">
            Purchase this to instantly unlock the creator's closely guarded content URL.
          </p>

          {/* Price and Purchase Section */}
          <div className="border-t border-gray-100 pt-10">
            {!isPurchased ? (
              <div className="text-center max-w-sm mx-auto">
                <div className="mb-8">
                  <div className="inline-block relative">
                    <span className="text-5xl font-black text-gray-900">
                      {price}
                    </span>
                    <span className="text-2xl font-bold text-gray-500 ml-2">USDC</span>
                  </div>
                  <p className="text-gray-500 mt-3 font-medium flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                    One-time payment
                  </p>
                </div>

                <button
                  onClick={handlePurchase}
                  disabled={isLoading}
                  className="w-full bg-[#0052FF] text-white py-4 px-8 rounded-xl text-lg font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:scale-[0.98] flex items-center justify-center gap-3 relative overflow-hidden group"
                >
                  {/* Button Shine Effect */}
                  <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>

                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Processing...
                    </span>
                  ) : (
                    <>
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /><path d="M11 16h2v-2h-2v2zm0-8h2v5h-2V8z" fill="white" /></svg>
                      Pay & Unlock Content
                    </>
                  )}
                </button>

                <p className="text-sm text-gray-400 mt-6 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                  Secured by Base Revenue OS
                </p>
              </div>
            ) : (
              <div className="text-center max-w-xl mx-auto">
                <div className="mb-10 p-6 bg-green-50 rounded-2xl border border-green-100 flex flex-col items-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500 rounded-full mb-6 shadow-lg shadow-green-500/30">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-3xl font-black text-green-800 mb-2 tracking-tight">
                    Payment Successful!
                  </h2>
                  <p className="text-green-700 font-medium text-lg">
                    Your premium content is now unlocked forever.
                  </p>
                </div>

                {/* Content Reveal Section */}
                <div className="bg-white rounded-2xl p-8 text-left shadow-lg border border-gray-200 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
                  <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                    <span className="text-2xl">🎉</span> Here is your content:
                  </h3>

                  <div className="space-y-6">
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                      <label className="block text-sm font-bold text-gray-600 mb-3 uppercase tracking-wider">
                        Magic Link URL
                      </label>
                      <div className="flex items-center space-x-3">
                        <input
                          type="text"
                          value={contentUrl}
                          readOnly
                          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg bg-white font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {isPurchased && !decryptedUrl && (
                        <div className="mt-6 p-5 bg-blue-50/50 border border-blue-100 rounded-xl space-y-3">
                          <p className="text-sm font-bold text-blue-800 flex items-center gap-2">
                            <span>🔒</span> KEY REQUIRED FOR DECRYPTION
                          </p>
                          <p className="text-xs text-blue-600">This content is protected by AES-256 encryption. Please enter the secret key provided by the creator.</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Paste Secret Key Here..."
                              value={manualKey}
                              onChange={(e) => setManualKey(e.target.value)}
                              className="flex-1 px-4 py-2 text-sm border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              onClick={() => attemptDecryption(manualKey)}
                              className="bg-[#0052FF] text-white px-6 py-2 rounded-lg text-sm font-black shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-transform"
                            >
                              Unlock
                            </button>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(contentUrl);
                          alert("Link Copied!");
                        }}
                        className="px-6 py-3 bg-gray-900 text-white font-bold rounded-lg hover:bg-gray-800 transition-colors shadow-sm whitespace-nowrap"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-center">
                    <a
                      href={contentUrl.startsWith('http') ? contentUrl : `https://${contentUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex justify-center items-center px-8 py-4 bg-[#0052FF] text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl active:scale-[0.98]"
                    >
                      <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Open Exclusive Content
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trust Indicators */}
        <div className="mt-8 text-center pb-20">
          <div className="flex items-center justify-center space-x-8 text-sm text-gray-500">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Secure Payment
            </div>
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Instant Access
            </div>
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Lifetime Access
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
