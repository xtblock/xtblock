# XTB Testnet release notes (xtcn 0.10.32 / console 0.8.77)

## Included
- 0.10.32 event history length: the delegate keeps events for `event_log_retention_blocks` blocks (default 86,400, about a day at 1 s blocks) up to `event_log_max_entries` logs (default 500,000), both settable in node.toml; the index is organised by block number so range queries stay fast, and delegates apply address/topic filters themselves. `eth_getLogs` answers with an error asking you to narrow the range when more than 10,000 logs match on a shard. Upgrade all delegates and xtgw together.
- 0.10.31 event index persistence: each delegate appends its event logs to `event-logs-<chain>-<index>.bin` next to its chain state and reloads them at startup, so `eth_getLogs` keeps its history across restarts. Fork auto-recovery moves the file into the fork backup with the rest of the state. Upgrade all delegates and xtgw together.
- 0.10.30 events and gas: contract events appear in receipts and in `eth_getLogs`; receipts report the real `gasUsed`. Fixes a bug where the proposing delegate had no receipt data for its own blocks, so a receipt answered by the leader could show success and 0 gas even for a reverted transaction. All delegates and xtgw must run 0.10.30 (new messages). `receipts_root` is unchanged, so existing chains keep validating. The portal shows gas used and decoded events after a write.
- 0.10.29 developer portal: every xtgw serves a web page at its RPC port (`http://<xtgw-host>:<rpc-port>/`) with wallet, contract deploy (shard-aligning self-transfers are sent automatically), contract call/read, explorer (blocks, transactions, addresses, 2PC records) and faucet. Developers need no delegate, no Console and no MetaMask setup. Deploy contracts with the portal or the Console only; use MetaMask for transfers and calls.
- 0.10.29 xtgw faucet (testnet only): set `faucet_private_key_hex` (optional `faucet_drip_wei`, default 1 XTT; `faucet_cooldown_secs`, default 3600) in the chain's `[[chains]]` entry of xtgw.toml. Network-map-driven gateways (no `[[chains]]` entry) put the same three `faucet_*` lines at the TOP LEVEL of xtgw.toml, before the first `[table]`/`[[table]]` header. The key sits in plain text; use a dedicated account holding only test funds. The account must be funded at genesis or by a transfer, and its own shard must be reachable.
- Console 0.8.77 Developer mode (top-bar toggle): hides node-management screens (instances, New chain, Tools, Connect, Add operator) and shows the portal for a gateway address, plus Keys, Shard lookup and Manuals.
- Wallet txs (MetaMask/Remix) work end to end: eth_chain_id auto-derived on delegates, receipts with contractAddress, eth_getCode, xtgw relay logging.
- Fork auto-recovery (backup + state-sync, 3 attempts) instead of permanent halt; requires auto-restart.
- No built-in per-block synthetic txs for new chains (`synthetic_txs = false`).
- Console: constructor args, log search, bulk auto-restart, Faucet, Explorer Checkpoints panel, Cross-shard (2PC) tool (per-shard transfers or contract calls with ABI builder, shard and balance checks).
- Console Contract deploy/call and Faucet go through the xtgw RPC (wallet-style signing); no delegate selection. Needs xtcn 0.10.24+ on the Console machine.
- xtgw rejects wallet contract deployments whose address would hash to another shard (error tells which nonce to use).
- From 0.10.24 every node checks `zero_gas_mode` / `fee_market_enabled` / treasury against the signed genesis manifest on EVERY start (before, only on a fresh start), and refuses to start on a mismatch.
- From 0.10.28: a delegate whose election view disagrees with the group (rejects a quorum-verified block as "proposer N is not a legitimate leader") now runs the fork auto-recovery (state sync) instead of retrying forever; xtgw reads each shard from a delegate at the majority-committed tip and warns about delegates that are behind; the "inert value-only call" WARNING only appears for calls with calldata.
- From 0.10.28: xtgw `eth_estimateGas` returns a realistic value for contract creation and calls with calldata (it used to always answer 21000, so Console deploys got "gas limit 27300", ran out of gas and never created the contract).
- Console 0.8.75: Contract deploy/call modals have a "Refresh balance" button next to each wallet balance.
- From 0.10.28: xtgw sends each wallet-signed transaction to EVERY delegate of the sender's shard (a delegate only proposes from its own mempool; a standby/suspended one used to hold the tx forever, so deploys and transfers were never mined).
- Gas fix: empty-data call to a contract gets 300k gas.

## Known limitations
- Events: `eth_getLogs` and receipt `logs` work (address/topic filters, shard block numbers), but cover about a day per shard by default (configurable, persisted on disk since 0.10.31, absent for blocks a delegate only synced); no `blockHash` filter, no `eth_newFilter`/subscriptions, `logsBloom` is zero. Plain transfers report `gasUsed` 0.
- Contracts deployed via wallets may hash to another shard than the deployer -> inert calls (use console deploy).
- Receipts/tx locations are in-memory (lost on restart).
- All delegates must run the same version.

## Release checklist
0. Do NOT use zero-gas mode (`zero_gas_mode = true`) on the testnet: it tops up every native-signed sender below 1 XTT to 1 XTT (incl. Cross-shard 2PC), so balances never go down and targets gain value from nowhere. Check `zero_gas_mode` is absent/false in every node.toml and the genesis manifest.
1. Upgrade all delegates + xtgw together; create a NEW chain (or add `synthetic_txs = false` to every node.toml of the existing one).
2. Turn Auto-restart ON for all instances.
3. Fund test wallets via Tools → Faucet.
4. Deploy + call a contract from MetaMask/Remix and via console.
