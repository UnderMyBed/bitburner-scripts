# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bitburner game automation scripts -- a comprehensive JavaScript (ES6 modules) suite that runs inside the Bitburner browser game's NetScript (NS) environment. This is a fork of `alainbryden/bitburner-scripts` focused on closing gameplay gaps and speed-optimizing full game completion across all BitNodes.

There is no build system, no bundler, and **zero npm dependencies** by design (adding any would break in-game execution). No CI pipeline.

## Architecture

### Three-Tier Orchestration

```
autopilot.js (strategic layer - BitNode progression, aug install decisions)
  └─ daemon.js (tactical layer - HWGW batch scheduling, RAM allocation)
       ├─ Remote/*.js (execution layer - hack/grow/weaken on distributed servers)
       ├─ Tasks/*.js (utility layer - contracts, backdoors, port crackers)
       └─ [specialized managers launched as peers]
```

### Core Scripts

**autopilot.js (~1,160 lines)** -- Top-level orchestrator. 2-second polling loop that:
- Follows a hardcoded 27-BitNode progression order (`defaultBnOrder`)
- Detects win conditions (hack w0r1d_d43m0n or Bladeburner Operation Daedalus)
- Dynamically adjusts daemon.js args based on hack level and game state
- Manages the "Daedalus rush" (100B + 2500 hack + N augs)
- Triggers casino.js for early 10B bootstrap
- Decides when to install augmentations via multi-factor decision tree
- Launches/restarts all specialized manager scripts

**daemon.js (~2,400 lines)** -- Core hacking engine. Runs HWGW (Hack-Weaken-Grow-Weaken) batch scheduler:
- Scores servers by `moneyPerRamSecond` profitability
- Schedules up to 40 overlapping batches with millisecond-precision timing
- Distributes threads across all rooted servers sorted by free RAM
- Adaptively tunes `percentageToSteal` via binary-search optimization
- Has a "looping mode" (currently disabled/broken) where remote scripts self-loop
- Coordinates stock manipulation (grow = stock up, hack = stock down)
- Launches periodic helper scripts (contractor, program-manager, tor-manager, etc.)

**helpers.js (~960 lines)** -- Shared utility library imported by nearly every script:
- `getNsDataThroughFile()` -- writes a temp script that calls an expensive NS function, runs it, reads result from file. Central pattern for avoiding RAM bloat.
- `getConfiguration()` -- universal arg parsing with config file overrides and auto-generated `--help`
- `checkBackwardsCompatibility()` -- translates v3 API names to v2 equivalents at runtime
- `autoRetry()` -- exponential backoff retry for fault tolerance
- Custom JSON serializer handling Infinity, NaN, BigInt, Map, Set
- Formatting: `formatMoney()`, `formatRam()`, `formatDuration()`
- Every major function has a `_Custom` variant accepting function refs to reduce RAM cost

### Specialized Managers

| Script | Purpose | Key Algorithm |
|--------|---------|---------------|
| `faction-manager.js` | Augmentation purchasing | Prioritized aug selection across factions, NeuroFlux cost scaling |
| `stockmaster.js` | Stock market trading | Pre-4S: 75-tick cycle reversal detection. Post-4S: probability trading |
| `work-for-factions.js` | Faction work/crime | Optimal work ordering, company promotions, karma farming to -54K |
| `gangs.js` | Gang management | Territory tick detection (~20s), ascending logic, wanted level balancing |
| `bladeburner.js` | Bladeburner combat | Success probability thresholds (99%), stamina management, black ops sequencing |
| `sleeve.js` | Sleeve automation | Parallel work across 6-8 clones, augmentation budgeting |
| `host-manager.js` | Server purchasing | Utilization-triggered progressive server sizing |
| `casino.js` | Casino bootstrap | DOM-automated blackjack with save/reload on loss, targets $10B |
| `spend-hacknet-hashes.js` | Hash spending | Priority-based hash conversion, capacity management |
| `hacknet-upgrade-manager.js` | Hacknet upgrades | ROI-based upgrade selection (level/RAM/cores/cache) |
| `ascend.js` | Augmentation install | Sequential asset liquidation then install/soft-reset |
| `stanek.js` | Stanek's Gift charging | Max-thread temp scripts for fragment charging |
| `optimize-stanek.js` | Stanek layout | Combinatorial search for optimal fragment placement |
| `go.js` | IPvGO game | Pattern-matching strategy with optional cheat API (SF14.2+) |
| `crime.js` | Crime loops | Smart crime selection scaling to homicide |

### Remote Scripts (in `/Remote/`)

Small scripts executed on distributed game servers by daemon.js:
- `hack-target.js`, `grow-target.js`, `weak-target.js` -- HWGW batch execution with timing synchronization
- `manualhack-target.js` -- `ns.singularity.manualHack()` for intelligence farming
- `share.js` -- `ns.share()` for faction rep when RAM is idle

### Task Scripts (in `/Tasks/`)

