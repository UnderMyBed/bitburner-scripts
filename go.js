/**
 * IPvGO player using 1-ply lookahead with position evaluation.
 * For each valid move, simulates placing it (pure array ops), then evaluates the
 * resulting position. Picks the move that produces the best board state.
 * Runs in <1ms per move on 13x13 -- zero game lag.
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
    ['board-size', 9], // 9x9 is good balance of speed and territory. 5/7/9/13 supported.
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
    async function getChains() { return await getNsDataThroughFile(ns, `ns.go.analysis.getChains()`); }
    async function getControlledNodes() { return await getNsDataThroughFile(ns, `ns.go.analysis.getControlledEmptyNodes()`); }
    async function getCheatChance() { return await getNsDataThroughFile(ns, `ns.go.cheat.getCheatSuccessChance()`); }
    async function cheatPlayTwo(x1, y1, x2, y2) {
        return await getNsDataThroughFile(ns, `await ns.go.cheat.playTwoMoves(...ns.args)`, null, [x1, y1, x2, y2]);
    }

    // ==================== BOARD SIMULATION (lightweight, for 1-ply lookahead) ====================

    const EMPTY = '.', BLACK = 'X', WHITE = 'O', WALL = '#';
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    function inBounds(x, y, size) { return x >= 0 && y >= 0 && x < size && y < size; }

    /** Find group containing (x,y) and its liberty count. Returns {stones: [[x,y]...], liberties: number} */
    function floodGroup(board, x, y, size) {
        const color = board[x][y];
        const visited = new Set();
        const stones = [];
        let liberties = 0;
        const stack = [[x, y]];
        while (stack.length) {
            const [cx, cy] = stack.pop();
            const key = cx * size + cy;
            if (visited.has(key)) continue;
            visited.add(key);
            if (!inBounds(cx, cy, size) || board[cx][cy] === WALL) continue;
            if (board[cx][cy] === EMPTY) { liberties++; continue; }
            if (board[cx][cy] !== color) continue;
            stones.push([cx, cy]);
            for (const [dx, dy] of DIRS) stack.push([cx + dx, cy + dy]);
        }
        return { stones, liberties };
    }

    /** Simulate placing a stone at (x,y). Returns new board or null if invalid. */
    function simPlace(board, x, y, color, size) {
        if (board[x][y] !== EMPTY) return null;
        const b = board.map(r => [...r]);
        b[x][y] = color;
        const opp = color === BLACK ? WHITE : BLACK;
        // Remove captured opponent groups
        let captured = 0;
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (inBounds(nx, ny, size) && b[nx][ny] === opp) {
                const g = floodGroup(b, nx, ny, size);
                if (g.liberties === 0) {
                    for (const [sx, sy] of g.stones) b[sx][sy] = EMPTY;
                    captured += g.stones.length;
                }
            }
        }
        // Self-capture check
        if (floodGroup(b, x, y, size).liberties === 0) return null;
        return { board: b, captured };
    }

    // ==================== POSITION EVALUATION ====================

    /** Evaluate a board position for BLACK. Higher = better for us. */
    function evaluatePosition(board, size) {
        let score = 0;

        // Territory counting via flood-fill (same as Chinese scoring)
        const visited = Array.from({ length: size }, () => new Array(size).fill(false));
        let blackStones = 0, whiteStones = 0;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (board[x][y] === BLACK) { blackStones++; continue; }
                if (board[x][y] === WHITE) { whiteStones++; continue; }
                if (board[x][y] !== EMPTY || visited[x][y]) continue;

                // Flood-fill empty region
                const region = [];
                let touchesBlack = false, touchesWhite = false;
                const stack = [[x, y]];
                while (stack.length) {
                    const [cx, cy] = stack.pop();
                    if (!inBounds(cx, cy, size) || visited[cx][cy]) continue;
                    const cell = board[cx][cy];
                    if (cell === WALL) continue;
                    if (cell === BLACK) { touchesBlack = true; continue; }
                    if (cell === WHITE) { touchesWhite = true; continue; }
                    visited[cx][cy] = true;
                    region.push([cx, cy]);
                    for (const [dx, dy] of DIRS) stack.push([cx + dx, cy + dy]);
                }
                if (touchesBlack && !touchesWhite) score += region.length * 10; // Our territory
                else if (touchesWhite && !touchesBlack) score -= region.length * 10; // Their territory
                // Contested territory: slight bonus if we have more adjacent stones
            }
        }
        score += (blackStones - whiteStones) * 10; // Stone count

        // Group safety: penalize our weak groups, reward attacking their weak groups
        const evaluated = new Set();
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const key = x * size + y;
                if (evaluated.has(key)) continue;
                if (board[x][y] !== BLACK && board[x][y] !== WHITE) continue;
                const g = floodGroup(board, x, y, size);
                for (const [sx, sy] of g.stones) evaluated.add(sx * size + sy);
                const isOurs = board[x][y] === BLACK;
                const groupSize = g.stones.length;
                const libs = g.liberties;
                if (isOurs) {
                    if (libs === 0) score -= groupSize * 30; // Dead group (shouldn't happen after capture)
                    else if (libs === 1) score -= groupSize * 15; // In atari -- very dangerous
                    else if (libs === 2) score -= groupSize * 3; // Vulnerable
                    else score += groupSize * 1; // Healthy group
                } else {
                    if (libs === 1) score += groupSize * 20; // Enemy in atari -- we can capture
                    else if (libs === 2) score += groupSize * 5; // Enemy vulnerable
                    else score -= groupSize * 1; // Healthy enemy group
                }
            }
        }

        return score;
    }

    // ==================== 1-PLY MOVE SELECTION ====================

    /** Pre-filter: fast heuristic to identify the ~20 most promising moves to evaluate */
    function prescore(board, liberties, controlled, x, y, size) {
        let s = 0;
        // Center preference
        const cx = (size - 1) / 2, cy = (size - 1) / 2;
        s += (size - Math.abs(x - cx) - Math.abs(y - cy));
        // Adjacent to action (near existing stones)
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (!inBounds(nx, ny, size)) continue;
            if (board[nx][ny] === WHITE && liberties[nx][ny] <= 2) s += 20; // Near weak enemy
            if (board[nx][ny] === BLACK && liberties[nx][ny] <= 2) s += 15; // Near weak friend
            if (board[nx][ny] === BLACK || board[nx][ny] === WHITE) s += 3; // Near any stone
        }
        // Territory value
        if (controlled[x]?.[y] === 'O') s += 10; // Invade
        if (controlled[x]?.[y] === '?') s += 8; // Contest
        // Don't fill own eyes
        let friendly = 0;
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (!inBounds(nx, ny, size)) { friendly++; continue; } // Edge counts as friendly for eye detection
            if (board[nx][ny] === BLACK || board[nx][ny] === WALL) friendly++;
        }
        if (friendly >= 4) s -= 100; // Filling own eye
        return s;
    }

    /** Pick the best move using 1-ply lookahead with position evaluation. */
    function pickBestMove(board, validMoves, liberties, controlled, chains) {
        const size = board[0].length;
        const simBoard = board.map(r => [...r]);

        // Collect and prescore all valid moves
        const candidates = [];
        for (let x = 0; x < size; x++)
            for (let y = 0; y < size; y++)
                if (validMoves[x][y])
                    candidates.push({ x, y, prescore: prescore(simBoard, liberties, controlled, x, y, size) });

        if (candidates.length === 0) return null;

        // Sort by prescore and take top candidates (limit lookahead to best ~25 to stay fast on 13x13)
        candidates.sort((a, b) => b.prescore - a.prescore);
        const topN = Math.min(candidates.length, 25);

        let bestMove = null, bestScore = -Infinity;
        for (let i = 0; i < topN; i++) {
            const { x, y } = candidates[i];
            const result = simPlace(simBoard, x, y, BLACK, size);
            if (!result) continue;

            // Evaluate the resulting position
            let score = evaluatePosition(result.board, size);
            // Bonus for captures (immediate material gain)
            score += result.captured * 25;
            // Small tiebreaker from prescore
            score += candidates[i].prescore * 0.1;
            // Tiny random for variety
            score += Math.random() * 0.5;

            if (score > bestScore) {
                bestScore = score;
                bestMove = { x, y, score };
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
            const chains = await getChains();

            let results;

            // Try cheating first if available
            if (cheats) {
                try {
                    const chance = await getCheatChance();
                    if (chance >= cheatThreshold) {
                        const move1 = pickBestMove(board, validMoves, liberties, controlled, chains);
                        if (move1) {
                            const validMoves2 = validMoves.map((row, x) => row.map((v, y) =>
                                v && !(x === move1.x && y === move1.y)));
                            const move2 = pickBestMove(board, validMoves2, liberties, controlled, chains);
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

            // Normal move via 1-ply lookahead
            const bestMove = pickBestMove(board, validMoves, liberties, controlled, chains);
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
