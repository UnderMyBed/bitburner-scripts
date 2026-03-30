/**
 * IPvGO player using fast heuristic evaluation (no search/simulation).
 * Evaluates each valid move by a weighted score based on board features.
 * Zero CPU-intensive computation -- just one pass over the board per move.
 *
 * Original pattern-matching version by: Sphyxis, Stoneware, gmcew, eithel, Insight (alainbryden)
 */

import {
    getConfiguration, instanceCount, log, getErrorInfo, getActiveSourceFiles, getNsDataThroughFile
} from './helpers.js'

const argsSchema = [
    ['cheats', true],
    ['disable-cheats', false],
    ['cheat-chance-threshold', 0.9],
    ['runOnce', false],
    ['board-size', 7], // Smaller = faster games = more favor/hour
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || (await instanceCount(ns)) > 1) return;
    ns.disableLog("ALL");

    const sourceFiles = await getActiveSourceFiles(ns, true);
    const cheats = !runOptions['disable-cheats'] && (sourceFiles[14] ?? 0) >= 2;
    const cheatThreshold = runOptions['cheat-chance-threshold'];
    const boardSize = runOptions['board-size'];
    const runOnce = runOptions['runOnce'];

    const opponents = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"];
    const opponentsWithMystery = [...opponents, "????????????"];

    // RAM-dodging wrappers
    async function getBoardState() { return await getNsDataThroughFile(ns, `ns.go.getBoardState()`); }
    async function getValidMoves() { return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`); }
    async function getLiberties() { return await getNsDataThroughFile(ns, `ns.go.analysis.getLiberties()`); }
    async function getControlledNodes() { return await getNsDataThroughFile(ns, `ns.go.analysis.getControlledEmptyNodes()`); }
    async function getCheatChance() { return await getNsDataThroughFile(ns, `ns.go.cheat.getCheatSuccessChance()`); }
    async function cheatPlayTwo(x1, y1, x2, y2) {
        return await getNsDataThroughFile(ns, `await ns.go.cheat.playTwoMoves(...ns.args)`, null, [x1, y1, x2, y2]);
    }

    // ==================== HEURISTIC MOVE EVALUATOR ====================

    const EMPTY = '.', BLACK = 'X', WHITE = 'O', WALL = '#';

    /** Score a single move based on board features. Higher = better. */
    function scoreMove(board, liberties, controlled, x, y, size) {
        let score = 0;

        // 1. Prefer moves near the center (better influence)
        const cx = (size - 1) / 2, cy = (size - 1) / 2;
        const distFromCenter = Math.abs(x - cx) + Math.abs(y - cy);
        score += (size - distFromCenter) * 2;

        // 2. Avoid edges on first few moves (weak positions)
        if (x === 0 || y === 0 || x === size - 1 || y === size - 1) score -= 5;
        // Corners are worst
        if ((x === 0 || x === size - 1) && (y === 0 || y === size - 1)) score -= 5;

        // 3. Capture: strongly prefer moves adjacent to enemy groups with 1 liberty
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            if (board[nx][ny] === WHITE && liberties[nx][ny] === 1) score += 50; // Capture!
            if (board[nx][ny] === WHITE && liberties[nx][ny] === 2) score += 15; // Atari threat
            if (board[nx][ny] === BLACK && liberties[nx][ny] === 1) score += 30; // Save our group
            if (board[nx][ny] === BLACK && liberties[nx][ny] === 2) score += 5; // Reinforce
        }

        // 4. Prefer moves in contested territory (not already controlled by either side)
        if (controlled[x][y] === '?') score += 10; // Contested
        if (controlled[x][y] === '.') score += 8; // Unclaimed empty
        if (controlled[x][y] === 'X') score += 2; // Already ours, less valuable
        if (controlled[x][y] === 'O') score += 12; // Invade enemy territory

        // 5. Prefer extending our own groups (adjacent to friendly stones)
        let friendlyNeighbors = 0, emptyNeighbors = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            if (board[nx][ny] === BLACK) friendlyNeighbors++;
            if (board[nx][ny] === EMPTY) emptyNeighbors++;
        }
        score += friendlyNeighbors * 3;
        // Having liberties (empty neighbors) is good
        score += emptyNeighbors * 2;
        // But being completely surrounded by friends is bad (fills our own eye)
        if (friendlyNeighbors >= 3 && emptyNeighbors === 0) score -= 40;
        // Don't fill our own eyes (all 4 neighbors are friendly)
        if (friendlyNeighbors === 4) score -= 100;

        // 6. Small random factor to break ties and add variety
        score += Math.random() * 3;

        return score;
    }

    /** Pick the best move using fast heuristic scoring. No search, no simulation. */
    function pickBestMove(board, validMoves, liberties, controlled) {
        const size = board[0].length;
        let bestMove = null, bestScore = -Infinity;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (!validMoves[x][y]) continue;
                const score = scoreMove(board, liberties, controlled, x, y, size);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = { x, y };
                }
            }
        }
        return bestMove;
    }

    // ==================== GAME LOOP ====================

    async function playGo() {
        const currentGame = await ns.go.opponentNextTurn(false);
        if (currentGame.type === "gameOver") startNewGame();

        while (true) {
            const board = await getBoardState();
            const validMoves = await getValidMoves();
            const liberties = await getLiberties();
            const controlled = await getControlledNodes();

            let results;

            // Try cheating first if available
            if (cheats) {
                try {
                    const chance = await getCheatChance();
                    if (chance >= cheatThreshold) {
                        const move1 = pickBestMove(board, validMoves, liberties, controlled);
                        if (move1) {
                            // For move2, just pick the next best valid move that isn't move1
                            const validMoves2 = validMoves.map((row, x) => row.map((v, y) =>
                                v && !(x === move1.x && y === move1.y)));
                            const move2 = pickBestMove(board, validMoves2, liberties, controlled);
                            if (move2) {
                                try {
                                    results = await cheatPlayTwo(move1.x, move1.y, move2.x, move2.y);
                                    checkGameOver(results);
                                    continue;
                                } catch { /* Cheat failed, fall through */ }
                            }
                        }
                    }
                } catch { /* Cheats unavailable */ }
            }

            // Normal move
            const bestMove = pickBestMove(board, validMoves, liberties, controlled);
            if (bestMove) {
                try {
                    results = await ns.go.makeMove(bestMove.x, bestMove.y);
                } catch (err) {
                    ns.print(`Move failed: ${getErrorInfo(err)}. Passing.`);
                    results = await ns.go.passTurn();
                }
            } else {
                results = await ns.go.passTurn();
            }
            checkGameOver(results);
            await ns.sleep(1);
        }
    }

    let opponentIndex = 0;
    function startNewGame() {
        const pool = cheats ? opponentsWithMystery : opponents;
        const opponent = pool[opponentIndex % pool.length];
        opponentIndex++;
        try { ns.go.resetBoardState(opponent, boardSize); }
        catch { ns.go.resetBoardState(opponents[0], boardSize); }
        ns.print(`New game vs ${opponent} on ${boardSize}x${boardSize}`);
    }

    function checkGameOver(results) {
        if (results.type === "gameOver") {
            if (runOnce) ns.exit();
            startNewGame();
        }
    }

    while (true) {
        try { await playGo(); }
        catch (err) {
            log(ns, `WARNING: go.js error: ${getErrorInfo(err)}`, false, 'warning');
            await ns.sleep(10000);
        }
    }
}