- `contractor.js` + `contractor.js.solver.js` -- Two-stage coding contract solver (30+ contract types)
- `backdoor-all-servers.js` -- Parallel backdoor installation via singularity API
- `ram-manager.js` -- Home RAM upgrades within budget
- `program-manager.js` / `tor-manager.js` -- Auto-purchase port crackers and TOR
- `crack-host.js` -- Open ports and nuke a target server
- `run-with-delay.js` -- Cheaper alternative to ns.spawn (1GB vs 2GB)
- `write-file.js` -- Write files from script arguments

### Other Top-Level Scripts

- `git-pull.js` -- Download/sync scripts from GitHub (supports subfolder relocation)
- `scan.js` -- HTML-based interactive network visualization with clickable servers
- `cleanup.js` -- Remove `/Temp/` directory files
- `reserve.js` -- Set global money reserve threshold
- `kill-all-scripts.js` -- Cascade kill all scripts on all servers
- `grep.js` -- Search file contents
- `run-command.js` -- Execute arbitrary NS code from terminal
- `farm-intelligence.js` -- Soft-reset loop for intelligence stat farming
- `analyze-hack.js` -- Server hack profitability analysis
- `stats.js` -- HUD overlay with player statistics
- `sync-scripts.js` -- Push script changes to remote servers

## Key Design Patterns

- **RAM dodging:** `getNsDataThroughFile()` runs expensive NS calls in disposable temp scripts. `_Custom` function variants accept function refs to avoid duplicate RAM imports.
- **File-based IPC:** `/Temp/*.txt` files for inter-script communication (stock probabilities, analyze results, reserves).
- **Universal `argsSchema` + `autocomplete`:** Every script exports these. Config files (`{script-name}.js.config.txt`) override defaults without source edits.
- **Adaptive scheduling:** daemon dynamically adjusts target count, steal percentage, and batch timing based on RAM pressure.
- **Graceful degradation:** Everything handles missing Source Files, low RAM, missing APIs with sensible fallbacks.
- **Bitburner v2/v3 compatibility:** Code targets v3 APIs; `helpers.js:checkBackwardsCompatibility()` translates to v2 equivalents. `isV3(ns)` checks `ns.ui.getGameInfo().versionNumber >= 44`.

## Known Gaps (Not Automated)

| Feature | Status | Notes |
|---------|--------|-------|
| **Corporations (BN3)** | No code exists | Author skipped it; full corp automation needed |
| **Infiltration** | No code exists | No API; would need DOM automation like casino.js |
| **Sleeve memory purchases** | Blocked | No API; author TODO suggests casino.js-style UI automation |
| **Looping mode (daemon)** | Disabled/broken | Implemented but commented out ("DISABLED UNTIL WORKING BETTER") |
| **BitNode-specific strategies** | Minimal | Only 5 BN-specific checks in entire codebase; everything else is generic |
| **Grafting** | Partial | Detection exists but sleeve memory blocker limits it |
| **Bladeburner win condition** | Detected only | Autopilot detects BB completion but doesn't actively pursue it |

## Speed Bottlenecks

### Tier 1: Architectural

- **Looping mode disabled** -- Normal mode tears down and reschedules every batch. Looping mode lets remote scripts self-loop (10-50x throughput potential). Implemented but broken.
- **No per-BitNode strategy** -- Every BN runs the same generic approach. Speed-running needs BN-specific tuning (BN8=stocks-first, BN2=rush karma/gang, BN6=bladeburner win, etc.).
- **No corporation automation** -- Corps can generate infinite money, trivializing other mechanics in some BNs.

### Tier 2: Timing

| Parameter | Default | Location | Issue |
|-----------|---------|----------|-------|
| `cycle-timing-delay` | 4000ms | daemon.js | Only drops to 40ms at hack 8000+. Early game is 0.25 batches/sec. |
| `install-countdown` | 5 minutes | autopilot.js | Fixed wait after deciding to install augs. Adds up over many resets. |
| `checkForNewPrioritiesInterval` | 10 minutes | work-for-factions.js | Can grind suboptimal factions for 10min before re-evaluating. |
| Casino reload sleep | 10 seconds | casino.js | Game loads in 1-2s; wastes 8s per save-scum attempt. |
| `queue-delay` | 1000ms | daemon.js | Conservative scheduling buffer. |
| `time-before-boosting-best-hack-server` | 15 minutes | autopilot.js | Delays focusing hash spending on best target. |
| Various restart delays | 10 seconds | autopilot.js | Multiple 10s sleeps when killing/restarting scripts. |

### Tier 3: Autopilot switches to "tight mode" at hack 8000+

When hack level >= `high-hack-threshold` (default 8000), autopilot restarts daemon with:
- `cycle-timing-delay` 40ms (100x faster than default)
- `queue-delay` 50ms
- `recovery-thread-padding` 5.0
- `silent-misfires`

This is where real throughput lives, but reaching hack 8000 takes significant time.

## Remotes

- `origin` -- fork (this repo)
- `upstream` -- original repo at `alainbryden/bitburner-scripts`
