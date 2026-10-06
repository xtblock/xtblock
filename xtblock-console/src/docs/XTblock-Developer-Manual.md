# XTblock Developer Manual

2026-10-06 — covers xtcn 0.10.32 / Console 0.8.77

## Quick Start — deploy and call a contract end to end

A fully worked walkthrough, start to finish, using the `Counter` contract from §3.

0. **Easiest route (no install, no delegate):** open `http://<xtgw-host>:<rpc-port>/` in a browser. The **developer portal** served by every xtgw (0.10.29+) has Wallet, Deploy, Call, Explorer and Faucet tabs and does steps 2, 4 and 6 below for you. The Console's **Developer mode** (top-bar toggle) shows the same portal inside the Console.
1. **Get a chain to point at.** Ask your operator for an `xtgw` RPC URL and chain ID, or stand up your own local solo chain (Operator Manual — Quick Start) if testing independently.
2. **Get a funded account.** If the operator enabled the gateway faucet (`xt_chainInfo` shows `faucet.enabled`), use the portal's Faucet tab. Otherwise the Console has a **Tools → Faucet** utility your operator can use to send you test XTT — send them your wallet address.
3. **Compile** `Counter.sol` (§3) to get `Counter.bin` and `Counter.abi`.
4. **Deploy** via Console → Contract deploy / call → Deploy (§4), or the ethers.js script in §4's example. Note the deployed address.
5. **Verify** the deploy landed, using §4's `eth_call` check.
6. **Call `increment()`**, then **read `get()`**, via Console's Call tab or the ethers.js example in §5. Confirm the returned value increased by 1.
7. **Check the real receipt status** (§6) on the `increment()` transaction — confirm `status: 0x1`.

That's the full loop. §2–§7 cover the details this quick start skipped over: RPC methods, ABI-driven calls, debugging tools, and known limitations.

## 1. Introduction & Glossary

XTblock runs a real EVM execution engine (`revm`) inside a sharded, multi-delegate consensus system. Standard Solidity contracts compile and execute unmodified; what differs from a conventional single-chain EVM deployment is how a transaction reaches the chain and which shard it lands on. This manual covers writing, deploying, and calling contracts through the XTblock Console.

**Glossary**

* **RealTx** — the internal enum covering every transaction kind XTblock executes. The two kinds a contract developer submits are `SignedTransfer` and `RawEthTransfer` (below); others (`CreditApplication`, `TwoPcRecord`, `CheckpointRecord`) are internal, not developer-facing.
* **SignedTransfer** — XTblock's own native signed-transaction format (fields, not RLP-encoded). Submitted directly to delegate addresses over the node-to-node transport — this is an operator/tooling path, not the one a wallet uses.
* **RawEthTransfer** — a real, raw RLP-encoded legacy (type-0) Ethereum transaction, exactly what a wallet like MetaMask signs and sends. This is the path a dApp and a real wallet use, submitted via `eth_sendRawTransaction` through `xtgw`.
* **revm** — the real Rust EVM implementation executing contract bytecode. Gives full EVM semantics (CALL, CREATE, storage, logs, reverts) — not a simplified or partial interpreter.
* **Shard affinity** — a contract's code always executes on its deployer's own home shard, regardless of which shard its computed address would otherwise hash to. The Console enforces this at deploy time (§4).
* **mempool_cap** — the per-block inclusion limit for pending transactions (operator-configured; see the Operator Manual §4). Relevant to a developer mainly as a throughput ceiling to expect under load, not something a dApp configures.
* **Legacy-only transactions** — XTblock currently supports type-0 (legacy, EIP-155-signed) transactions only. No EIP-1559 (type-2) support. Detailed in §7.

**Who this manual is for**: an in-house developer with Console access, and an external/client-side developer working only against the RPC endpoint. Every deploy/call/debug section below gives both paths — **Option A (Console UI)**, if you have Console, and **Option B (RPC only)**, which needs nothing but the `xtgw` RPC URL and standard tools (ethers.js, curl). A few debugging tools (§6) are **Console-only**, with no RPC equivalent today — flagged where that's the case.

