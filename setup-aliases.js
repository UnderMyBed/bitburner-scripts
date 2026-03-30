/** @param {NS} ns
 * Sets up useful terminal aliases automatically. Run with --clear to remove them all. */
export async function main(ns) {
    const clear = ns.args.includes("--clear");
    const doc = eval("document");
    const terminalInput = doc.getElementById("terminal-input");
    if (!terminalInput) return ns.tprint("ERROR: Terminal must be visible to run this script.");
    const terminalEventHandlerKey = Object.keys(terminalInput)[1];

    async function runTerminalCommand(command) {
        terminalInput.value = command;
        terminalInput[terminalEventHandlerKey].onChange({ target: terminalInput });
        terminalInput.focus();
        await terminalInput[terminalEventHandlerKey].onKeyDown({ key: 'Enter', preventDefault: () => 0 });
        await ns.sleep(50);
    }

    const aliases = [
        // Core
        ["git-pull", "run git-pull.js"],
        ["start", "run autopilot.js"],
        ["stop", "home; kill autopilot.js ; kill daemon.js ; run kill-all-scripts.js"],
        ["sscan", "home; run scan.js"],
        ["do", "run run-command.js"],
        ["reserve", "run reserve.js"],
        ["liquidate", "home; run stockmaster.js --liquidate; run spend-hacknet-hashes.js --liquidate;"],
        ["facman", "run faction-manager.js"],
        ["ascend", "run ascend.js --install-augmentations"],
        // Spending sprees (before resetting)
        ["spend-on-ram", "run Tasks/ram-manager.js --reserve 0 --budget 1 --tail"],
        ["spend-on-gangs", "run gangs.js --reserve 0 --augmentations-budget 1 --equipment-budget 1 --tail"],
        ["spend-on-sleeves", "run sleeve.js --aug-budget 1 --min-aug-batch 1 --buy-cooldown 0 --reserve 0 --tail"],
        ["spend-on-hacknet", "run hacknet-upgrade-manager.js --interval 10 --max-payoff-time 8888h --continuous --tail"],
        ["buy-daemons", "run host-manager.js --run-continuously --reserve-percent 0 --min-ram-exponent 19 --utilization-trigger 0 --tail"],
        // Daemon modes
        ["xp", "run daemon.js -vx --tail --no-share"],
        // Work & crime (SF4)
        ["work", "run work-for-factions.js --fast-crimes-only"],
        ["crime", "run crime.js --tail --fast-crimes-only"],
        ["invites", "run work-for-factions.js --fast-crimes-only --get-invited-to-every-faction --prioritize-invites --no-coding-contracts"],
        // Hash spending
        ["hashes-to-hack-server", "run spend-hacknet-hashes.js --liquidate --spend-on Increase_Maximum_Money --spend-on Reduce_Minimum_Security --spend-on-server"],
    ];

    for (const [name, command] of aliases) {
        if (clear) {
            await runTerminalCommand(`unalias ${name}`);
        } else {
            await runTerminalCommand(`alias ${name}="${command}"`);
        }
    }
    ns.tprint(`${clear ? "Removed" : "Set up"} ${aliases.length} aliases.${clear ? "" : " Run with --clear to remove them."}`);
}
