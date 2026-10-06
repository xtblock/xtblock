# XTblock Operator Manual

2026-10-06 — covers xtcn 0.10.32 / Console 0.8.77

## Quick Start (single-machine test chain)

Fastest path to one running chain, to try the product before reading the rest of this manual. Every delegate/gateway you create here is a standalone **solo instance** (`own_index`` = ``0`, `delegate_count = 1`) with its own auto-generated TLS identity — no genesis manifest, no Key generator, no separate identity step required. Not fault-tolerant (no real quorum with one delegate) — for local testing only, not production.

1. Install the Console app and place the `xtcn`/`xtgw` binaries where Console expects them (§2).
2. Console → **New instance** → pick the **Delegate (xtcn)** preset → Next.
3. Leave the xtcn role as `shard` (a label only, §4) — no manifest, no identity file, no port to fill in; Console generates a fresh self-signed identity and a complete default `node.toml` for you.
4. Name the instance, leave **Start instance immediately after creation** checked, and finish the wizard.
5. Repeat steps 2–4 once more, picking the **Gateway (xtgw)** preset instead, to get an `xtgw` you can send RPC calls to.
6. Confirm it's alive via Explorer → **Known-chain health**, or the RPC example in §1.

This is the whole flow — a bare solo instance needs no `genesis_manifest_path` (it's optional and unset by default) and boots on its own isolated single-delegate chain. To link several solo instances into one real multi-delegate chain group, or to create a real, named, signed chain shared across operators, see §3.

## 1. Introduction & Glossary

XTblock is a proprietary, sharded EVM blockchain. Transaction execution and consensus are split across independent **shard groups**, coordinated by a separate **coordinator chain**, so throughput scales by adding shards rather than by making one chain faster. This manual covers setup, configuration, and day-to-day operation through the XTblock Console desktop app.

**Glossary**

* **Node** — a single running process, either `xtcn` (a consensus participant: a shard delegate or a coordinator replica) or `xtgw` (a stateless RPC gateway with no vote in consensus).
* **Delegate** — one `xtcn` instance participating in consensus for a specific shard. A shard normally runs several delegates (`delegate_count`) that must agree (reach quorum) on every block.
* **Shard** — an independent partition of the chain's state and transaction load, identified by `shard_id`. Each shard runs its own consensus among its own delegates.
* **Coordinator chain** — a separate consensus group (conventionally `shard_id = 999`) that does not hold shard state itself. It sequences cross-shard work: two-phase commit (2PC) transactions, checkpoints, and shard registration.
* **Quorum** — the minimum number of delegates in a shard (or coordinator replicas) that must agree on a block before it is considered final.
* **Genesis manifest** — the signed, original file that defines a chain at creation: chain ID, shard count, delegate roster, initial token allocations, and fee/gas parameters. Created once, when the chain is founded.
* **Network map** — a signed, updatable file (distinct from the genesis manifest) that publishes the current set of trusted delegate/coordinator/gateway addresses and TLS public keys, so nodes and `xtgw` can discover and trust each other without manual re-configuration every time the roster changes.
* **xtgw (gateway)** — the RPC-facing binary. Exposes `eth_*`/`xt_*` JSON-RPC, routes requests to the right shard's delegates, and holds no consensus state of its own.
* **xtops / xtops-agent** — a lightweight agent process that runs on a remote host so the Console can manage that host's local `xtcn`/`xtgw` instances from elsewhere (start/stop, live status), without the Console itself running there. Connected from Console via §5.4.
* **Mempool** — the pool of transactions a delegate has accepted but not yet included in a block. Bounded per block by `mempool_cap` (§4).
* **2PC (two-phase commit)** — the protocol the coordinator chain uses to atomically commit a transaction that touches more than one shard.
* **Checkpoint** — a shard's periodic, signed summary of its own state, submitted to the coordinator chain so cross-shard work can reference a shard's state without querying every delegate directly.

**Example — confirm a gateway is live and read its chain ID:**

    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
    # {"jsonrpc":"2.0","id":1,"result":"0x..."}

## 2. System Requirements & Installation

**Minimum hardware floor per host (§28)**

| Resource | Minimum |
| --- | --- |
| CPU | 8 cores |
| RAM | 32 GB |
| Disk | 500 GB |
| Network | 1.0 Gbps link speed |

A host below this floor can still run in dev/test (the Console reports "BELOW FLOOR — proceeding anyway, dev/test context" rather than refusing), but throughput observed on it is a conservative floor, not the number to plan capacity around — see §4 on `mempool_cap` for how to size a rate limit from a below-floor test.

**Platform**: the Console builds for Windows, macOS, and Linux (Tauri, `targets: all`), but is primarily developed and tested on Windows — config-path examples throughout this manual use Windows-style paths (`C:\...`). macOS/Linux builds are expected to work but are less exercised; note any platform-specific issue you hit to your operator team.

**Time sync**: every host needs its OS clock kept in sync via standard NTP (chrony or systemd-timesyncd on Linux, w32time on Windows) — xtcn has no built-in clock-sync or skew-tolerance of its own. Consensus slot timing (`block_time_ms`) is computed purely from each host's local wall clock, so a host whose clock has drifted meaningfully can fall out of step with its peers (missed turns, rejected votes) with no warning from xtcn itself.

**Binaries**

* `xtcn` — the consensus node binary. One process per shard delegate or coordinator replica.
* `xtgw` — the RPC gateway binary. One or more per chain, stateless, can be scaled independently of consensus.
* **XTblock Console** — the Tauri + React desktop app used to install, configure, launch, and monitor `xtcn`/`xtgw` instances, and to deploy/call contracts, without hand-editing config files or using a separate CLI for routine operations.

**Installation steps**

1. Install the XTblock Console desktop app on the operator workstation/server.
2. Place the `xtcn.exe` and `xtgw.exe` binaries where the Console's "New instance" flow expects them (the Console reads each instance's own `node.toml` path directly — no separate registration step).
3. Confirm the host meets or exceeds the hardware floor above before provisioning a production or demo chain.
4. Proceed to §3 (Network & Identity Setup) to create or join a chain.