**What Console gives a developer that a bare RPC endpoint doesn't**: a shard-aware deploy/call form (tells you which shard a sender or contract is actually on before you submit, instead of a silent misroute or a mempool rejection after the fact), ABI-driven call encoding, and the same forensic tooling operators use (Explorer, divergence timeline, real per-transaction receipt status) for debugging a dApp's own transactions.

**Example — the two transaction paths, in outline:**

    // RawEthTransfer: the wallet/dApp path, a real legacy-signed RLP transaction
    const tx = await wallet.sendTransaction({ to, value, data, gasLimit, gasPrice });
    // submitted as eth_sendRawTransaction under the hood — see §2

    # SignedTransfer: XTblock's own operator/tooling path — NOT used by wallets/dApps
    xtcn --submit-tx <shard_id> <to_hex> <amount> auto <calldata_hex> <sender_private_key_hex>

## 2. Connecting to the Chain

**RPC endpoint**: every `xtgw` instance exposes standard `eth_*` JSON-RPC plus XTblock-specific `xt_*` methods, over the host/port your operator gives you. Register it in the Console under Explorer → **Known chains** (chain ID + host + port) so both the Console's own tooling and any read calls can reach it.

**Supported RPC methods** (the subset relevant to dApp development):

| Method | Purpose |
| --- | --- |
| `eth_chainId` | Chain ID for wallet/tooling configuration |
| `eth_blockNumber` / `xt_getLatestBlockNumber` | Current block height |
| `eth_getBalance` / `eth_getTransactionCount` | Account balance / nonce |
| `eth_gasPrice` / `eth_estimateGas` | Gas pricing and estimation |
| `eth_sendRawTransaction` | Submit a signed legacy transaction (the `RawEthTransfer` path) |
| `eth_call` | Read-only call (view/pure functions, or any call you don't want to broadcast) |
| `eth_getTransactionByHash` / `eth_getTransactionReceipt` | Look up a submitted transaction and its real execution status |
| `eth_getCode` | Contract bytecode (checked on the home shard first, then the others); `0x` if none. Remix calls this before every contract transaction |
| `eth_getBlockByNumber` / `eth_getBlockByHash` / `xt_getBlock` | Block data |
| `eth_syncing` | Always returns `false` — no partial-sync state is exposed over RPC |

**Wallet setup**: point a standard wallet (MetaMask or similar) at the `xtgw` RPC URL and the chain ID from `eth_chainId`. No custom wallet software is required — XTblock deliberately omits `baseFeePerGas` from block responses so wallets default to legacy (type-0) transactions automatically (§7).

**Where the chain ID from `eth_chainId` comes from**: it's deterministic, not something your operator typically assigns by hand — derived from the chain's internal `chain_id` string via a `blake3` hash truncated to 4 bytes, so the same chain always reports the same `eth_chainId` across restarts and across every `xtgw` instance in front of it. Ask your operator for it once (or read it straight off the RPC) and save it in your wallet/SDK config — it won't change unless the operator deliberately sets an explicit override (Operator Manual §4).

**Remix Studio**: works the same way — Remix's **Injected Provider – MetaMask** environment hands signing to MetaMask, which sends `eth_sendRawTransaction` to whichever RPC MetaMask is pointed at. No XTblock-specific setup: connect MetaMask to the `xtgw` RPC URL + chain ID as above, then select "Injected Provider – MetaMask" in Remix's **Deploy & Run Transactions** panel. Caveat: Remix's **At Address** feature, used to reattach to an existing contract and backfill its historical event log, typically depends on `eth_getLogs` — not implemented here (§7). A fresh deploy-and-interact session in one sitting works fine; re-attaching later to pull past event history likely won't.

**MetaMask settings (testnet)**: Network name `XTB-Testnet-003`, RPC URL = your operator's `xtgw` URL (e.g. `http://192.168.1.10:9120` on a LAN), Chain ID = the decimal value from `eth_chainId` (e.g. `0xe9ae183d` = 3920500797), **Currency symbol `XTT`**. Remix hardcodes the label "ETH" next to amounts and its **Value** field is global (Deploy & Run panel) — set it to the amount before calling a payable function, then reset it to 0. The amounts are real XTT regardless of the label.

**Every shard delegate must report the same `eth_chainId` as `xtgw`.** From xtcn 0.10.20 delegates derive it automatically from the network chain; on older builds, set `eth_chain_id` in every shard delegate's `node.toml`, or wallet transactions are silently dropped (the delegate logs "rejected a gossiped SubmitRawEthTx — real EIP-155 signature failed to recover").

**Receipts**: `status` is real, and `contractAddress` is returned for a successful creation. From xtcn 0.10.30 `gasUsed` is the real gas of the transaction (plain value transfers still report 0 because they do not run through the EVM) and `logs` holds the events the contract emitted (address, topics, data, logIndex). `logsBloom` is still all zeros and `cumulativeGasUsed` equals `gasUsed`. Events are indexed by each delegate (default about one day of blocks per shard, set by the operator) and survive restarts (xtcn 0.10.31+); they are not available for blocks a delegate only received through state sync (§7).

**Same-shard deployment rule**: a contract lives on its deployer's home shard, and its address is `CREATE(sender, nonce)`; it must hash to the same shard as the deployer to be callable. xtgw enforces this: a wallet deployment whose address would land on another shard is rejected with a message giving the nonce to use — send that many 0-value self-transfers to advance your nonce, then deploy again. The Console deploy path does this automatically.

**Transaction types accepted**: legacy (type-0) only. A wallet or SDK that forces a type-2 (EIP-1559) transaction will be rejected — see §7 for the exact error and why.

**Example — basic RPC calls a dApp needs at startup:**

    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
    
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xYourAddress","latest"]}'

    // ethers.js: point a standard provider at the xtgw RPC URL, nothing XTblock-specific needed
    import { JsonRpcProvider, Wallet } from "ethers";
    const provider = new JsonRpcProvider("http://localhost:8645");
    const wallet = new Wallet(PRIVATE_KEY, provider);
    console.log(await provider.getNetwork()); // chainId from eth_chainId

**Funding a new account**

Testnet funds come from the **Console faucet** (Tools → Faucet): the operator enters a funded sender key (EVM secp256k1), enters the xtgw RPC, an amount (XTT or wei, with a live digit count) and one or more recipient addresses. The Console signs a standard wallet-style transaction (needs xtcn 0.10.22+ installed) and sends it through the xtgw, shows the sender's and recipients' shards and balances, refuses amounts above the sender's balance, and confirms each credit (60-second per-address cooldown). Recipients must be on the sender's shard. There is no public faucet RPC — ask your operator and give them your wallet address.

Why a MetaMask (EVM) address can hold XTT: all accounts are secp256k1 with Ethereum Keccak address derivation — XTT is the chain's native token for every address. Ed25519 is only the delegates' consensus key.

## 3. Writing & Compiling Smart Contracts

Because execution runs on a real `revm` instance, contracts are written and compiled with standard Ethereum tooling — nothing XTblock-specific is needed at the language or compiler level.

* **Language**: Solidity (or any language targeting EVM bytecode).
* **Compiler**: `solc`, Hardhat, Foundry, or Remix — whichever you already use. Compile to get **init bytecode** (for deployment) and, separately, the contract's **ABI** (for calling functions afterward).
* **What's standard EVM behavior, unchanged**: `CALL`, `CREATE`, storage reads/writes, events/logs, reverts, `msg.sender`/`msg.value` semantics.
* **What to keep in mind while writing, specific to this chain**:
  * A contract's code executes only on its deployer's own home shard (§1, §4) — a contract that needs to interact with state on a different shard needs cross-shard design (2PC), not a same-shard assumption.
  * `receive()`/`fallback()`: a call with empty calldata routes to `receive()` if defined, exactly per EVM spec — this has caused real confusion where a `deposit()` call reverted to `receive()` silently because calldata encoded empty by mistake (§5 covers how to catch this in Console before sending).
  * No EIP-1559 fee-market opcodes/behavior to design around from the contract side — gas pricing is legacy-style (§7).

Once you have bytecode + ABI, proceed to §4 (Deploying) and §5 (Interacting).

**Example — a minimal contract and standard compile step (nothing XTblock-specific):**

    // SPDX-License-Identifier: MIT
    pragma solidity ^0.8.24;
    
    contract Counter {
        uint256 public count;
    
        function increment() external {
            count += 1;
        }
    
        function get() external view returns (uint256) {
            return count;
        }
    }

    solc --bin --abi Counter.sol -o build/
    # build/Counter.bin  -> init bytecode, used in §4 (Deploy)
    # build/Counter.abi  -> ABI JSON, used in §5 (Call)

## 4. Deploying a Contract via Console UI

**Option A — Console UI** (requires Console access). Console: **Contract deploy / call** → **Deploy** tab. The Console signs a standard wallet-style (legacy EIP-155) transaction locally and sends it through the **xtgw RPC** — no delegate or `node.toml` needed (requires xtcn 0.10.23+ installed next to the Console).

1. **Set the xtgw RPC** (`host:port`) at the top of the modal — it is picked from Explorer → Known chains automatically, or type one.
2. **Enter the sender's EVM private key** (secp256k1, 64 hex digits — the same kind of key as a MetaMask account key; never an Ed25519 key, which is only a delegate's consensus key). The Console shows which shard the sender belongs to. Generate one under Tools → **Keys → Generate EVM key + address**.
3. **Paste init bytecode (hex, no `0x`)** — the compiled bytecode from §3. For a constructor with parameters, paste the contract **ABI** too: the Console shows one input per parameter (like Remix) and encodes them for you. Without an ABI you can paste ABI-encoded constructor-argument hex yourself.
4. **Shard target**: *Same as sender's shard* (recommended) or *Specific shard N*. A contract's code always lives on its deployer's shard, so a specific shard only works if the sender key is on that shard (the Console tells you otherwise). The Console reads the sender's nonce from the xtgw and, if needed, advances it with 0-value self-transfers until the contract address also hashes to the target shard.
5. Click **Deploy**. The Console waits for the receipt and shows the status and the contract address.
6. Click **Verify `0x<address>` is deployed** to confirm the deployment actually landed: this runs a real, empty-calldata `eth_call` against the address and checks for real code, rather than trusting the predicted address alone.

**Known limitation**: contract code survives a restart; contract **storage** does not yet persist between blocks — a separate, still-open item. Confirm with your operator whether this affects your demo/test scenario before relying on persisted contract state across a restart.

**Same-shard deployment isn't Console-exclusive.** `xtgw`'s `eth_sendRawTransaction` handler derives the sender's home shard from their address (`shard_for_address`) and routes every submission there automatically — the same rule the receiving delegate independently re-checks and enforces regardless of how the transaction arrived. Console's "Sender is on shard N" display and locked shard-target field are a visibility convenience, not a requirement: Option B below (raw `eth_sendRawTransaction`, Remix, ethers.js) gets the same correct, automatic same-shard deployment with no Console or `xtcn` CLI involved.

**Option B — Scripted deploy (RPC only, no Console needed).** The path for a developer without Console access — equivalent to the Console's Deploy tab above, using nothing but the `xtgw` RPC URL:

Prefer a GUI over a script? Remix Studio's **Deploy & Run Transactions** panel (Injected Provider – MetaMask) makes the same `eth_sendRawTransaction` call — see §2's "Remix Studio" note for setup and its one caveat.

    import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
    import fs from "fs";
    
    const provider = new JsonRpcProvider("http://localhost:8645");
    const wallet = new Wallet(PRIVATE_KEY, provider);
    
    const bytecode = "0x" + fs.readFileSync("build/Counter.bin", "utf8").trim();
    const abi = JSON.parse(fs.readFileSync("build/Counter.abi", "utf8"));
    
    const factory = new ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy(); // legacy tx under the hood — no EIP-1559 fields
    await contract.waitForDeployment();
    console.log("deployed at", await contract.getAddress());