**Example — expected instance folder layout, and starting a node manually (Console does this for you, but the equivalent command line is):**

    instances/
      shard0-delegate0/
        node.toml
        tls_cert.pem
        tls_key.pem
        ca_cert.pem
      coord-replica0/
        node.toml
        ...

    # from the folder containing the binary and node.toml
    ./xtcn --config node.toml
    ./xtgw --config node.toml

## 3. Network & Identity Setup

A **solo instance** created via Quick Start needs none of this — it runs its own isolated single-delegate chain out of the box. This section covers the two real ways to go beyond that: wiring multiple solo instances you control into one real multi-delegate group (§3.0), and creating a real, named, signed chain — with its own genesis manifest and network map — for production or for sharing across operators (§3.1–§3.4).

**3.0 Wiring multiple solo instances into one chain group (same operator, local machines)**

Every instance Console creates is solo by design (§5.1) — there is no multi-delegate option in the New instance wizard itself. To make several solo instances act as one real multi-delegate chain:

1. Create one solo instance per delegate you want (§5.1).
2. From any one instance's panel, click **Chain group** — it lists every other real, locally-known delegate and gives you a ready-to-paste `[[delegates]]` block for each, without risking a duplicate index.
3. Paste the resulting `[[delegates]]` blocks into every instance's own `node.toml` (§5.2's raw-TOML editor), so every delegate agrees on the same roster — required for leader rotation and quorum to mean anything.
4. Restart each instance (§5.7) for the new roster to take effect.

This is the lightweight, same-operator path. For a delegate run by a **different** operator/organization — who needs to generate their own identity and hand you a bundle rather than you wiring them directly — use the Shared chain wizard instead (§3.2).

**3.1 Creating a new chain (genesis manifest)**

Console: **New chain — genesis manifest**.