**Verify it landed (same check the Console's "Verify is deployed" button runs):**

    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x<deployed address>","data":"0x"},"latest"]}'

## 5. Interacting with Contracts & Transactions via Console

**Option A — Console UI** (requires Console access). Console: **Contract deploy / call** → **Call** tab.

1. **Set the xtgw RPC** (same field as Deploy). Reads, writes and receipts all go through it; no `node.toml` is needed.
2. **Enter the contract address (hex, no `0x`)**. The Console shows which shard it is on. A call only works when the **sender key is on the same shard as the contract**: once you enter the sender's EVM key, the Console shows the sender's shard and a green ✓ (same shard) or an amber ✗ (different shard — the call silently does nothing, acting like a plain value transfer).
3. **Paste the contract ABI (JSON)** — required for every call, to keep one consistent, unambiguous path (matching Remix's own behavior) rather than a second, editable-calldata fallback.
4. **Pick the function** from the dropdown built off the ABI. For a function with arguments, fill each argument field (type-hinted placeholders shown). The exact calldata this will send is shown read-only underneath, so a mismatch (e.g. an accidental empty-calldata call routing to `receive()` instead of your intended function, §3) is visible before you send, not discovered afterward in delegate logs.
5. **Read vs. write, handled automatically**:
  * A `view`/`pure` function is read via `eth_call` — no nonce, no private key, no broadcast. Button reads **Read (no tx)**. Optionally set **Read as address** if the function reads `msg.sender` internally (e.g. a `myBalance()`-style call) — only relevant there; a function taking an address as an explicit argument doesn't need this.
  * Any other function requires **Nonce** (default `auto`) and the **sender's private key**, and is submitted as a real transaction. Console again shows which shard the sender is on and warns — here the mismatch is a hard mempool rejection, not a silent misroute.
6. **Value** only appears for a function whose ABI marks it `payable`.
7. Click **Read (no tx)** or **Send transaction**.

**Keys**: Deploy, Call, Read-as and the Faucet all take an **EVM (secp256k1) private key**. Ed25519 keys cannot sign transactions.

**Cross-shard note**: this only works at all if the sender's key belongs to the same shard as the contract (§7). Calling a contract from a key on a different shard doesn't error — it silently executes as a no-op on the caller's own shard, where the contract has no code.

**Confirming a write actually landed**: check the transaction via `eth_getTransactionReceipt` (Explorer → Search, or RPC directly). Real per-transaction `status` (success/revert) and `gasUsed` are reported — a reverted call now genuinely shows `status: 0x0`, not a false "Confirmed."

**Option B — Scripted read/write (RPC only, no Console needed)**, equivalent to the Console's Call tab above:

Remix Studio's **Deployed Contracts** panel calls functions from your contract's ABI the same way — reads via `eth_call`, writes via a signed `eth_sendRawTransaction` with MetaMask prompting for each one. See §2's "Remix Studio" note.

    const contract = new Contract(contractAddress, abi, wallet);
    
    // read: eth_call, no gas, no nonce
    const current = await contract.get();
    
    // write: real transaction, nonce resolved automatically by ethers
    const tx = await contract.increment();
    const receipt = await tx.wait();
    console.log("status:", receipt.status); // 1 = success, 0 = reverted — real per-tx status

    # equivalent raw eth_call for a view function (function selector + encoded args as data)
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x<contract>","data":"0x6d4ce63c"},"latest"]}'

## 6. Debugging Tools in Console for DApp Developers

**Without Console access**, you still have direct RPC: `eth_getTransactionReceipt` (real status/gasUsed) and `eth_call` work from any script, no operator involvement needed. The Explorer-based tools below — Search, Compare across delegates, Divergence timeline — are **Console-only** and normally need your operator's help, since they reach delegate-internal state your RPC endpoint alone doesn't expose. If you suspect a consensus-level issue, hand your operator the transaction hash, shard ID, and block number rather than trying to run these yourself.

* **Real receipt status** — `eth_getTransactionReceipt` reports the transaction's real execution `status` (success/revert) and real `gasUsed`, not a hardcoded success. Use this first when a transaction "confirms" but doesn't produce the state change you expected — a revert will now show as `status: 0x0` instead of looking identical to success.
* **Explorer → Search** — look up any transaction or block by hash directly, without leaving the Console.
* **Explorer → Browse a block / block detail view** — shows a block's full transaction list, and for a cross-shard transaction, a **Cross-shard lookup** panel.
* **Compare across delegates** — if a contract call behaves inconsistently (works from one delegate's view, not another), this confirms whether the shard's own delegates have actually diverged, rather than a client-side issue.
* **Divergence timeline** — once divergence is confirmed, pins down exactly which block it started at (walk-backward or binary search, §6 of the Operator Manual) — useful context to hand your operator when reporting an inconsistency.
* **Visible calldata preview** — in the Call form (§5), the exact encoded calldata for the selected function is shown read-only before sending. This is the fastest way to catch an argument-encoding mistake, or the `receive()`-vs-`deposit()` empty-calldata trap (§3), before it costs a debugging session.

When something looks wrong end-to-end and none of the above explains it, hand your operator: the transaction hash, the shard ID, and the block number — that's everything the Operator Manual's §6 forensic tools need to start from.

**Example — pulling a real receipt to check why a call didn't do what you expected:**

    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x<tx hash>"]}'
    # {"status":"0x0", "gasUsed":"0x...", ...}  <- 0x0 means it reverted, even though it was mined

    # if a contract behaves inconsistently depending on which delegate answers, confirm divergence:
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"xt_compareDelegates","params":[<shard_id>,<block_number>]}'

## 7. Known Limitations & Compatibility Notes

* **Legacy transactions only — no EIP-1559 (type-2)**. Only real, legacy (type-0), EIP-155-signed RLP transactions are accepted. A type-2 transaction is correctly rejected with `"invalid raw transaction: expected an RLP list (a legacy transaction), found a plain string"`. Standard wallets don't normally hit this: `baseFeePerGas` is deliberately omitted from `eth_getBlockByNumber`/`eth_getBlockByHash`, which is the standard signal telling a wallet "no EIP-1559 here," so MetaMask and similar wallets default to legacy automatically. It surfaces only if a wallet/SDK is configured to force type-2, or a transaction is hand-constructed. This is independent of XTblock's own, separately-built fee market (base-fee auto-adjustment) — what's missing is specifically the EIP-1559 transaction envelope, not fee-market functionality.
* **Events: partial support (0.10.30).** `eth_getLogs` works (filter by `address`, `topics` with OR lists and null wildcards, `fromBlock`/`toBlock`), and receipts carry `logs`. Limits: `blockHash` filters and `eth_newFilter`/`eth_getFilterChanges`/subscriptions are not implemented; block numbers in a filter are SHARD block numbers (each shard has its own height, so `eth_blockNumber` — the coordinator height — is not a valid bound); retention is set by the operator (default 86,400 blocks, about a day, kept on disk so restarts keep them; blocks a delegate only synced have none); a query matching 10,000 or more logs on one shard returns an error, so narrow the block range or add an address/topic filter; no bloom. ethers `queryFilter` works with explicit shard block numbers; `contract.on(...)` does not (no filters/subscriptions): poll `eth_getLogs` instead.
* **No account/contract enumeration.** There is no RPC (or Explorer feature) that lists all deployed contracts or all wallet addresses, per shard or chain-wide — not even a count. Every delegate's state is internally just an address-keyed map, but nothing exposes enumerating it. This gap comes from there being no indexing layer yet. Workarounds today: track contract deployments and unique addresses yourself by scanning blocks (`xt_getBlock`/`eth_getBlockByNumber`) client-side, or ask your operator whether a project-specific indexing solution exists. Flag this early in your design if a port of an existing Ethereum dApp assumes a block-explorer-style contract/wallet directory or long event history.
* **No cross-shard contract calls — a caller must be on the contract's own shard.** A transaction only ever executes on the sender's home shard (`shard_for_address` computed on the sender, never the contract) — the receiving delegate rejects anything else at the mempool level. Since a contract's code only exists on its deployer's home shard (§4), a caller whose key hashes to a different shard can't actually invoke it: the call executes on the caller's own shard, where that address has no code, and silently behaves like a plain value transfer (calldata discarded) rather than erroring. The only cross-shard mechanism that exists is 2PC (Console → Tools → Cross-shard (2PC)): it commits one transaction **per shard** atomically — each leg can be a value transfer or a call to a contract on *that leg's own shard* (with ABI-built calldata), but no leg can call a contract on another shard or use another leg's result. Design any multi-shard dApp around this: every caller of a given contract needs a key whose address hashes to that contract's home shard.
* **Synthetic transactions removed.** New chains set `synthetic_txs = false`, so blocks contain only real user transactions (empty blocks are normal). Older configs without the field keep the built-in per-block test transactions.
* **Gas pricing**: `eth_gasPrice`/`eth_estimateGas` work as on any EVM chain, but there is no published minimum gas price or documented pricing policy in this manual — use `eth_gasPrice`'s live value rather than hardcoding one, and confirm with your operator if you need a guaranteed floor for a demo.
* **Contract storage persists** (SLOAD/SSTORE results survive blocks and restarts, and are carried by state-sync). Verified live with a counter contract and with TestVault `deposit()`/`myBalance()`.
* **`mempool_cap` is a real throughput ceiling**, shared between `SignedTransfer` and `RawEthTransfer` pools (each capped independently at the same configured value). A transaction submitted beyond the per-block cap is queued for the next block, not dropped — expect delay under burst load, not failure.
* **`zero_gas_mode`**, if your operator has enabled it, mints balance directly to keep a sender topped up — an intentional, off-by-default convenience for enterprise/private deployments. Don't assume it's active; check with your operator, since gas-cost assumptions in your dApp's UX may otherwise be wrong.
* **`eth_syncing` always returns `false`** — no partial-sync progress is exposed over RPC; don't build UX that depends on reading sync progress this way.

**Example — what a rejected EIP-1559 submission actually looks like, and how to confirm the chain is legacy-only before debugging further:**

    # a type-2 (EIP-1559) raw tx submitted via eth_sendRawTransaction:
    # {"error":{"message":"invalid raw transaction: expected an RLP list (a legacy transaction), found a plain string"}}
    
    # confirm the chain signals legacy-only (no baseFeePerGas in a block response):
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}'
    # no "baseFeePerGas" field -> standard wallets already default to legacy, no extra config needed

## 8. Cross-shard transactions (2PC) — what they do and do not do

A 2PC transaction commits **one transaction per shard, atomically**. Each leg is a normal transaction signed by a key whose home shard is that leg's shard; a leg can be a plain transfer or a contract call to a contract that lives on that same shard. 2PC does **not** let one leg call a contract on another shard, and it does not move funds between shards.

Phases: (1) the coordinator sends **Prepare** to every shard; (2) each shard tentatively executes its leg, locks the sender and the recipient/contract address, and votes **Ready** or **Abort**; (3) the coordinator sends **Commit** only if every shard voted Ready, otherwise **Abort**, and the decision is written to the coordinator chain as a 2PC record. If any leg fails in Prepare (revert, insufficient balance, wrong nonce, locked address) the whole transaction aborts and no balance changes.

Known limits (see KNOWN_ISSUES_AND_ROADMAP.md): the decision is sent once with no retry or acknowledgement, and a prepared shard drops its leg after `two_pc_lock_expiry_secs` (30 s) if no decision arrives. In that rare case one shard can commit while the other drops its leg. A 3-timeouts-per-60-s rate limit applies per address.

Practical rules: a transaction ID must be unique per attempt (the Console generates a fresh one after every run); for a contract-call leg the sender key must be on the contract's shard (the 2PC form checks this and checks `eth_getCode`); amounts are real XTT and the sender is debited, no top-up exists unless the operator wrongly enabled `zero_gas_mode`.

## 9. Building on XTblock without running a delegate

**Recommended workflow:** deploy contracts ONLY with the portal (or the Console), because they handle the shard rule (the contract address must hash to your own shard) by sending the 0-value self-transfers for you. Use MetaMask/ethers for plain transfers and for calling contracts that are already deployed.

**Developer portal** (xtgw 0.10.29+): open `http://<xtgw-host>:<rpc-port>/`. Tabs: *Wallet* (create/import an EVM key, balance, nonce, shard, send XTT), *Deploy* (bytecode + ABI, constructor fields, automatic shard alignment, receipt and code verification), *Call* (ABI-driven reads via `eth_call` and writes), *Explorer* (latest heights, recent blocks per shard, block by number, transaction, address, 2PC record lookup), *Faucet*. The private key stays in the browser; it is stored only if you tick "remember". Gateway extras: `xt_chainInfo` (chain name, chain id, shard count, reachable shards, faucet info) and `xt_faucetDrip(address)`.

**Operator setup for the faucet** (testnet only): in xtgw.toml, inside the `[[chains]]` entry, set `faucet_private_key_hex` (a dedicated EVM key; stored in plain text), optionally `faucet_drip_wei` (default 1 XTT) and `faucet_cooldown_secs` (default 3600, per address). Fund that account on its own shard. Network-map-driven gateways (no `[[chains]]` entry) put the same three `faucet_*` lines at the TOP LEVEL of xtgw.toml, before the first `[table]`/`[[table]]` header. If a claim mines but the balance does not rise, the faucet account is empty.

**Console Developer mode**: the **Developer mode** button in the top bar hides instances, New chain, Connect, Tools and Add operator, and shows the portal for the gateway address you type, plus Keys, Shard lookup and Manuals. Click it again to return to node management. Only the gateway address is remembered. **Open in browser** opens the same portal in your default browser. The portal always talks to the gateway that served it (its address bar), so it has no gateway field of its own. Right-click is disabled inside the Console's portal view (it could reload the Console window); use the keyboard for copy and paste there, or open the portal in your browser.

A developer only needs an **xtgw RPC URL** (and the chain's `eth_chain_id`). Everything below goes through xtgw:

* Wallet/dApp tooling that signs legacy (type-0) EIP-155 transactions (MetaMask, ethers, web3) can send via `eth_sendRawTransaction`.
* The Console's Contract deploy/call and Faucet sign locally and send through xtgw; no delegate selection and no delegate access is required.
* Sharding rules still apply: your account lives on `shard_for_address(address)`; a contract's code lives on its deployer's shard; xtgw rejects a deployment whose address would hash to another shard and tells you which nonce to use (the Console advances the nonce with 0-value self-transfers automatically).
* `eth_estimateGas` is a conservative heuristic (21000 for a plain transfer, about 200,000 + 400/byte for a deployment, 300,000 for a call with calldata), not a simulation. Revert reasons are not returned.