1. Fill in **Chain ID** (e.g. `xtb-testnet-1`), **Symbol**, **n_shard** (number of shard groups), and **delegate_count** (delegates per shard/coordinator). Token decimals and name are fixed.
2. Set **Total initial supply** and review the network-declared gas/fee defaults (editable before signing).
3. Optionally load an existing manifest as a starting point (pre-fills settings/delegates; Chain ID is left blank so you don't overwrite the source file).
4. Optionally switch to raw TOML edit mode for direct control over the generated file before signing.
5. Sign with a real Ed25519 private key. **Testnet-tier signing only** — the mainnet HSM + M-of-N multisig custody path is not implemented in the Console. Nothing is stored or reused between chains.
6. The Console writes the signed genesis manifest file and reports its path — copy this into `genesis_manifest_path` on every instance that will join this chain.

**3.2 Generating a node identity**

Console: **Key generator** (for a standalone identity) or the **Shared chain — independent co-delegates** wizard (for an operator joining an existing chain they don't control end-to-end):

1. **Generate identity** — creates a self-signed TLS identity for a given host, written to an output directory.
2. **Export my bundle** — packages this delegate's index, public key, address, and identity cert path into a bundle to hand to whoever maintains the network map/genesis manifest for this chain.
3. **Build my config** — assembles this instance's own `node.toml` from the chain ID and the identity just generated.

**3.3 Trust model**

* **Network-map-driven trust (preferred)**: set `genesis_authority_pubkey_hex` plus `network_map_path` on every instance. Trust and routing then update automatically as the network map is re-signed and republished — no manual cert export/import/pin step per peer.
* **Pinned-cert fallback**: if no genesis authority/network map is configured yet, instances fall back to the older CA-based/pinned-certificate trust model (import a peer's pinned cert bundle manually via the Console).
* The Console's config panel shows, per instance, which trust mode is active and why — check this after any change to `genesis_authority_pubkey_hex` or `network_map_path`.

**3.4 Publishing network map updates**

When the delegate/coordinator/gateway roster changes, re-sign and republish the network map from the Console (same signing key model as §3.1) so every node picks up the change without hand-editing peer lists.

**Example — minimal node.toml identity/trust block, as generated by §3.1–3.2 above:**

    genesis_manifest_path = "C:\\xtblock\\genesis\\xtb-testnet-1.manifest.json"
    network_map_path = "C:\\xtblock\\network\\xtb-testnet-1.network-map.json"
    genesis_authority_pubkey_hex = "7c3f..."  # same value on every instance in this chain
    
    tls_cert_path = "C:\\xtblock\\identity\\shard0-delegate0\\tls_cert.pem"
    tls_key_path = "C:\\xtblock\\identity\\shard0-delegate0\\tls_key.pem"
    tls_ca_cert_path = "C:\\xtblock\\identity\\shard0-delegate0\\ca_cert.pem"

Check which trust mode is active from the panel, or by confirming both `genesis_authority_pubkey_hex` and `network_map_path` are non-empty — either alone falls back to pinned-cert trust.

**3.5 Key custody**

* Every private key entered in Console (chain-signing key in §3.1, delegate identity in §3.2) is used in-memory only — nothing is written to disk or reused between operations.
* The manual signing flow in §3.1 is explicitly **testnet-tier**: fine for a demo or internal chain, not appropriate for a chain holding real value — there is no HSM or M-of-N multisig custody path built into Console today.
* Never paste a production signing key into a shared or screen-shared Console session. Treat every key field the same as a password field, even where the UI doesn't mask it.
* Losing the chain-signing key used in §3.1 doesn't stop the chain running, but does stop you from signing a new genesis manifest or network map for it — store it with the same care as any root credential.

**3.6 Multi-machine addressing**

* Every delegate's `address` in its peers' `[[delegates]]` list (§4) must be that delegate's real, externally-reachable `host:port` — never `127.0.0.1` — the moment any two instances in the chain group run on different machines. xtcn derives its own reply address for request/reply traffic (status queries, proofs, 2PC checks, state sync, etc.) from this same `delegates` entry (as of v0.10.0), so a wrong or loopback-only address here breaks replies silently: the request appears to send fine, but the reply never arrives.
* `xtgw` has no `[[delegates]]` list of its own to infer this from — set `own_host` in its own config file to its real, externally-reachable host whenever it talks to a delegate/coordinator on a different machine. Leaving `own_host` unset falls back to `127.0.0.1` and logs a startup warning.

## 4. Node Configuration Reference

All fields live in each instance's `node.toml`. The Console's raw-TOML editor validates syntax before restart using the same parser `xtcn`/`xtgw` use, so config mistakes surface before a crash rather than after.

**Core identity & topology**

* `block_time_ms` (default 1000) — target time between blocks, in milliseconds. Every other timing field below is sized relative to this.
* `own_port` — this instance's own listening port.
* `delegate_count` — number of delegates this shard (or coordinator) expects, from the genesis manifest.
* `n_shard` (default from genesis) — total shard groups in this chain.

**Chain identity & test traffic**

* `eth_chain_id` (optional) — EIP-155 chain id. If unset, xtcn 0.10.20+ derives it from the network chain, matching `xtgw`. It must be identical on every delegate and gateway; a mismatch silently drops wallet transactions.
* `synthetic_txs` (default `true` when absent; the Console writes `false` for new instances) — when false, blocks carry no built-in filler transactions. Set it the same on every delegate of the chain: it is checked in block verification, so mixed settings cause divergence.
* `auto_restart` — read live by `xtops-agent`; required for fork auto-recovery (below).

**Throughput & mempool**

* `mempool_cap` (default 50, as of v0.9.0) — max transactions pulled into a single block, per transaction source. `SignedTransfer` and `RawEthTransfer` each get an independent budget of this size, so a block can carry up to `2 × mempool_cap` total. Not wired to gas limits or consensus rules — raising it further is safe only as far as it's been tested; see §6 for how this project validated 50 from a real load test, which is why it's the compiled default now rather than an opt-in override. Transactions beyond the cap wait for the next block rather than being dropped.
* `event_log_retention_blocks` (default 86,400, about a day at 1 s blocks) and `event_log_max_entries` (default 500,000 logs, up to roughly 150 MB of memory) — how much contract-event history `eth_getLogs` keeps per delegate (xtcn 0.10.32+). The oldest blocks are dropped first. Raise both for a longer history; the history is also stored in `event-logs-<chain>-<index>.bin`, so disk use and startup time grow with it. Set the same values on every delegate of a shard.

**Consensus timing**

* `miss_timeout_ms` (default 3000) — how long a delegate waits for an on-time proposal before treating the round as missed.
* `vote_collection_window_ms` — a brief hold (comfortably under `miss_timeout_ms`) before voting for a skip-proposal, to give a genuine on-time (or less-escalated) proposal a chance to arrive first. Adds no latency to the healthy path.

**2PC (cross-shard transactions)**

* `two_pc_attempt_timeout_ms` — per-attempt timeout for a 2PC round.
* `two_pc_lock_expiry_secs` — how long a 2PC address lock is held before it expires.
* `two_pc_griefing_threshold` / `two_pc_griefing_window_secs` — rate-limits an address that repeatedly triggers likely-timeout lock releases, to prevent griefing.
* `two_pc_backup_promotion_secs` — how long before a backup coordinator replica is promoted if the primary is unresponsive.
* `checkpoint_interval` (default set by chain) — how often a shard submits a checkpoint to the coordinator chain.

**Rate limits**

* `proof_rate_limit_max` (default 20) / `proof_rate_limit_window_secs` (default 10) — throttles state/transaction proof generation (CPU-expensive) to `proof_rate_limit_max` requests per `proof_rate_limit_window_secs` — 2 requests/sec at defaults. Shared between `ProofRequest` and `TxProofRequest`.

**Fee & gas (optional, off by default)**

* **Gas/fee policy in the genesis form:** choose **No gas fees** (writes `zero_gas_mode = false`, `fee_market_enabled = false` into the manifest) or **Fee market** (also needs a treasury address). Either way the choice is pinned in the manifest. Zero-gas mode is no longer offered in the Console.
* `zero_gas_mode` / `fee_market_enabled` / `treasury_address_hex` must equal what the signed genesis manifest declares. From xtcn 0.10.24 every start checks this and refuses to run on a mismatch (earlier versions checked only on a fresh start, so a restarted node could run with a different value unnoticed).
* `zero_gas_stipend` — if `zero_gas_mode` is enabled, tops a sender's balance up to this stipend directly whenever it falls below it, every block. **Unbounded, untracked minting while enabled** — a deliberate, optional convenience for enterprise/private-chain deployments that want gas-free transactions for known participants, never enabled by default, and not intended for a public or token-scarce chain.
* `gas_relay_stipend` — separate relay-stipend mechanism; see the fee-market spec for scope.
* `block_stm_enabled` — enables the Block-STM-style scheduler fallback for transactions with non-empty calldata (contract calls/deployments), which run solo rather than risk an unseen storage conflict from a transitive contract call.

**Identity & trust** (see §3 for the full setup flow)

* `genesis_manifest_path`, `network_map_path`, `genesis_authority_pubkey_hex` — chain identity and trust-model inputs.
* `tls_cert_path` / `tls_key_path` / `tls_ca_cert_path` — this instance's own TLS identity.

**xtgw: chain identity (`eth_chain_id`) and RPC serving (`eth_rpc_enabled`)**

These two fields only matter for `xtgw`, and only if you want to override the automatic default. For a normal setup — including a bare, network-map-driven `xtgw` created via Console's simplified New Instance flow (§5.1), with **no manual `[[chains]]` block at all** — both are handled for you automatically:

* **`chain_id`** — on a bare `xtgw`, this is never a literal field you set. At startup, `xtgw` derives it itself from whichever of `network_map_path`/`genesis_manifest_path` is configured (network map preferred, manifest as fallback) — the same files §3.3/§3.4 already have you point at for trust. Console's instance detail panel shows the resolved value directly.
* **`eth_chain_id`** — the numeric chain ID served over `eth_chainId`/wallet configuration (Developer Manual §2). Derived deterministically from `chain_id` (a `blake3` hash of the string, truncated to 4 bytes) — the same `chain_id` string always produces the same `eth_chain_id`, with no field to set. Console displays this alongside `chain_id` on the instance detail panel. To override it with a specific number instead (e.g. to match an existing wallet's saved network entry), add a manual `[[chains]]` block with an explicit `eth_chain_id = <value>` — only needed for that one case.
* **`eth_rpc_enabled`** (default `true`) — gates whether a given chain is actually served over the `eth_*` JSON-RPC surface. One `xtgw` process/port serves at most one chain's `eth_*` RPC at a time. This only becomes a real decision if you hand-write **more than one** `[[chains]]` entry on the same `xtgw` (unusual — one `xtgw` routing `eth_*` for two chains at once): the first entry with `eth_rpc_enabled = true` wins, and a startup warning logs for the rest. A single bare or single-chain `xtgw` never needs this field touched.

In short: don't add a `[[chains]]` block just to get `eth_chain_id` or `eth_rpc_enabled` working — both already work without one. Only add one to override a value by hand.

**Example — a shard delegate's `node.toml`, with the throughput/timing fields from this section set explicitly (rather than left at default):**

    block_time_ms = 1000
    own_port = 7601
    delegate_count = 3
    
    mempool_cap = 50            # the compiled default as of v0.9.0 — see this manual's mempool_cap decision log
    miss_timeout_ms = 3000
    vote_collection_window_ms = 250
    
    proof_rate_limit_max = 20
    proof_rate_limit_window_secs = 10
    
    two_pc_attempt_timeout_ms = 3000
    two_pc_lock_expiry_secs = 30
    two_pc_griefing_threshold = 5
    two_pc_griefing_window_secs = 60
    two_pc_backup_promotion_secs = 15
    checkpoint_interval = 100

## 5. Launching and Operating the Chain via Console

**5.1 Starting an instance**

1. Console → **New instance**. Pick a preset — **Delegate (xtcn)** or **Gateway (xtgw)** — or toggle both workers for a combined instance.
2. Configure that worker: for **xtcn**, pick `shard` or `coordinator` (a label only, §4) — port is auto-assigned. For **xtgw**, optionally set a port and a coordinator to route to (both can be left blank and wired up later, e.g. via "Import a coordinator's pinned cert").
3. Name the instance, choose whether to auto-start and auto-restart-on-crash, and finish.
4. Console spawns the binary with a freshly auto-generated TLS identity (`xtcn --gen-certs` under the hood) and a complete default `node.toml`. Every instance created this way starts as its own solo chain (`own_index = 0`, `delegate_count = 1`) — §3.0 covers joining several into one real group.

**5.2 Day-2 config changes**

* Edit a running instance's config from its panel: structured fields, or **Edit the whole file as raw text** for full control (validated against the real TOML parser before restart, §4).
* **Edit cross-shard/coordinator fields** and **Remove manual `[[remote_shards]] entries`** are both exposed directly — the latter is safe once network-map-driven routing (§3.3) is active, since it already covers the same ground automatically.
* Changes to `node.toml` require a restart of that instance to take effect.

**5.3 Adding an operator / access control**

Console supports multiple named operators on one installation (**Add a new operator**, **Change password**) — use this to hand day-2 operation to a second person without sharing one login.

**5.4 Remote hosts (xtops)**

The Console only manages instances on its own local machine directly. To operate a remote host, connect to that host's `xtops-agent` (**Live xtops connection**): point the Console at the folder containing that agent's own PKI (`ca-cert.pem`/`cert.pem`/`client-cert.pem`/`client-key.pem`), the same folder `xtops.exe`/`agent.exe` lives in. Once connected, the panel auto-refreshes (polls every 3s) and shows that host's live status.

**5.5 Shutting down**

Stop an instance from its own panel. For a full chain shutdown, stop all delegates/coordinators before gateways, so no gateway is left routing to an already-stopped delegate.

**Example — startup/shutdown order for a full chain (2 shards + coordinator + gateway), command-line equivalent of what Console's New instance buttons do:**

    # start every coordinator replica first
    ./xtcn --config coord-replica0/node.toml &
    ./xtcn --config coord-replica1/node.toml &
    ./xtcn --config coord-replica2/node.toml &
    
    # then every shard delegate
    ./xtcn --config shard0-delegate0/node.toml &
    ./xtcn --config shard0-delegate1/node.toml &
    ./xtcn --config shard1-delegate0/node.toml &
    
    # gateway last, once delegates are up
    ./xtgw --config gateway0/node.toml &
    
    # shutdown: reverse order — stop gateways, then shard delegates, then coordinators

**5.6 Confirming a new instance actually started**

* Open that instance's **logs** panel in Console (available from the instance's own window) — look for a real block being proposed/finalized, not just a "process started" line.
* Cross-check with Explorer → **Known-chain health** (§6) — it should show this shard/coordinator as healthy within a few block times.
* If nothing is happening: confirm `delegate_count` in this instance's `node.toml` matches how many delegates are actually running and reachable — a shard below quorum will sit idle, not error loudly.

**5.7 Upgrading a running chain**

1. Check whether the new build changed any wire format (message/RPC struct fields) — this project's own changelog notes it explicitly when it does (e.g. the receipt-status fix, §7). A wire-format change means every `xtcn`/`xtgw` instance must be rebuilt and restarted together — mixed old/new binaries will misbehave.
2. Stop instances in the same order as a full shutdown (§5.5): gateways, then shard delegates, then coordinators.
3. Replace the binaries for each instance.
4. Restart in the same order as a fresh start (§5.1): coordinators, then shard delegates, then gateways.
5. Confirm health (§5.6, §6) before considering the upgrade complete.

**Bulk Auto-restart**: in the instance list, tick instances and use **Auto-restart ON / OFF** to toggle `auto_restart` for all selected (local instances only).

**Faucet**: Tools → Faucet funds test addresses with XTT from a funded **EVM (secp256k1) private key**, signed like a wallet transaction and sent through the xtgw RPC (needs xtcn 0.10.23+ installed next to the Console; no delegate to pick). It shows the sender's and recipients' shards and balances, refuses amounts above the sender's balance, skips recipients on a different shard than the sender, and confirms each credit. Fund a dedicated faucet account in the genesis manifest with a large allocation; Genesis does not fund any test accounts by default.

**Gateway faucet and developer portal (0.10.29)**: xtgw serves a developer web page at its RPC port and can run a built-in faucet. In xtgw.toml `[[chains]]` set `faucet_private_key_hex` (dedicated test account, plain text, fund it at genesis or by transfer), optionally `faucet_drip_wei` and `faucet_cooldown_secs`. Network-map-driven gateways (no `[[chains]]` entry) put the same three `faucet_*` lines at the TOP LEVEL of xtgw.toml, before the first `[table]`/`[[table]]` header. Share `http://<xtgw-host>:<rpc-port>/` with developers; they need no delegate access. Tell them to deploy contracts only with the portal or Console and to use MetaMask for transfers and calls. The Console's top-bar **Developer mode** toggle hides node-management screens for people who only develop.

**Keys**: Tools → Keys generates EVM (secp256k1) keys for wallets, deploy, call and faucet, and Ed25519 keys used only as delegate consensus identities — not for transactions.

**Upgrades**: new message types are added to the delegate protocol; upgrade **all** delegates of a chain together (mixed versions break on new messages and on gas/synthetic rule changes).

## 6. Monitoring & Forensics in Console

**Cross-shard transfer (Tools → Cross-shard (2PC))**: starts an atomic multi-shard transfer through a **local coordinator** (xtcn `--start-2pc`; needs xtcn on the Console machine). Pick the coordinator's `node.toml`, the Console generates a fresh 64-hex transaction ID after every run (a coordinator silently ignores an ID it has already seen); wait about a minute between failed attempts, because an address with repeated timed-out 2PCs is briefly rate-limited, then add one group per shard: the shard, the sender's **EVM (secp256k1) private key** (must be on that shard — the Console shows the key's shard and blocks a mismatch), the recipient address (its shard is shown too), the amount in XTT and nonce (`auto`). Each group is either a **Transfer** or a **Contract call**: for a call, enter the contract address, paste its ABI, pick a function and fill its inputs (the Console encodes the calldata, checks that the contract is on the group's shard, and asks the gateway (`eth_getCode`) whether code actually exists there — a call to an address with no code on its shard only moves value and the function does not run, so the Console blocks it; raw hex is under Advanced). Each shard can appear once. Every shard applies its transfer or none does. Do not use it on a chain with `zero_gas_mode = true`: that mode tops senders up to the stipend before each native-signed transaction, so sender balances never fall and targets gain value from nowhere. With an xtgw RPC set, the Console polls `xt_getTwoPcRecordLocation` and reports when the coordinator has recorded the 2PC; open Explorer → shard 999 → that block to see the outcome. 2PC moves value; it does not remove the rule that a contract call must come from a key on the contract's shard.

**Checkpoints (Explorer → Checkpoints)**: every `checkpoint_interval` blocks (default 60) each shard's delegate signs its block hash and state root and sends them to the coordinator(s) in `coordinator_addresses`. The coordinator verifies the signature against the shard's key in `remote_shards`, keeps only the latest per shard (saved in `checkpoint-registry-<chain>-<index>.bin`) and records each accepted checkpoint in its own next block. Only 32-byte roots are stored — no transactions or accounts. The Checkpoints panel scans recent coordinator blocks (default 300) and shows each shard's latest checkpoint, the shard's current height, how far behind it is (amber above 180 blocks), the coordinator block that recorded it and its age. If a shard shows nothing, check its `coordinator_addresses`, the coordinator's `remote_shards`, and the coordinator log for "rejected a Checkpoint". Checkpoints are anchors for proofs (`--request-proof`); they are not used for shard recovery.

The Console's Explorer panel is the operator's day-2 health and investigation toolkit.

* **Known chains** — the chains this Console instance knows an RPC endpoint for (chain ID + host + port).
* **Browse a block** — fetch any block by shard + block number.
* **Known-chain health** — a quick per-shard status check. Reaches only one delegate per shard (whichever the gateway routes to), so it cannot see a single shard's own internal consensus divergence.
* **Compare across delegates** — asks every individual delegate behind a shard (or, for the coordinator chain, `shard_id = 999`, every coordinator address directly) for the same block, and flags any delegate whose hash disagrees with the majority. Catches internal consensus divergence that Known-chain health cannot see.
* **Divergence timeline** — finds exactly where two delegates' chains first disagreed. Two modes:
  * **Walk backward** — checks one block at a time going back from a given height, with an adjustable lookback and a "keep going" resume button. Straightforward, but cost scales linearly with how far back the fork actually is.
  * **Binary search** — given one block known to diverge and one known to agree, finds the boundary in ~log₂(range) queries instead of one per block. The right choice when a fork was discovered long after it happened (hours or days), since a linear walk over that range would be far too slow. Relies on divergence being monotonic in block height (a delegate doesn't un-diverge without being explicitly resynced) — re-run if a delegate was resynced onto the majority chain between the two known points.
* **Search** — look up a transaction or block by hash.

**No contract/wallet directory.** There is no indexing layer behind Explorer — no RPC or panel lists every deployed contract or every wallet address on a shard, chain-wide, not even a count. Everything above is lookup-by-key (a block, a tx hash, a specific address) rather than enumeration. Answering "how many contracts/wallets are on this chain" today means scanning blocks yourself (or building a separate indexing solution) — there's nothing in Console to ask for it directly.

**Recommended routine**: run Known-chain health continuously (or on a schedule); when it flags a problem, or before anything looks wrong at all if you suspect a slow-forming fork, follow up with Compare across delegates on the affected shard, then Divergence timeline to pin down exactly where and when delegates split.

**Example — the three forensic RPC calls behind Compare across delegates / Divergence timeline, callable directly if you're scripting a health check:**

    # Compare across delegates, shard 0, block 89473
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"xt_compareDelegates","params":[0,89473]}'
    
    # Walk-backward divergence timeline from block 89473, up to 100 blocks back
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"xt_findDivergence","params":[0,89473,100]}'
    
    # Binary search between a known-diverging block and a known-agreeing block
    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"xt_binarySearchDivergence","params":[0,89473,89000]}'

## 7. Troubleshooting

| Symptom | Real cause | Resolution |
| --- | --- | --- |
| "No real delegates known for that shard yet" on shard 999 in Compare across delegates | Fixed. Earlier builds had no self-registration mechanism for coordinator replicas, so the delegate registry was permanently empty for `shard_id = 999`. | Update to a build after this fix — shard 999 now queries configured coordinator addresses directly instead of the delegate registry. |
| Compare across delegates showed 3 rows per real delegate instead of 1 | Fixed. Multiple coordinators each reported the same delegate roster, and results weren't deduplicated by `delegate_index`. | Update to a build after this fix. |
| `eth_getTransactionReceipt` always reports `status: 0x1`, even for a reverted transaction | Fixed. Per-transaction execution status was computed but discarded before reaching the RPC layer. | Update to a build after this fix. Requires rebuilding `xtcn` and `xtgw` together — this was a wire-format change. |
| A submitted `eth_sendRawTransaction` (type-2/EIP-1559) is rejected with "expected an RLP list (a legacy transaction), found a plain string" | By design, not a bug. Only legacy (type-0) transactions are supported. | Ensure the wallet/tool sends a legacy transaction — standard wallets (MetaMask included) already default to this, since `baseFeePerGas` is deliberately omitted from block responses. See the Developer Manual §7 for detail. |
| A delegate exited with "FORK DETECTED" | Its block diverged from the group. 0.10.20 auto-recovery: it writes `fork-recovery-pending-<chain>-<idx>.txt`, exits, and on restart backs up its snapshot, account store and registries to `fork-backup-<chain>-<idx>-<ts>/`, then runs a state-sync from its peers (max 3 attempts, restoring the backup on failure). | Make sure **Auto-restart** is on (Console list → select instances → Auto-restart ON). Read the fork incident report; if it fails 3 times, resync manually with `--request-state-sync`. |
| Wallet tx stays Pending forever | `eth_chain_id` differs between xtgw and the shard delegates, or only one delegate (not the leader) holds the tx. | Check delegate stderr for "real EIP-155 signature failed to recover"; align `eth_chain_id`; upgrade all shard delegates together. |
| A wallet/Console deploy or transfer shows "No receipt within 45s" and the nonce never advances | Before 0.10.27, xtgw sent a wallet-signed transaction to ONE delegate (the lowest index). A delegate only proposes from its OWN mempool and raw transactions are not gossiped, so a standby/suspended delegate held the tx forever. | Use xtgw 0.10.27+: it now sends each wallet-signed tx to EVERY delegate of the sender's shard. Also check the delegate logs for `real wallet-signed transaction accepted into mempool` and `proposing block ... includes N real wallet-signed transaction(s)`. |
| A contract deploy is mined but the receipt says `status 0x0` (reverted) | The constructor rejected an argument (e.g. a `require(_feeBps <= 10000)`), or gas ran out. | The ABI cannot show `require` limits; read the contract source. Before 0.10.26 xtgw's `eth_estimateGas` always answered 21000 so every deploy ran out of gas; from 0.10.26 it returns a realistic estimate. |
| A shard delegate is stuck at one height forever (log repeats `rejected synced block N — proposer P is not a legitimate leader ... (expected E ...)`) | Its local election view (who is Active/Suspended) disagrees with the group, so it rejects blocks the majority finalized. A suspended delegate that falls into this cannot catch up, and keeps being re-suspended. | 0.10.25+ runs the same automatic fork recovery as for a parent_hash fork (back up, state-sync from peers, restart; needs auto-restart). Manual fix: stop it, `xtcn --request-state-sync <node.toml> <peerIdx>,<peerIdx>`, start it. |
| The Explorer says "that block doesn't exist on this shard" for a block the other delegates have | The gateway reads each shard from one delegate; if that delegate is stuck/behind it does not have the block. | 0.10.25+ xtgw reads from a delegate at the majority-committed tip and logs `WARNING shard S delegate D is BEHIND`. State-sync the delegate it names. |
| A delegate refuses to start: "genesis manifest declares zero_gas_mode=false, but this node is configured with zero_gas_mode=true" | From 0.10.24 every start checks `zero_gas_mode`, `fee_market_enabled` and `treasury_address_hex` against the signed genesis manifest. | Make node.toml match the manifest (normally remove `zero_gas_mode = true`). Never use zero-gas mode on a testnet that should have real balances: it mints to native-signed senders and made 2PC "create money". |
| 2PC reports "No 2PC record seen after 60s" | The 2PC was not committed (aborted, lost decision, or a duplicate ID ignored as "already in flight"). | The Console now creates a fresh ID per run. Check the coordinator and both shard logs; see "2PC semantics" in the Developer Manual. |
| xtgw on a multi-machine setup can't reach delegates | `own_host` missing from `xtgw.toml`. | Set `own_host` to the machine's LAN IP. |
| A `node.toml` config edit doesn't take effect | `node.toml` changes require a restart. | Restart the affected instance from its Console panel. |
| Console can't reach a remote host under Live xtops connection | Agent not running, wrong PKI folder pointed at, or network path blocked. | Confirm `xtops-agent` is running on the remote host and the Console points at the exact folder containing its `ca-cert.pem`/`cert.pem`/`client-cert.pem`/`client-key.pem`. |
| A trusted peer is rejected unexpectedly after a roster change | Network map wasn't re-signed/republished after adding/removing a delegate, coordinator, or gateway. | Re-publish the network map from the Console (§3.4); confirm `genesis_authority_pubkey_hex` and `network_map_path` are set on every affected instance. |
| A block is silently missing transactions you know were submitted | Submission rate exceeded `mempool_cap` for that block; the transaction is queued, not lost. | Check again after the next block; if this recurs, `mempool_cap` may need raising — only after a real load test (§4, §6). |

**Example — confirming the receipt-status fix is live after an upgrade (sanity check to run once per rebuild):**

    curl -s http://localhost:8645 -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x<a known-reverted tx hash>"]}'
    # expect "status":"0x0" for a known-reverted tx, not "0x1"
